"""
SmartOrder ML — Gaussian perturbation fallback generator.

This is the last-resort fallback in the generation cascade:
    CTGAN (>=20 examples) -> SMOTE (>=5 examples) -> Perturbation (>=1 example)

PURPOSE
-------
When a class has too few examples for CTGAN or SMOTE, this generator creates
synthetic rows by adding controlled Gaussian noise to the numeric features of
existing source rows.

HOW IT WORKS
------------
For each source row, generate ``n_copies`` perturbed variants:
    new_feature = original_feature + Normal(0, noise_std * feature_std)
    new_feature = clip(new_feature, feature_min, feature_max)

Where ``feature_std`` is estimated from the **full labelled dataset** (not just
the class subset) to prevent degenerate noise from a single-row class.

TRACEABILITY
------------
All rows produced carry ``data_source = 'perturbation'``.

LIMITATIONS
-----------
- Perturbation preserves the neighbourhood of existing examples — it does NOT
  model the true data distribution.  Use only as a last resort.
- The noise level is controlled by ``noise_std`` (default 0.05 = 5% of std).
  This is conservative by design: small noise keeps perturbed rows close to
  the source and avoids violating business constraints.
- Categorical features are copied as-is from the source row.
"""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
import yaml

from config.logging_config import get_logger

logger = get_logger("synthetic.perturbation")

_CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "model_config.yaml"

# Numeric features that can safely be perturbed
_PERTURBABLE_COLS = [
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
]

# Hard bounds per column (to avoid violating business constraints post-perturbation)
_COL_BOUNDS: dict[str, tuple[float, float]] = {
    "montant_total": (0.0, 1e9),
    "nb_lignes": (0.0, 1e4),
    "quantite_totale_commandee": (0.0, 1e6),
    "quantite_totale_livree": (0.0, 1e6),
    "taux_livraison": (0.0, 1.0),
    "postes_en_retard": (0.0, 1e4),
    "nb_categories_distinctes": (0.0, 1e3),
    "fournisseur_taux_retard": (0.0, 1.0),
    "fournisseur_delai_moyen": (0.0, 365.0),
    "fournisseur_score_perf": (0.0, 1.0),
    "score_priorite": (0.0, 1e6),
}


def _load_perturbation_config() -> dict:
    with open(_CONFIG_PATH, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    return cfg.get("synthetic", {}).get("perturbation", {})


class GaussianPerturbationGenerator:
    """
    Generates synthetic rows via controlled Gaussian noise on numeric features.

    This is the fallback in the generation cascade when CTGAN and SMOTE cannot
    run due to insufficient source examples.

    Parameters
    ----------
    noise_std : float
        Fraction of the global feature std to use as noise amplitude.
        E.g. 0.05 means noise ~ N(0, 0.05 * feature_std).
    n_copies : int
        Number of perturbed copies to generate per source row.
    random_state : int
        Seed for reproducibility.
    """

    def __init__(
        self,
        noise_std: Optional[float] = None,
        n_copies: int = 10,
        random_state: Optional[int] = None,
    ) -> None:
        cfg = _load_perturbation_config()
        self.noise_std = noise_std if noise_std is not None else float(cfg.get("noise_std", 0.05))
        self.n_copies = n_copies
        self.random_state = random_state if random_state is not None else int(cfg.get("random_state", 42))
        self._rng = np.random.default_rng(self.random_state)

    def generate_for_class(
        self,
        class_df: pd.DataFrame,
        target_class: str,
        reference_df: pd.DataFrame,
        n_target: int,
    ) -> pd.DataFrame:
        """
        Generate ``n_target`` synthetic rows for a given class.

        Parameters
        ----------
        class_df : pd.DataFrame
            Source rows for this class (used as perturbation templates).
        target_class : str
            The target class label to assign to all generated rows.
        reference_df : pd.DataFrame
            The full labelled dataset — used to estimate feature stds for
            proper noise scaling (prevents degenerate single-row estimates).
        n_target : int
            Total number of synthetic rows to generate.

        Returns
        -------
        pd.DataFrame
            Synthetic rows with ``data_source = 'perturbation'``.
        """
        if class_df.empty:
            logger.warning(
                "[Perturbation] No source rows for class '%s' — cannot generate",
                target_class,
            )
            return pd.DataFrame()

        logger.info(
            "[Perturbation] Generating %d rows for class '%s' from %d source rows (noise_std=%.3f)",
            n_target, target_class, len(class_df), self.noise_std,
        )

        available_cols = [c for c in _PERTURBABLE_COLS if c in class_df.columns]

        # Estimate feature stds from the full reference dataset (not just this class)
        ref_numeric = reference_df[available_cols].apply(
            pd.to_numeric, errors="coerce"
        ).fillna(0.0)
        feature_stds = ref_numeric.std().fillna(1.0).replace(0.0, 1.0).values

        rows = []
        n_source = len(class_df)
        source_values = class_df[available_cols].apply(
            pd.to_numeric, errors="coerce"
        ).fillna(0.0).values

        for i in range(n_target):
            # Cycle through source rows
            template_idx = i % n_source
            template_row = dict(class_df.iloc[template_idx])
            src_values = source_values[template_idx].copy()

            # Add Gaussian noise
            noise = self._rng.normal(0, self.noise_std * feature_stds)
            perturbed = src_values + noise

            # Apply hard bounds per column
            for j, col in enumerate(available_cols):
                lo, hi = _COL_BOUNDS.get(col, (-np.inf, np.inf))
                perturbed[j] = float(np.clip(perturbed[j], lo, hi))

            # Reconstruct row
            new_row = template_row.copy()
            for j, col in enumerate(available_cols):
                new_row[col] = perturbed[j]

            # Round integer-like columns
            for int_col in ["nb_lignes", "postes_en_retard", "nb_categories_distinctes"]:
                if int_col in new_row:
                    new_row[int_col] = max(0, round(float(new_row[int_col])))

            new_row["order_id"] = f"synth-perturb-{uuid.uuid4()}"
            new_row["numero_sap"] = f"PRTB{i:06d}"
            new_row["target_class"] = target_class
            new_row["data_source"] = "perturbation"

            # Fix target_delay_days consistency
            if target_class == "on_time":
                new_row["target_delay_days"] = 0
            elif "target_delay_days" in new_row:
                delay = max(1, round(float(new_row.get("target_delay_days", 1))))
                new_row["target_delay_days"] = delay

            rows.append(new_row)

        result = pd.DataFrame(rows)
        logger.info(
            "[Perturbation] Generated %d rows for class '%s'",
            len(result), target_class,
        )
        return result
