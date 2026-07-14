"""
SmartOrder ML — Synthetic data pipeline.

Orchestrates the full synthetic data generation workflow:

    1. Load canonical real data (orders_canonical.parquet)
    2. Generate class coverage:  for each of the 3 target classes, ensure a
       minimum number of examples via a generation cascade:
           a. Rule-based augmentation (always applied for late_non_blocking;
              extended to on_time / late_blocking via perturbation)
           b. CTGAN (if class has >= min_samples_for_ctgan examples)
           c. SMOTE (if class has >= min_samples_for_smote examples)
           d. Gaussian perturbation (last resort — always available)
    3. Validate all synthetic rows
    4. Merge real + synthetic into training_dataset.parquet
    5. Stratified train/test split — guarantees >= 1 example of each class
       present in BOTH train and test.
    6. Generate synthetic_quality_report.md with per-class × split breakdown
       and explicit generation method per class.

Usage (CLI)::

    cd ml-service
    python -m synthetic.pipeline --method both --report

    # Or standalone generators:
    python -m synthetic.rule_based_augmentation
    python -m synthetic.ctgan_generator
"""

from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
import yaml

from config.logging_config import get_logger, setup_logging
from config.settings import get_settings

logger = get_logger("synthetic.pipeline")

_CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "model_config.yaml"

ALL_CLASSES = ["on_time", "late_non_blocking", "late_blocking"]

# Test-set fraction for synthetic rows
TEST_SIZE = 0.2

# Absolute minimum examples per class in each split
MIN_PER_CLASS_PER_SPLIT = 1


def _load_config() -> dict:
    with open(_CONFIG_PATH, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    return cfg.get("synthetic", {})


# ---------------------------------------------------------------------------
# Generation method tracking
# ---------------------------------------------------------------------------

class _ClassGenInfo:
    """Tracks generation details for a single class — used in the report."""

    def __init__(self, target_class: str) -> None:
        self.target_class = target_class
        self.n_real: int = 0
        self.n_rule_based: int = 0
        self.n_ctgan: int = 0
        self.n_smote: int = 0
        self.n_perturbation: int = 0
        self.method_used: str = "none"
        self.skip_reason: str = ""

    def total(self) -> int:
        return self.n_real + self.n_rule_based + self.n_ctgan + self.n_smote + self.n_perturbation


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------

class SyntheticPipeline:
    """
    End-to-end synthetic data generation pipeline.

    Parameters
    ----------
    method : str
        Generation method for statistical generators: "rule_only" | "ctgan" |
        "smote" | "both".  Rule-based and perturbation are always applied.
    n_rule_samples : int
        Number of rule-based late_non_blocking rows to generate.
    n_ctgan_samples : int
        Number of CTGAN rows per class (when applicable).
    n_smote_per_class : int
        Target count per class for SMOTE oversampling (when applicable).
    output_dir : Path | None
        Directory for output files. Defaults to data/sandbox/.
    random_seed : int
        Seed for reproducibility.
    """

    def __init__(
        self,
        method: str = "both",
        n_rule_samples: int = 60,
        n_ctgan_samples: int = 50,
        n_smote_per_class: int = 50,
        output_dir: Optional[Path] = None,
        random_seed: int = 42,
    ) -> None:
        self.method = method
        self.n_rule_samples = n_rule_samples
        self.n_ctgan_samples = n_ctgan_samples
        self.n_smote_per_class = n_smote_per_class
        self.random_seed = random_seed

        settings = get_settings()
        self.output_dir = output_dir or (settings.data_dir / "sandbox")
        self.output_dir.mkdir(parents=True, exist_ok=True)

        self._cfg = _load_config()
        self._max_synthetic_ratio: float = float(
            self._cfg.get("max_synthetic_ratio", 0.95)
        )
        self._min_samples_for_ctgan: int = int(
            self._cfg.get("min_samples_for_ctgan", 20)
        )
        self._min_samples_for_smote: int = int(
            self._cfg.get("min_samples_for_smote", 5)
        )
        self._min_examples_per_class: int = int(
            self._cfg.get("min_examples_per_class", 20)
        )

        # Per-class generation tracking (for report)
        self._class_info: dict[str, _ClassGenInfo] = {
            tc: _ClassGenInfo(tc) for tc in ALL_CLASSES
        }
        self._validation_results: dict = {}

        # Split tracking
        self._train_class_counts: dict[str, int] = {}
        self._test_class_counts: dict[str, int] = {}

    # =========================================================================
    # Public API
    # =========================================================================

    def run(self) -> pd.DataFrame:
        """
        Run the full pipeline.

        Returns
        -------
        pd.DataFrame
            The final merged training dataset (real + synthetic).
            Always contains >= min_examples_per_class rows per class.
        """
        logger.info("=== Synthetic Data Pipeline START (method=%s) ===", self.method)

        # ------------------------------------------------------------------
        # Step 1 — Load canonical real data
        # ------------------------------------------------------------------
        canonical_path = self.output_dir / "orders_canonical.parquet"
        if not canonical_path.exists():
            raise FileNotFoundError(
                f"Canonical Parquet not found at {canonical_path}. "
                "Run: python -m pipelines.ingest_pipeline --source csv first."
            )

        real_df = pd.read_parquet(canonical_path)
        labelled_real = real_df[real_df["target_class"].notna()].copy()
        labelled_real["data_source"] = "real"
        self._n_real_total = len(labelled_real)

        for tc in ALL_CLASSES:
            n = int((labelled_real["target_class"] == tc).sum())
            self._class_info[tc].n_real = n

        logger.info(
            "Step 1 -- Loaded %d canonical rows (%d labelled, %d unlabelled)",
            len(real_df), self._n_real_total, len(real_df) - self._n_real_total,
        )
        for tc in ALL_CLASSES:
            logger.info("  Class '%s': %d real examples", tc, self._class_info[tc].n_real)

        # ------------------------------------------------------------------
        # Step 2 — Build validators once (uses real examples as reference)
        # ------------------------------------------------------------------
        from synthetic.validator import SyntheticValidator

        # Standard validator: rejects near-exact copies of real rows (distance < 0.01).
        # Used for rule-based, CTGAN, and SMOTE rows.
        validator = SyntheticValidator(
            real_df=labelled_real,
            min_distance_threshold=0.01,
        )
        # Permissive validator for perturbation rows: skip near-dup check.
        # Perturbations are intentionally close to source rows — only schema
        # and business coherence constraints matter.
        perturb_validator = SyntheticValidator(
            real_df=labelled_real,
            min_distance_threshold=0.0,
        )

        # ------------------------------------------------------------------
        # Step 3 — Generate synthetic examples for each class until floor met
        # ------------------------------------------------------------------
        all_synth_parts: list[pd.DataFrame] = []

        for tc in ALL_CLASSES:
            synth_for_class = self._generate_for_class(
                target_class=tc,
                real_df=real_df,
                labelled_real=labelled_real,
                validator=validator,
                perturb_validator=perturb_validator,
            )
            if not synth_for_class.empty:
                all_synth_parts.append(synth_for_class)

        # ------------------------------------------------------------------
        # Step 4 — Merge all sources
        # ------------------------------------------------------------------
        parts: list[pd.DataFrame] = [labelled_real]
        parts.extend(all_synth_parts)

        training_df = pd.concat(parts, ignore_index=True)

        n_synth_total = sum(len(p) for p in all_synth_parts)
        logger.info(
            "Step 4 -- Merged: %d total rows (real=%d, synthetic=%d)",
            len(training_df), self._n_real_total, n_synth_total,
        )
        for tc in ALL_CLASSES:
            total_tc = int((training_df["target_class"] == tc).sum())
            logger.info(
                "  Class '%s': %d total (real=%d, rule=%d, ctgan=%d, smote=%d, perturb=%d)",
                tc, total_tc,
                self._class_info[tc].n_real,
                self._class_info[tc].n_rule_based,
                self._class_info[tc].n_ctgan,
                self._class_info[tc].n_smote,
                self._class_info[tc].n_perturbation,
            )

        # ------------------------------------------------------------------
        # Step 5 — Save training dataset
        # ------------------------------------------------------------------
        training_path = self.output_dir / "training_dataset.parquet"
        training_df.to_parquet(training_path, index=False)
        logger.info("Step 5 -- Saved training dataset to %s", training_path)

        # ------------------------------------------------------------------
        # Step 6 — Stratified train/test split
        # ------------------------------------------------------------------
        self._save_splits(training_df)

        logger.info("=== Synthetic Data Pipeline DONE ===")
        return training_df

    # =========================================================================
    # Per-class generation (cascade: rule/ctgan/smote/perturbation)
    # =========================================================================

    def _generate_for_class(
        self,
        target_class: str,
        real_df: pd.DataFrame,
        labelled_real: pd.DataFrame,
        validator: "SyntheticValidator",  # type: ignore[name-defined]
        perturb_validator: "SyntheticValidator",  # type: ignore[name-defined]
    ) -> pd.DataFrame:
        """
        Generate synthetic examples for a single class using the cascade.

        Returns a DataFrame of validated synthetic rows for this class.
        """
        info = self._class_info[target_class]
        n_have = info.n_real
        n_need = max(0, self._min_examples_per_class - n_have)

        if n_need == 0:
            logger.info(
                "Class '%s': already has %d >= %d examples — no generation needed",
                target_class, n_have, self._min_examples_per_class,
            )
            info.method_used = "none (sufficient real data)"
            return pd.DataFrame()

        logger.info(
            "Class '%s': have %d real, need %d more to reach floor of %d",
            target_class, n_have, n_need, self._min_examples_per_class,
        )

        # Collect validated synthetic rows across methods
        accepted_parts: list[pd.DataFrame] = []
        n_accepted = 0

        # ---- Method A: Rule-based (always for late_non_blocking; perturbation for others) ----
        if target_class == "late_non_blocking":
            rule_rows = self._run_rule_based(real_df, n_samples=max(n_need, self.n_rule_samples))
            if not rule_rows.empty:
                valid_rule, val_result = validator.validate(rule_rows)
                self._validation_results[f"rule_based_{target_class}"] = val_result
                info.n_rule_based = len(valid_rule)
                n_accepted += info.n_rule_based
                if not valid_rule.empty:
                    accepted_parts.append(valid_rule)
                    info.method_used = "rule_based"
                    logger.info("  Rule-based: %d accepted", info.n_rule_based)
        else:
            # For on_time / late_blocking: perturbation from the start is always applied
            # as the baseline (we'll supplement with CTGAN/SMOTE below if requested)
            pass

        # ---- Method B: CTGAN (if requested and enough data) ----
        if self.method in ("ctgan", "both") and n_accepted < n_need:
            # Build enriched dataset = real + rule-based already generated
            enriched = pd.concat(
                [labelled_real] + accepted_parts,
                ignore_index=True,
            )
            class_enriched = enriched[enriched["target_class"] == target_class]
            n_class_enriched = len(class_enriched)

            if n_class_enriched >= self._min_samples_for_ctgan:
                ctgan_rows = self._run_ctgan(
                    enriched=enriched,
                    target_class=target_class,
                    n_samples=max(n_need - n_accepted, self.n_ctgan_samples),
                )
                if not ctgan_rows.empty:
                    valid_ctgan, val_result = validator.validate(ctgan_rows)
                    self._validation_results[f"ctgan_{target_class}"] = val_result
                    info.n_ctgan = len(valid_ctgan)
                    n_accepted += info.n_ctgan
                    if not valid_ctgan.empty:
                        accepted_parts.append(valid_ctgan)
                        info.method_used = "ctgan"
            else:
                logger.warning(
                    "Class '%s': CTGAN skipped — only %d enriched examples "
                    "(need >= %d for stable GAN training). "
                    "Cascading to SMOTE/perturbation.",
                    target_class, n_class_enriched, self._min_samples_for_ctgan,
                )
                info.skip_reason += (
                    f"CTGAN skipped: only {n_class_enriched} examples "
                    f"(min {self._min_samples_for_ctgan}). "
                )

        # ---- Method C: SMOTE (if requested and enough data) ----
        if self.method in ("smote", "both") and n_accepted < n_need:
            enriched = pd.concat(
                [labelled_real] + accepted_parts,
                ignore_index=True,
            )
            class_enriched = enriched[enriched["target_class"] == target_class]
            n_class_enriched = len(class_enriched)

            if n_class_enriched >= self._min_samples_for_smote:
                smote_rows = self._run_smote(
                    enriched=enriched,
                    target_class=target_class,
                    n_target=max(n_need - n_accepted + n_class_enriched, self.n_smote_per_class),
                )
                if not smote_rows.empty:
                    valid_smote, val_result = validator.validate(smote_rows)
                    self._validation_results[f"smote_{target_class}"] = val_result
                    info.n_smote = len(valid_smote)
                    n_accepted += info.n_smote
                    if not valid_smote.empty:
                        accepted_parts.append(valid_smote)
                        if info.method_used == "none":
                            info.method_used = "smote"
                        else:
                            info.method_used += "+smote"
            else:
                logger.warning(
                    "Class '%s': SMOTE skipped — only %d enriched examples "
                    "(need >= %d). Falling back to perturbation.",
                    target_class, n_class_enriched, self._min_samples_for_smote,
                )
                info.skip_reason += (
                    f"SMOTE skipped: only {n_class_enriched} examples "
                    f"(min {self._min_samples_for_smote}). "
                )

        # ---- Method D: Gaussian perturbation (always available fallback) ----
        if n_accepted < n_need:
            still_need = n_need - n_accepted
            class_real = labelled_real[labelled_real["target_class"] == target_class]

            perturb_rows = self._run_perturbation(
                class_df=class_real,
                target_class=target_class,
                reference_df=labelled_real,
                n_target=still_need,
            )
            if not perturb_rows.empty:
                # Use permissive validator (no near-dup check) — perturbations
                # are intentionally close to source rows by design.
                valid_perturb, val_result = perturb_validator.validate(perturb_rows)
                self._validation_results[f"perturbation_{target_class}"] = val_result
                info.n_perturbation = len(valid_perturb)
                n_accepted += info.n_perturbation
                if not valid_perturb.empty:
                    accepted_parts.append(valid_perturb)
                    if info.method_used in ("none", ""):
                        info.method_used = "perturbation"
                    else:
                        info.method_used += "+perturbation"
            else:
                logger.warning(
                    "Class '%s': perturbation produced no rows — no real examples to perturb from.",
                    target_class,
                )
                if info.method_used == "none":
                    info.method_used = "none (no source rows)"

        if accepted_parts:
            return pd.concat(accepted_parts, ignore_index=True)
        return pd.DataFrame()

    # =========================================================================
    # Individual generator wrappers
    # =========================================================================

    def _run_rule_based(self, real_df: pd.DataFrame, n_samples: int) -> pd.DataFrame:
        """Run rule-based augmentor for late_non_blocking."""
        from synthetic.rule_based_augmentation import RuleBasedAugmentor
        augmentor = RuleBasedAugmentor(n_samples=n_samples, random_seed=self.random_seed)
        try:
            return augmentor.generate(real_df)
        except Exception as exc:
            logger.error("Rule-based augmentation failed: %s", exc)
            return pd.DataFrame()

    def _run_ctgan(
        self,
        enriched: pd.DataFrame,
        target_class: str,
        n_samples: int,
    ) -> pd.DataFrame:
        """Run CTGAN for a single class; returns empty DataFrame on failure with explicit log."""
        try:
            from synthetic.ctgan_generator import CTGANGenerator
        except ImportError:
            logger.warning("CTGANGenerator import failed — sdv not installed?")
            return pd.DataFrame()

        gen = CTGANGenerator(n_samples=n_samples, epochs=self._cfg.get("ctgan", {}).get("epochs", 300))
        # Filter enriched to just this class for per-class training
        class_df = enriched[enriched["target_class"] == target_class].copy()
        if class_df.empty:
            logger.warning(
                "CTGAN for class '%s': empty source — skipping.", target_class
            )
            return pd.DataFrame()

        try:
            result = gen.generate(class_df)
            if result.empty:
                logger.warning(
                    "CTGAN for class '%s': generator returned 0 rows — "
                    "check sdv version and source data size.", target_class
                )
            return result
        except Exception as exc:
            logger.error(
                "CTGAN for class '%s' failed: %s. Cascading to next method.", target_class, exc
            )
            return pd.DataFrame()

    def _run_smote(
        self,
        enriched: pd.DataFrame,
        target_class: str,
        n_target: int,
    ) -> pd.DataFrame:
        """Run SMOTE to oversample a single class; returns empty DataFrame on failure."""
        try:
            from synthetic.smote_generator import SMOTEGenerator
        except ImportError:
            logger.warning("SMOTEGenerator import failed — imbalanced-learn not installed?")
            return pd.DataFrame()

        gen = SMOTEGenerator(
            n_target_per_class=n_target,
            random_state=self.random_seed,
        )
        # Pass full enriched (multi-class) — SMOTE oversample per class internally
        try:
            result = gen.generate(enriched)
            if result.empty:
                logger.warning(
                    "SMOTE for class '%s': generator returned 0 rows. "
                    "Possible cause: class already at target count, or k_neighbors too large.",
                    target_class,
                )
            else:
                # Filter to only this class's new rows
                result = result[result["target_class"] == target_class]
            return result
        except Exception as exc:
            logger.error(
                "SMOTE for class '%s' failed: %s. Cascading to perturbation.", target_class, exc
            )
            return pd.DataFrame()

    def _run_perturbation(
        self,
        class_df: pd.DataFrame,
        target_class: str,
        reference_df: pd.DataFrame,
        n_target: int,
    ) -> pd.DataFrame:
        """Run Gaussian perturbation for a single class."""
        from synthetic.perturbation_generator import GaussianPerturbationGenerator

        gen = GaussianPerturbationGenerator(random_state=self.random_seed)
        try:
            return gen.generate_for_class(
                class_df=class_df,
                target_class=target_class,
                reference_df=reference_df,
                n_target=n_target,
            )
        except Exception as exc:
            logger.error(
                "Perturbation for class '%s' failed: %s", target_class, exc
            )
            return pd.DataFrame()

    # =========================================================================
    # Train / test split (stratified, guarantees all classes in both sets)
    # =========================================================================

    def _save_splits(self, training_df: pd.DataFrame) -> None:
        """
        Stratified train/test split ensuring >= 1 example per class in BOTH sets.

        Strategy
        --------
        1. For each class, keep exactly ``MIN_PER_CLASS_PER_SPLIT`` rows in
           the test set (choosing real rows first when available).
        2. All remaining rows go to train.
        3. Additionally, a standard 80/20 stratified split is applied on the
           remaining rows to distribute synthetic data between train and test.

        This guarantees:
        - All 3 classes appear in test (evaluatable on synthetic if no real data).
        - All 3 classes appear in train (model can learn from all classes).
        - Real rows appear in test whenever available (gold-label evaluation).
        """
        from sklearn.model_selection import train_test_split as _tts

        train_parts: list[pd.DataFrame] = []
        test_parts: list[pd.DataFrame] = []

        for tc in ALL_CLASSES:
            tc_df = training_df[training_df["target_class"] == tc].copy()
            if tc_df.empty:
                logger.warning("Class '%s' has 0 rows — cannot include in splits.", tc)
                continue

            # Prefer real rows for the test set (gold label)
            real_tc = tc_df[tc_df["data_source"] == "real"]
            synth_tc = tc_df[tc_df["data_source"] != "real"]

            # Pick up to MIN_PER_CLASS_PER_SPLIT rows for test (real first)
            test_from_real = real_tc.head(MIN_PER_CLASS_PER_SPLIT)
            remaining_real = real_tc.iloc[len(test_from_real):]
            # If we didn't get enough from real, take from synthetic
            n_still_needed_test = max(0, MIN_PER_CLASS_PER_SPLIT - len(test_from_real))
            test_from_synth_reserve = synth_tc.head(n_still_needed_test)
            remaining_synth = synth_tc.iloc[len(test_from_synth_reserve):]

            test_reserved = pd.concat([test_from_real, test_from_synth_reserve], ignore_index=True)
            remaining = pd.concat([remaining_real, remaining_synth], ignore_index=True)

            # Now split remaining 80/20 into additional train/test
            if len(remaining) >= 2:
                try:
                    train_rem, test_rem = _tts(
                        remaining,
                        test_size=TEST_SIZE,
                        random_state=self.random_seed,
                    )
                except ValueError:
                    train_rem = remaining
                    test_rem = pd.DataFrame()
            else:
                # Too few to split — put all in train (test already has the reserve)
                train_rem = remaining
                test_rem = pd.DataFrame()

            # Final for this class — safe concat (guard against empty lists)
            train_non_empty = [r for r in [train_rem] if not r.empty]
            test_non_empty = [r for r in [test_reserved, test_rem] if not r.empty]

            if train_non_empty:
                train_tc = pd.concat(train_non_empty, ignore_index=True)
                train_parts.append(train_tc)

            if test_non_empty:
                test_tc = pd.concat(test_non_empty, ignore_index=True)
                test_parts.append(test_tc)

        train_df = pd.concat(train_parts, ignore_index=True) if train_parts else pd.DataFrame()
        test_df = pd.concat(test_parts, ignore_index=True) if test_parts else pd.DataFrame()

        # Track per-class counts for report
        for tc in ALL_CLASSES:
            self._train_class_counts[tc] = int(
                (train_df["target_class"] == tc).sum() if not train_df.empty else 0
            )
            self._test_class_counts[tc] = int(
                (test_df["target_class"] == tc).sum() if not test_df.empty else 0
            )

        train_path = self.output_dir / "train.parquet"
        test_path = self.output_dir / "test.parquet"
        train_df.to_parquet(train_path, index=False)
        test_df.to_parquet(test_path, index=False)

        n_real_in_test = int(
            (test_df["data_source"] == "real").sum() if not test_df.empty else 0
        )
        logger.info(
            "Train/test split: %d train rows, %d test rows (%d real in test)",
            len(train_df), len(test_df), n_real_in_test,
        )
        for tc in ALL_CLASSES:
            logger.info(
                "  '%s': train=%d, test=%d",
                tc, self._train_class_counts[tc], self._test_class_counts[tc],
            )

        # Warn if any class has 0 examples in train or test
        for tc in ALL_CLASSES:
            if self._train_class_counts.get(tc, 0) == 0:
                logger.warning(
                    "Class '%s' has 0 examples in TRAIN set — model cannot learn this class!",
                    tc,
                )
            if self._test_class_counts.get(tc, 0) == 0:
                logger.warning(
                    "Class '%s' has 0 examples in TEST set — cannot evaluate this class!",
                    tc,
                )

    # =========================================================================
    # Quality report
    # =========================================================================

    def generate_report(self, training_df: pd.DataFrame) -> Path:
        """Generate synthetic_quality_report.md."""
        report_path = self.output_dir / "synthetic_quality_report.md"
        cfg = self._cfg
        total = len(training_df)

        lines: list[str] = [
            "# SmartOrder ML -- Synthetic Data Quality Report\n",
            f"**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}  ",
            f"**Method:** `{self.method}`  \n",
            "---\n",
        ]

        # -- 1. Source counts
        source_notes = {
            "real": "Observed orders from CSV seed",
            "rule_based": "**HYPOTHESIS** -- business rule (see disclaimer below)",
            "ctgan": "Statistically generated (SDV CTGAN)",
            "smote": "Interpolated (imbalanced-learn SMOTE)",
            "perturbation": "Gaussian noise perturbation (fallback)",
        }
        lines += [
            "## 1. Examples by Data Source\n",
            "| Source | Count | % of Total | Notes |",
            "|--------|-------|------------|-------|",
        ]
        for src, count in training_df["data_source"].value_counts().items():
            pct = 100 * count / total if total > 0 else 0
            note = source_notes.get(str(src), "")
            lines.append(f"| `{src}` | {count} | {pct:.1f}% | {note} |")
        lines.append("")

        n_synth = total - self._n_real_total
        synth_ratio = n_synth / total if total > 0 else 0
        if synth_ratio > self._max_synthetic_ratio:
            lines += [
                "> [!CAUTION]",
                f"> **Synthetic ratio is {synth_ratio:.0%}** -- above the "
                f"{self._max_synthetic_ratio:.0%} warning threshold.  "
                "A model trained on this dataset may overfit to synthetic patterns.\n",
            ]
        lines.append("---\n")

        # -- 2. Per-class generation method + row counts (AUDIT TABLE)
        lines += [
            "## 2. Generation Method and Counts per Class\n",
            "> This table answers: *how many rows per class, by which method?*\n",
            "| Class | Real | Rule-based | CTGAN | SMOTE | Perturbation | Total | Method used | Notes |",
            "|-------|------|------------|-------|-------|-------------|-------|-------------|-------|",
        ]
        for tc in ALL_CLASSES:
            info = self._class_info[tc]
            tc_total = info.total()
            skip = info.skip_reason or "-"
            lines.append(
                f"| `{tc}` | {info.n_real} | {info.n_rule_based} | {info.n_ctgan} "
                f"| {info.n_smote} | {info.n_perturbation} | **{tc_total}** "
                f"| `{info.method_used}` | {skip} |"
            )
        lines.append("\n---\n")

        # -- 3. Train / test breakdown per class
        lines += [
            "## 3. Train / Test Split Composition\n",
            "> Guarantees >= 1 example per class in both train and test sets.\n",
            "| Class | Train | Test | Real in test |",
            "|-------|-------|------|-------------|",
        ]
        train_df_path = self.output_dir / "train.parquet"
        test_df_path = self.output_dir / "test.parquet"
        train_exists = train_df_path.exists()
        test_exists = test_df_path.exists()

        for tc in ALL_CLASSES:
            n_train = self._train_class_counts.get(tc, "N/A")
            n_test = self._test_class_counts.get(tc, "N/A")
            # Real in test
            if test_exists:
                test_df = pd.read_parquet(test_df_path)
                n_real_test = int(
                    ((test_df["target_class"] == tc) & (test_df["data_source"] == "real")).sum()
                )
            else:
                n_real_test = "N/A"
            lines.append(f"| `{tc}` | {n_train} | {n_test} | {n_real_test} |")

        lines.append("\n---\n")

        # -- 4. LATE_NON_BLOCKING disclaimer (MANDATORY)
        lines += [
            "## 4. IMPORTANT: `late_non_blocking` Class Disclaimer\n",
            "> [!CAUTION]",
            "> **ALL `late_non_blocking` examples are synthetic hypotheses, NOT observed data.**",
            ">",
            "> **No real orders with this label exist in the source CSV.**",
            ">",
            "> The label is assigned by the following business rule:",
            f">   - Delay `d` where `{cfg.get('late_non_blocking_min_delay_days', 1)} <= d <= "
            f"{cfg.get('late_non_blocking_threshold_days', 14)}` days past `date_previsionnelle`",
            ">   - Order is **not** in BLOQUE status",
            ">   - Does NOT have `postes_en_retard > 0` AND urgence in {HAUTE, CRITIQUE}",
            ">",
            "> **This threshold is configured in `config/model_config.yaml::"
            "synthetic.late_non_blocking_threshold_days`.**",
            ">",
            "> **BEFORE PRODUCTION:** obtain real observed examples of this class and "
            "retrain the model.",
            "",
            "---\n",
        ]

        # -- 5. Statistical comparison
        lines += [
            "## 5. Feature Distribution Comparison (Real vs Synthetic)\n",
            "| Feature | Real mean | Real std | Synth mean | Synth std | Delta mean |",
            "|---------|-----------|----------|------------|-----------|------------|",
        ]
        real_only = training_df[training_df["data_source"] == "real"]
        synth_only = training_df[training_df["data_source"] != "real"]
        for feat in ["montant_total", "nb_lignes", "taux_livraison",
                     "fournisseur_taux_retard", "fournisseur_score_perf"]:
            if feat not in training_df.columns:
                continue
            r_mean = pd.to_numeric(real_only[feat], errors="coerce").mean()
            r_std = pd.to_numeric(real_only[feat], errors="coerce").std()
            s_mean = pd.to_numeric(synth_only[feat], errors="coerce").mean() if not synth_only.empty else float("nan")
            s_std = pd.to_numeric(synth_only[feat], errors="coerce").std() if not synth_only.empty else float("nan")
            delta = abs(s_mean - r_mean) if not (np.isnan(s_mean) or np.isnan(r_mean)) else float("nan")
            flag = " [!]" if (not np.isnan(delta) and r_mean > 0 and delta / abs(r_mean) > 0.5) else ""
            lines.append(
                f"| `{feat}` | {r_mean:.2f} | {r_std:.2f} "
                f"| {s_mean:.2f} | {s_std:.2f} | {delta:.2f}{flag} |"
            )
        lines += ["", "> **[!]** = synthetic mean deviates >50% from real mean -- review.\n", "---\n"]

        # -- 6. Validation summaries
        lines += ["## 6. Validation Summary\n"]
        for source, val_result in self._validation_results.items():
            lines.append(f"### `{source}`\n")
            lines.append(f"```\n{val_result.summary()}\n```\n")
        lines.append("---\n")

        # -- 7. Final audit answer
        n_rule = sum(i.n_rule_based for i in self._class_info.values())
        n_ctgan_total = sum(i.n_ctgan for i in self._class_info.values())
        n_smote_total = sum(i.n_smote for i in self._class_info.values())
        n_perturb_total = sum(i.n_perturbation for i in self._class_info.values())

        lines += [
            "## 7. Summary (Audit Answer)\n",
            "| Metric | Value |",
            "|--------|-------|",
            f"| Total training rows | {total} |",
            f"| Real (observed) | {self._n_real_total} |",
            f"| Rule-based (`late_non_blocking`) | {n_rule} |",
            f"| CTGAN-generated | {n_ctgan_total} |",
            f"| SMOTE-generated | {n_smote_total} |",
            f"| Perturbation-generated | {n_perturb_total} |",
            f"| Synthetic total | {n_synth} |",
            f"| Synthetic ratio | {synth_ratio:.1%} |",
            "",
            "> **Answer to the audit question:**  ",
            f"> *{self._n_real_total} rows are real observations.*  ",
            f"> *{n_rule} rows are business-rule hypotheses (`late_non_blocking`).*  ",
            f"> *{n_ctgan_total} rows are statistically generated (CTGAN).*  ",
            f"> *{n_smote_total} rows are statistically generated (SMOTE).*  ",
            f"> *{n_perturb_total} rows are Gaussian perturbations (fallback).*  ",
        ]

        report_path.write_text("\n".join(lines), encoding="utf-8")
        logger.info("Quality report saved to %s", report_path)
        return report_path


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="SmartOrder ML -- Synthetic Data Pipeline"
    )
    p.add_argument(
        "--method",
        choices=["rule_only", "ctgan", "smote", "both"],
        default="both",
        help="Statistical generation method (rule-based and perturbation always active)",
    )
    p.add_argument(
        "--n-rule", type=int, default=60,
        help="Number of rule-based late_non_blocking rows (default: 60)",
    )
    p.add_argument(
        "--n-ctgan", type=int, default=50,
        help="Number of CTGAN rows per class (default: 50)",
    )
    p.add_argument(
        "--n-smote", type=int, default=50,
        help="Target count per class for SMOTE (default: 50)",
    )
    p.add_argument("--report", action="store_true", help="Generate quality report")
    p.add_argument("--seed", type=int, default=42, help="Random seed")
    return p


if __name__ == "__main__":
    setup_logging(level="INFO", fmt="text")
    args = _build_parser().parse_args()

    pipeline = SyntheticPipeline(
        method=args.method,
        n_rule_samples=args.n_rule,
        n_ctgan_samples=args.n_ctgan,
        n_smote_per_class=args.n_smote,
        random_seed=args.seed,
    )

    training_df = pipeline.run()
    print(f"\n[OK] Training dataset: {len(training_df)} rows")
    print(f"     Source breakdown: {training_df['data_source'].value_counts().to_dict()}")
    print(f"     Class breakdown:  {training_df['target_class'].value_counts().to_dict()}")

    if args.report:
        report_path = pipeline.generate_report(training_df)
        print(f"[Report] {report_path}")
