"""
SmartOrder ML — SMOTE synthetic data generator.

A lighter-weight alternative to CTGAN, using SMOTE from imbalanced-learn.
SMOTE (Synthetic Minority Over-sampling TEchnique) interpolates between
existing examples in feature space.

WHEN TO USE SMOTE vs CTGAN
---------------------------
- SMOTE is faster and more deterministic than CTGAN.
- SMOTE only works on numeric features — categoricals must be encoded first
  and then decoded after generation (with some loss of fidelity).
- SMOTE requires at least ``k_neighbors + 1`` examples per class.
  With only 2-3 real examples of some classes, k_neighbors must be set to 1.
- For very small datasets, CTGAN (which uses a generative network) may
  produce more realistic feature distributions than SMOTE interpolation.

Use SMOTE when CTGAN is too slow or produces unstable results.

PREREQUISITES
-------------
    pip install imbalanced-learn>=0.12

NOTE: ``late_non_blocking`` rows must be seeded by rule_based_augmentation.py
before SMOTE is applied, for the same reason as with CTGAN.
"""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
import yaml

from config.logging_config import get_logger
from config.settings import get_settings

logger = get_logger("synthetic.smote")

_CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "model_config.yaml"

# Numeric features for SMOTE (categoricals excluded — SMOTE is numeric-only)
_SMOTE_NUMERIC_COLS = [
    "montant_total",
    "nb_lignes",
    "quantite_totale_commandee",
    "quantite_totale_livree",
    "taux_livraison",
    "postes_en_retard",
    "nb_categories_distinctes",
    "fournisseur_taux_retard",
    "fournisseur_delai_moyen",
    "fournisseur_score_perf",
    "score_priorite",
    "target_delay_days",
]

# Label encoding for target_class
_CLASS_MAP = {"on_time": 0, "late_non_blocking": 1, "late_blocking": 2}
_CLASS_INV = {v: k for k, v in _CLASS_MAP.items()}


def _load_smote_config() -> dict:
    with open(_CONFIG_PATH, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    return cfg.get("synthetic", {}).get("smote", {})


class SMOTEGenerator:
    """
    Generates synthetic rows using SMOTE from imbalanced-learn.

    Parameters
    ----------
    n_target_per_class : int
        Target number of examples per class after oversampling.
        Existing rows count toward this total.
    k_neighbors : int | None
        Number of nearest neighbors for SMOTE. Loaded from config if None.
    random_state : int
        Random seed.
    """

    def __init__(
        self,
        n_target_per_class: int = 50,
        k_neighbors: Optional[int] = None,
        random_state: Optional[int] = None,
    ) -> None:
        cfg = _load_smote_config()
        self.n_target_per_class = n_target_per_class
        self.k_neighbors = k_neighbors if k_neighbors is not None else int(cfg.get("k_neighbors", 3))
        self.random_state = random_state if random_state is not None else int(cfg.get("random_state", 42))

    def generate(self, enriched_df: pd.DataFrame) -> pd.DataFrame:
        """
        Over-sample minority classes using SMOTE.

        Parameters
        ----------
        enriched_df : pd.DataFrame
            Labelled rows (real + rule-based) with non-null ``target_class``.

        Returns
        -------
        pd.DataFrame
            *Only* the newly generated synthetic rows (not the originals),
            with ``data_source = 'smote'``.
        """
        try:
            from imblearn.over_sampling import SMOTE
        except ImportError:
            logger.error(
                "imbalanced-learn is not installed. Run: pip install imbalanced-learn>=0.12\n"
                "SMOTE generation skipped — returning empty DataFrame."
            )
            return pd.DataFrame()

        labelled = enriched_df[enriched_df["target_class"].notna()].copy()
        if labelled.empty:
            logger.warning("No labelled rows for SMOTE — returning empty DataFrame")
            return pd.DataFrame()

        # Check class sizes vs k_neighbors
        class_counts = labelled["target_class"].value_counts()
        # k_neighbors must be < smallest class count
        min_class_size = int(class_counts.min())
        effective_k = min(self.k_neighbors, max(1, min_class_size - 1))
        if effective_k != self.k_neighbors:
            logger.warning(
                "k_neighbors reduced from %d to %d (smallest class has %d examples)",
                self.k_neighbors, effective_k, min_class_size,
            )

        # Prepare numeric feature matrix
        available_cols = [c for c in _SMOTE_NUMERIC_COLS if c in labelled.columns]
        X = labelled[available_cols].apply(
            pd.to_numeric, errors="coerce"
        ).fillna(0.0).values

        # Encode target
        y = labelled["target_class"].map(_CLASS_MAP).values

        # Determine sampling strategy: bring each class up to n_target_per_class
        sampling_strategy = {}
        for label, count in class_counts.items():
            class_code = _CLASS_MAP.get(str(label))
            if class_code is not None and int(count) < self.n_target_per_class:
                sampling_strategy[class_code] = self.n_target_per_class

        if not sampling_strategy:
            logger.info("All classes already at target count — SMOTE not needed")
            return pd.DataFrame()

        smote = SMOTE(
            sampling_strategy=sampling_strategy,
            k_neighbors=effective_k,
            random_state=self.random_state,
        )

        try:
            X_res, y_res = smote.fit_resample(X, y)
        except Exception as exc:
            logger.error("SMOTE failed: %s", exc)
            return pd.DataFrame()

        # Extract only the newly generated rows (original rows are at the start)
        n_original = len(X)
        X_synth = X_res[n_original:]
        y_synth = y_res[n_original:]

        if len(X_synth) == 0:
            logger.info("SMOTE produced no new rows")
            return pd.DataFrame()

        # Build DataFrame from generated numeric features
        synth_df = pd.DataFrame(X_synth, columns=available_cols)
        synth_df["target_class"] = [_CLASS_INV.get(int(c), "unknown") for c in y_synth]
        synth_df["data_source"] = "smote"
        synth_df["order_id"] = [f"synth-smote-{uuid.uuid4()}" for _ in range(len(synth_df))]
        synth_df["numero_sap"] = [f"SMOT{i:06d}" for i in range(len(synth_df))]

        # Copy categorical columns from the most common real row (best effort)
        categorical_cols = [
            "statut", "urgence", "order_type", "devise",
            "fournisseur_pays", "company_code", "purchasing_org",
            "purchasing_group", "statut_approbation",
        ]
        mode_row = labelled[categorical_cols].mode().iloc[0] if categorical_cols else pd.Series()
        for col in categorical_cols:
            if col in mode_row.index:
                synth_df[col] = mode_row[col]

        # Set target_delay_days consistent with target_class
        synth_df["target_delay_days"] = synth_df.apply(
            lambda r: 0 if r["target_class"] == "on_time" else max(1, int(r.get("target_delay_days", 1))),
            axis=1,
        )

        # Set date_creation and date_previsionnelle from mode of real data
        for date_col in ["date_creation", "date_previsionnelle", "date_modification"]:
            if date_col in labelled.columns:
                mode_val = labelled[date_col].mode()
                if not mode_val.empty:
                    synth_df[date_col] = mode_val.iloc[0]

        logger.info(
            "SMOTE generated %d rows: %s",
            len(synth_df),
            synth_df["target_class"].value_counts().to_dict(),
        )
        return synth_df


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def _run() -> None:
    from config.logging_config import setup_logging
    setup_logging(level="INFO", fmt="text")

    settings = get_settings()
    sandbox = settings.data_dir / "sandbox"

    canonical_path = sandbox / "orders_canonical.parquet"
    rule_path = sandbox / "rule_based_synthetic.parquet"

    if not canonical_path.exists():
        logger.error("Canonical Parquet not found — run ingest_pipeline first.")
        return

    dfs = [pd.read_parquet(canonical_path)]
    if rule_path.exists():
        dfs.append(pd.read_parquet(rule_path))
    combined = pd.concat(dfs, ignore_index=True)

    generator = SMOTEGenerator(n_target_per_class=50)
    synthetic = generator.generate(combined)

    if synthetic.empty:
        logger.warning("No SMOTE rows generated.")
        return

    output = sandbox / "smote_synthetic.parquet"
    synthetic.to_parquet(output, index=False)
    logger.info("Saved %d SMOTE rows to %s", len(synthetic), output)
    print(f"\n[OK] SMOTE generation: {len(synthetic)} rows -> {output}")


if __name__ == "__main__":
    _run()
