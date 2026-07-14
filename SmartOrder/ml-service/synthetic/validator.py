"""
SmartOrder ML — Synthetic data validator.

Validates every synthetic row produced by CTGAN, SMOTE, or rule-based
generators against three layers of quality criteria:

    1. Schema constraints  — column presence, non-null essentials, numeric ranges
    2. Business coherence  — delivery date >= creation date, montant_total >= 0
    3. Near-duplicate check — rejects rows that are too similar to real examples
                              (risk of label leakage if the generator "memorised"
                              the 3 real labelled examples)

Near-duplicate detection strategy
----------------------------------
For numeric features, we compute the L1 (Manhattan) distance between each
synthetic row and all real rows, normalised by the feature range.  If the
minimum normalised distance falls below ``min_distance_threshold`` (default 0.05),
the row is flagged as a near-duplicate and rejected.

This is deliberately conservative: we prefer to reject slightly too many
rows than to let memorised examples inflate apparent dataset diversity.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import numpy as np
import pandas as pd

from config.logging_config import get_logger

logger = get_logger("synthetic.validator")


# ---------------------------------------------------------------------------
# Validation result
# ---------------------------------------------------------------------------

@dataclass
class SyntheticValidationResult:
    """Result of synthetic data validation."""

    n_input: int = 0
    n_valid: int = 0
    n_rejected_schema: int = 0
    n_rejected_business: int = 0
    n_rejected_duplicate: int = 0
    schema_errors: list[str] = field(default_factory=list)
    business_errors: list[str] = field(default_factory=list)
    duplicate_indices: list[int] = field(default_factory=list)

    @property
    def n_rejected(self) -> int:
        return self.n_rejected_schema + self.n_rejected_business + self.n_rejected_duplicate

    def summary(self) -> str:
        lines = [
            f"Synthetic validation: {self.n_valid}/{self.n_input} rows accepted",
            f"  Rejected (schema):     {self.n_rejected_schema}",
            f"  Rejected (business):   {self.n_rejected_business}",
            f"  Rejected (near-dup):   {self.n_rejected_duplicate}",
        ]
        for e in self.schema_errors[:5]:
            lines.append(f"    [schema] {e}")
        for e in self.business_errors[:5]:
            lines.append(f"    [business] {e}")
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# Validator
# ---------------------------------------------------------------------------

class SyntheticValidator:
    """
    Validates synthetic rows and rejects those that violate constraints.

    Parameters
    ----------
    real_df : pd.DataFrame | None
        Real labelled rows used as reference for near-duplicate detection.
        If None, duplicate detection is skipped.
    min_distance_threshold : float
        Normalised L1 distance below which a synthetic row is considered a
        near-duplicate of a real row. Default 0.05 (5% of feature range).
    """

    REQUIRED_COLUMNS = [
        "order_id", "numero_sap", "statut", "urgence",
        "date_creation", "date_previsionnelle", "montant_total",
        "target_class", "data_source",
    ]

    VALID_TARGET_CLASSES = {"on_time", "late_non_blocking", "late_blocking"}
    VALID_DATA_SOURCES = {"real", "rule_based", "ctgan", "smote", "perturbation"}

    # Numeric feature columns used for near-duplicate detection
    NUMERIC_COLS = [
        "montant_total", "nb_lignes", "taux_livraison",
        "fournisseur_taux_retard", "fournisseur_score_perf",
    ]

    def __init__(
        self,
        real_df: Optional[pd.DataFrame] = None,
        min_distance_threshold: float = 0.05,
    ) -> None:
        self.real_df = real_df
        self.min_distance_threshold = min_distance_threshold
        self._real_numeric: Optional[np.ndarray] = None
        self._feature_ranges: Optional[np.ndarray] = None

        if real_df is not None and not real_df.empty:
            self._prepare_real_features(real_df)

    def validate(self, synthetic_df: pd.DataFrame) -> tuple[pd.DataFrame, SyntheticValidationResult]:
        """
        Validate synthetic rows.

        Parameters
        ----------
        synthetic_df : pd.DataFrame
            Synthetic rows to validate.

        Returns
        -------
        (valid_df, result)
            valid_df: Rows that passed all checks.
            result: Detailed validation result object.
        """
        result = SyntheticValidationResult(n_input=len(synthetic_df))

        if synthetic_df.empty:
            return synthetic_df, result

        # Layer 1: Schema
        valid_mask, schema_errs = self._check_schema(synthetic_df)
        result.schema_errors = schema_errs
        result.n_rejected_schema = int((~valid_mask).sum())

        df_after_schema = synthetic_df[valid_mask].copy()

        # Layer 2: Business coherence
        coherent_mask, business_errs = self._check_business(df_after_schema)
        result.business_errors = business_errs
        result.n_rejected_business = int((~coherent_mask).sum())

        df_after_business = df_after_schema[coherent_mask].copy()

        # Layer 3: Near-duplicate detection
        # Skip when threshold == 0.0 (permissive mode, e.g. for perturbation rows)
        # or when no real reference data is available.
        skip_neardup = self.min_distance_threshold == 0.0 or self._real_numeric is None
        if not skip_neardup and not df_after_business.empty:
            non_dup_mask, dup_indices = self._check_near_duplicates(df_after_business)
            result.duplicate_indices = dup_indices
            result.n_rejected_duplicate = int((~non_dup_mask).sum())
            df_final = df_after_business[non_dup_mask].copy()
        else:
            df_final = df_after_business

        result.n_valid = len(df_final)
        logger.info("%s", result.summary())
        return df_final, result

    # --------------------------------------------------------
    # Layer 1: Schema
    # --------------------------------------------------------

    def _check_schema(self, df: pd.DataFrame) -> tuple[pd.Series, list[str]]:
        """Check required columns, non-nulls, and valid enum values."""
        errors: list[str] = []
        valid_mask = pd.Series(True, index=df.index)

        # Required columns present
        missing_cols = [c for c in self.REQUIRED_COLUMNS if c not in df.columns]
        if missing_cols:
            errors.append(f"Missing required columns: {missing_cols}")
            # Cannot proceed per-row without required columns
            return pd.Series(False, index=df.index), errors

        # Non-null essentials
        for col in ["order_id", "numero_sap", "date_creation", "date_previsionnelle"]:
            null_mask = df[col].isna()
            if null_mask.any():
                errors.append(f"Column '{col}' has {null_mask.sum()} nulls")
                valid_mask &= ~null_mask

        # target_class values
        if "target_class" in df.columns:
            invalid_tc = ~df["target_class"].isin(self.VALID_TARGET_CLASSES)
            if invalid_tc.any():
                errors.append(f"Invalid target_class values: {df.loc[invalid_tc, 'target_class'].unique().tolist()}")
                valid_mask &= ~invalid_tc

        # data_source values
        if "data_source" in df.columns:
            invalid_ds = ~df["data_source"].isin(self.VALID_DATA_SOURCES)
            if invalid_ds.any():
                errors.append(f"Invalid data_source values: {df.loc[invalid_ds, 'data_source'].unique().tolist()}")
                valid_mask &= ~invalid_ds

        # montant_total >= 0
        if "montant_total" in df.columns:
            neg_mask = pd.to_numeric(df["montant_total"], errors="coerce") < 0
            if neg_mask.any():
                errors.append(f"montant_total has {neg_mask.sum()} negative values")
                valid_mask &= ~neg_mask

        return valid_mask, errors

    # --------------------------------------------------------
    # Layer 2: Business coherence
    # --------------------------------------------------------

    def _check_business(self, df: pd.DataFrame) -> tuple[pd.Series, list[str]]:
        """Check domain-level constraints."""
        errors: list[str] = []
        valid_mask = pd.Series(True, index=df.index)

        # date_livraison_reelle >= date_creation (when present)
        # Use utc=True to normalise tz-aware and tz-naive datetimes uniformly.
        if "date_livraison_reelle" in df.columns and "date_creation" in df.columns:
            liv = pd.to_datetime(df["date_livraison_reelle"], errors="coerce", utc=True)
            cre = pd.to_datetime(df["date_creation"], errors="coerce", utc=True)
            invalid = (liv.notna()) & (cre.notna()) & (liv < cre)
            if invalid.any():
                errors.append(f"{invalid.sum()} rows have date_livraison_reelle < date_creation")
                valid_mask &= ~invalid

        # date_previsionnelle >= date_creation
        if "date_previsionnelle" in df.columns and "date_creation" in df.columns:
            prev = pd.to_datetime(df["date_previsionnelle"], errors="coerce", utc=True)
            cre = pd.to_datetime(df["date_creation"], errors="coerce", utc=True)
            invalid = (prev.notna()) & (cre.notna()) & (prev < cre)
            if invalid.any():
                errors.append(f"{invalid.sum()} rows have date_previsionnelle < date_creation")
                valid_mask &= ~invalid

        # target_delay_days consistent with target_class
        if "target_class" in df.columns and "target_delay_days" in df.columns:
            on_time_wrong = (
                (df["target_class"] == "on_time")
                & (pd.to_numeric(df["target_delay_days"], errors="coerce") != 0)
            )
            if on_time_wrong.any():
                errors.append(f"{on_time_wrong.sum()} on_time rows have target_delay_days != 0")
                valid_mask &= ~on_time_wrong

        return valid_mask, errors

    # --------------------------------------------------------
    # Layer 3: Near-duplicate detection
    # --------------------------------------------------------

    def _prepare_real_features(self, real_df: pd.DataFrame) -> None:
        """Pre-compute normalised numeric features for real rows."""
        available_cols = [c for c in self.NUMERIC_COLS if c in real_df.columns]
        if not available_cols:
            return
        numeric = real_df[available_cols].apply(
            pd.to_numeric, errors="coerce"
        ).fillna(0.0)
        self._real_numeric = numeric.values.astype(float)
        # Feature ranges for normalisation (avoid division by zero)
        ranges = numeric.max() - numeric.min()
        ranges = ranges.replace(0, 1.0)
        self._feature_ranges = ranges.values.astype(float)
        self._available_cols = available_cols

    def _check_near_duplicates(self, df: pd.DataFrame) -> tuple[pd.Series, list[int]]:
        """Identify synthetic rows too close to any real row (L1 normalised)."""
        available_cols = [c for c in self._available_cols if c in df.columns]
        if not available_cols or self._real_numeric is None:
            return pd.Series(True, index=df.index), []

        synth_numeric = df[available_cols].apply(
            pd.to_numeric, errors="coerce"
        ).fillna(0.0).values.astype(float)

        # Normalise
        ranges = self._feature_ranges[:len(available_cols)]
        synth_norm = synth_numeric / ranges
        real_norm = self._real_numeric[:, :len(available_cols)] / ranges

        # Per synthetic row: minimum L1 distance to any real row
        dup_mask = pd.Series(False, index=df.index)
        dup_indices: list[int] = []

        for i, synth_row in enumerate(synth_norm):
            distances = np.abs(real_norm - synth_row).sum(axis=1)
            min_dist = float(distances.min())
            if min_dist < self.min_distance_threshold:
                dup_mask.iloc[i] = True
                dup_indices.append(int(df.index[i]))

        if dup_mask.any():
            logger.warning(
                "Near-duplicate detection: rejected %d/%d synthetic rows (threshold=%.2f)",
                dup_mask.sum(), len(df), self.min_distance_threshold,
            )

        return ~dup_mask, dup_indices
