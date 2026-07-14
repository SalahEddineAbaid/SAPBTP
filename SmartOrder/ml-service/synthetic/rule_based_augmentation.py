"""
SmartOrder ML — Rule-based synthetic data generator.

PURPOSE
-------
Generates synthetic ``late_non_blocking`` examples using a deterministic
business rule, NOT statistical interpolation.

WHY A RULE, NOT CTGAN/SMOTE?
-----------------------------
The real dataset contains **zero** observed ``late_non_blocking`` examples.
CTGAN and SMOTE are interpolation/generative models that require at least a
handful of real source examples to learn the feature distribution.  With zero
source examples they would either crash or generate meaningless noise.

The rule-based approach is the only honest alternative: it creates examples
whose labels are **hypotheses** about what a non-blocking delay would look like,
based on domain knowledge encoded as a configurable threshold.

TRACEABILITY REQUIREMENT
------------------------
All rows produced by this module carry:
    data_source = "rule_based"

This must remain visible in the final training dataset so the model evaluator
can distinguish rule-hypothesis examples from statistically-observed data.

BUSINESS RULE (configurable via config/model_config.yaml)
----------------------------------------------------------
An order is classified as ``late_non_blocking`` if ALL of the following hold:

    1. The actual delivery is delayed: delay_days = date_livraison_reelle
       - date_previsionnelle > 0

    2. The delay is within the non-blocking window:
       delay_days <= LATE_NON_BLOCKING_THRESHOLD_DAYS   (default: 14)
       delay_days >= LATE_NON_BLOCKING_MIN_DELAY_DAYS   (default: 1)

    3. The order is NOT in BLOQUE status.

    4. The combination (postes_en_retard > 0 AND urgence in {HAUTE, CRITIQUE})
       does NOT hold — those qualify as late_blocking.

SOURCE ROWS
-----------
We take the **unlabelled** in-flight orders from the canonical Parquet
(statut in {EN_LIVRAISON, EN_COURS, EN_ATTENTE}) and simulate a plausible
delivery date within the non-blocking window.  We do NOT modify real labelled
examples — they remain untouched in the dataset.

DISCLAIMER
----------
The class ``late_non_blocking`` in the final training dataset is ENTIRELY
based on this rule.  It must be validated against domain expertise and replaced
with real observations before any production deployment.
"""

from __future__ import annotations

import random
import uuid
from datetime import date, timedelta
from pathlib import Path
from typing import Optional

import pandas as pd
import yaml

from config.logging_config import get_logger
from config.settings import get_settings

logger = get_logger("synthetic.rule_based")

# ---------------------------------------------------------------------------
# Config loader
# ---------------------------------------------------------------------------

_CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "model_config.yaml"


def _load_synthetic_config() -> dict:
    """Load synthetic section of model_config.yaml."""
    with open(_CONFIG_PATH, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    return cfg.get("synthetic", {})


# ---------------------------------------------------------------------------
# Main generator
# ---------------------------------------------------------------------------

class RuleBasedAugmentor:
    """
    Generates synthetic ``late_non_blocking`` examples from unlabelled rows.

    The generated rows are based on a configurable business-rule threshold,
    NOT on statistical interpolation from observed data.

    Parameters
    ----------
    threshold_days : int
        Maximum delay (days past due) that still qualifies as non-blocking.
        Loaded from ``config/model_config.yaml::synthetic.late_non_blocking_threshold_days``.
        Override at construction time for testing.
    min_delay_days : int
        Minimum delay injected into generated examples (default 1 day).
    n_samples : int
        Target number of synthetic ``late_non_blocking`` rows to generate.
    random_seed : int
        Seed for reproducibility.
    """

    ELIGIBLE_STATUTS = {"EN_LIVRAISON", "EN_COURS", "EN_ATTENTE"}

    def __init__(
        self,
        threshold_days: Optional[int] = None,
        min_delay_days: Optional[int] = None,
        n_samples: int = 60,
        random_seed: int = 42,
    ) -> None:
        cfg = _load_synthetic_config()
        self.threshold_days = threshold_days if threshold_days is not None else int(
            cfg.get("late_non_blocking_threshold_days", 14)
        )
        self.min_delay_days = min_delay_days if min_delay_days is not None else int(
            cfg.get("late_non_blocking_min_delay_days", 1)
        )
        self.n_samples = n_samples
        self.rng = random.Random(random_seed)

        logger.info(
            "RuleBasedAugmentor initialized: threshold=%d days, min_delay=%d days, n_samples=%d",
            self.threshold_days,
            self.min_delay_days,
            self.n_samples,
        )

    def generate(self, canonical_df: pd.DataFrame) -> pd.DataFrame:
        """
        Generate synthetic ``late_non_blocking`` rows from unlabelled orders.

        Parameters
        ----------
        canonical_df : pd.DataFrame
            Full canonical DataFrame (real + labelled + unlabelled).
            Only unlabelled rows with eligible statuts are used as templates.

        Returns
        -------
        pd.DataFrame
            Synthetic rows with ``target_class = 'late_non_blocking'``,
            ``data_source = 'rule_based'``, and a simulated
            ``date_livraison_reelle``.

        Notes
        -----
        - Only unlabelled rows are used as templates (``target_class`` is null).
        - We exclude BLOQUE orders and orders with (postes_en_retard > 0 AND
          urgence in {HAUTE, CRITIQUE}) from the template pool, as those would
          map to ``late_blocking`` under the canonical rule.
        - ``order_id`` and ``numero_sap`` are replaced with fresh UUIDs to
          ensure no duplication with real rows.
        """
        templates = self._select_templates(canonical_df)
        if templates.empty:
            logger.warning("No eligible unlabelled rows found — cannot generate late_non_blocking")
            return pd.DataFrame()

        logger.info(
            "Generating %d late_non_blocking rows from %d templates (threshold=%d days)",
            self.n_samples,
            len(templates),
            self.threshold_days,
        )

        rows = []
        for i in range(self.n_samples):
            # Sample a template (with replacement if needed)
            template = templates.iloc[i % len(templates)].copy()
            row = self._build_row(template, i)
            rows.append(row)

        result = pd.DataFrame(rows)

        # Validate the delay constraint is respected
        assert (result["target_delay_days"] >= self.min_delay_days).all(), (
            "Some generated rows have delay_days below min_delay_days — logic error"
        )
        assert (result["target_delay_days"] <= self.threshold_days).all(), (
            "Some generated rows exceed the non-blocking threshold — logic error"
        )

        logger.info("Generated %d late_non_blocking rows", len(result))
        return result

    # --------------------------------------------------------
    # Helpers
    # --------------------------------------------------------

    def _select_templates(self, df: pd.DataFrame) -> pd.DataFrame:
        """Select rows eligible as templates for late_non_blocking generation."""
        # Only unlabelled rows
        unlabelled_mask = df["target_class"].isna()

        # Only eligible statuts
        statut_mask = df["statut"].isin(self.ELIGIBLE_STATUTS)

        # Exclude potential late_blocking: BLOQUE or (postes_en_retard > 0 AND urgence high)
        if "statut" in df.columns:
            bloque_mask = df["statut"] == "BLOQUE"
        else:
            bloque_mask = pd.Series(False, index=df.index)

        if "postes_en_retard" in df.columns and "urgence" in df.columns:
            high_urgence_late = (
                (df["postes_en_retard"] > 0)
                & (df["urgence"].isin(["HAUTE", "CRITIQUE"]))
            )
        else:
            high_urgence_late = pd.Series(False, index=df.index)

        eligible = df[unlabelled_mask & statut_mask & ~bloque_mask & ~high_urgence_late]
        return eligible.reset_index(drop=True)

    def _build_row(self, template: pd.Series, idx: int) -> dict:
        """Build a single synthetic late_non_blocking row from a template."""
        # Assign a fresh unique ID to avoid confusion with real orders
        synth_id = f"synth-rule-{uuid.uuid4()}"
        synth_sap = f"SYNT{idx:06d}"

        # Simulate delay within [min_delay_days, threshold_days]
        delay_days = self.rng.randint(self.min_delay_days, self.threshold_days)

        # Compute synthetic delivery date
        try:
            date_prev = pd.to_datetime(template["date_previsionnelle"]).date()
        except Exception:
            date_prev = date.today()

        date_livraison_reelle = date_prev + timedelta(days=delay_days)

        # Adjust statut to LIVRE (order was eventually delivered, just late)
        row = dict(template)
        row["order_id"] = synth_id
        row["numero_sap"] = synth_sap
        row["statut"] = "LIVRE"
        row["date_livraison_reelle"] = date_livraison_reelle
        row["target_class"] = "late_non_blocking"
        row["target_delay_days"] = delay_days
        row["data_source"] = "rule_based"

        # Ensure marqueur_suppression is False (never synthesize deletions)
        row["marqueur_suppression"] = False

        return row


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def _run() -> None:
    """Generate and save rule-based synthetic examples."""
    from config.logging_config import setup_logging
    setup_logging(level="INFO", fmt="text")

    settings = get_settings()
    parquet_path = settings.data_dir / "sandbox" / "orders_canonical.parquet"

    if not parquet_path.exists():
        logger.error("Canonical Parquet not found at %s — run ingest_pipeline first.", parquet_path)
        return

    canonical_df = pd.read_parquet(parquet_path)
    logger.info("Loaded %d canonical rows from %s", len(canonical_df), parquet_path)

    augmentor = RuleBasedAugmentor()
    synthetic_df = augmentor.generate(canonical_df)

    if synthetic_df.empty:
        logger.error("No synthetic rows generated — check template pool.")
        return

    output_path = settings.data_dir / "sandbox" / "rule_based_synthetic.parquet"
    synthetic_df.to_parquet(output_path, index=False)
    logger.info("Saved %d rule-based synthetic rows to %s", len(synthetic_df), output_path)

    print(f"\n[OK] Rule-based augmentation: {len(synthetic_df)} late_non_blocking rows")
    print(f"     Threshold: {augmentor.threshold_days} days")
    print(f"     Output: {output_path}")


if __name__ == "__main__":
    _run()
