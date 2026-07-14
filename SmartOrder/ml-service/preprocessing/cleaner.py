"""
SmartOrder ML — Data cleaning pipeline.

Handles type casting, missing values, outlier capping, and
data quality fixes applied after raw ingestion.

Cleaning steps (in order):
    1. Duplicate removal (by numero_sap, keep last)
    2. Type casting (dates, numerics, booleans)
    3. String normalization (strip, uppercase codes)
    4. Missing value defaults
    5. Cancelled order filtering
    6. Outlier capping (IQR, with pre-clamping for extreme montant values)

Outlier capping strategy:
    - montant_total: Real data contains values up to 2 000 000 000 MAD.
      A raw IQR on such a range collapses to zero (the outlier IS the IQR).
      We therefore apply a two-pass approach:
        Pass 1 — hard pre-clamp at MAX_MONTANT_PRE_CLAMP (configurable,
                 default 1e9) to bring runaway values into a workable range.
        Pass 2 — IQR×3 on the pre-clamped distribution to handle genuine
                 statistical outliers.
      This threshold is a BUSINESS DECISION: values above 1 billion MAD
      for a single purchase order are treated as data-entry errors.
      Document and adjust via MAX_MONTANT_PRE_CLAMP if your domain differs.
    - poids_total: Same two-pass strategy; real data contains up to 1 000 kg
      per line (aggregated totals can be very high).
      Pre-clamp at MAX_POIDS_PRE_CLAMP (default 1e6 kg).

order_type is intentionally NOT validated as an enum — 'ZNBH' and other
SAP-specific types beyond 'NB' are legitimate and must not be rejected.
"""

from __future__ import annotations

from datetime import datetime

import numpy as np
import pandas as pd

from config.logging_config import get_logger

logger = get_logger("cleaner")

# ============================================================
# Outlier pre-clamp thresholds (business decisions)
# ============================================================
# Values above these are treated as data-entry errors before IQR is computed.
# They are NOT the final cap — IQR is applied on the pre-clamped distribution.
MAX_MONTANT_PRE_CLAMP: float = 1_000_000_000.0   # 1 billion MAD/EUR/USD
MAX_POIDS_PRE_CLAMP: float = 1_000_000.0           # 1 million kg


class DataCleaner:
    """
    Cleans raw DataFrames from any connector into a consistent format
    ready for canonical schema validation.

    Applied transformations:
        1. Column type casting (dates, numerics, booleans)
        2. Missing value handling (fill or drop strategies)
        3. Outlier capping (two-pass IQR for montant_total and poids_total)
        4. String normalization (strip, upper for codes)
        5. Duplicate removal
        6. Cancelled order filtering

    After calling clean(), inspect:
        .report             — dict with row counts per step
        .get_rejected_rows() — list of dicts {numero_sap, reason}
    """

    # Expected dtypes for canonical columns
    DATETIME_COLS = ["date_creation", "date_modification"]
    DATE_COLS = ["date_previsionnelle", "date_livraison_reelle", "date_commande"]
    FLOAT_COLS = [
        "montant_total",
        "score_priorite",
        "fournisseur_taux_retard",
        "fournisseur_delai_moyen",
        "fournisseur_score_perf",
        "quantite_totale_commandee",
        "quantite_totale_livree",
        "taux_livraison",
        "poids_total",
    ]
    INT_COLS = ["postes_en_retard", "nb_lignes", "nb_categories_distinctes"]
    BOOL_COLS = ["marqueur_suppression"]
    STRING_UPPER_COLS = ["statut", "urgence", "devise"]
    STRING_STRIP_COLS = [
        "numero_sap",
        "order_type",   # Free string — ZNBH and other SAP types are valid
        "company_code",
        "purchasing_org",
        "purchasing_group",
        "statut_approbation",
        "fournisseur_code_sap",
        "fournisseur_pays",
    ]

    def __init__(self, drop_cancelled: bool = True, cap_outliers: bool = True) -> None:
        self.drop_cancelled = drop_cancelled
        self.cap_outliers = cap_outliers
        self._report: dict[str, object] = {}
        self._rejected_rows: list[dict[str, str]] = []

    def clean(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Run the full cleaning pipeline.

        Args:
            df: Raw DataFrame from a connector.

        Returns:
            Cleaned DataFrame with step-by-step report populated.
        """
        self._rejected_rows = []
        step_counts: dict[str, int] = {}

        initial_rows = len(df)
        step_counts["input"] = initial_rows
        logger.info("Cleaning started — %d rows", initial_rows)

        df = df.copy()

        # Step 1 — duplicates
        df, n_dupes = self._remove_duplicates(df)
        step_counts["after_dedup"] = len(df)

        # Step 2 — types
        df = self._cast_types(df)

        # Step 3 — strings
        df = self._normalize_strings(df)

        # Step 4 — missing values / drop essential nulls
        df, n_missing = self._handle_missing_values(df)
        step_counts["after_drop_missing"] = len(df)

        # Step 5 — filter cancelled
        df, n_cancelled = self._filter_cancelled(df)
        step_counts["after_filter_cancelled"] = len(df)

        # Step 6 — outliers (capping, not dropping)
        capping_log: dict[str, object] = {}
        if self.cap_outliers:
            df, capping_log = self._cap_outliers(df)
        step_counts["final"] = len(df)

        self._report = {
            "steps": step_counts,
            "rows_removed_duplicates": n_dupes,
            "rows_removed_missing_essential": n_missing,
            "rows_removed_cancelled": n_cancelled,
            "rows_total_removed": initial_rows - len(df),
            "outlier_capping": capping_log,
        }

        logger.info(
            "Cleaning complete -- %d -> %d rows (removed %d: %d dupes, %d missing, %d cancelled)",
            initial_rows,
            len(df),
            initial_rows - len(df),
            n_dupes,
            n_missing,
            n_cancelled,
        )
        return df

    @property
    def report(self) -> dict[str, object]:
        """Detailed cleaning report with per-step row counts."""
        return self._report

    def get_rejected_rows(self) -> list[dict[str, str]]:
        """
        Return rows rejected during cleaning with their reason.

        Each entry: {"numero_sap": str, "order_id": str, "reason": str}
        Reasons: "duplicate", "missing_essential", "cancelled"
        Note: outlier_capped rows are NOT rejected — their values are capped.
        """
        return list(self._rejected_rows)

    # --------------------------------------------------------
    # Pipeline steps
    # --------------------------------------------------------

    def _remove_duplicates(self, df: pd.DataFrame) -> tuple[pd.DataFrame, int]:
        """Remove duplicate orders by numero_sap, keeping last."""
        if "numero_sap" not in df.columns:
            return df, 0
        before = len(df)
        dupes_mask = df.duplicated(subset=["numero_sap"], keep="last")
        rejected = df[dupes_mask]
        for _, row in rejected.iterrows():
            self._rejected_rows.append({
                "numero_sap": str(row.get("numero_sap", "unknown")),
                "order_id": str(row.get("order_id", "unknown")),
                "reason": "duplicate",
            })
        df = df[~dupes_mask].copy()
        removed = before - len(df)
        if removed > 0:
            logger.warning("Removed %d duplicate orders (kept last)", removed)
        return df, removed

    def _cast_types(self, df: pd.DataFrame) -> pd.DataFrame:
        """Cast columns to correct types."""
        # Datetimes
        for col in self.DATETIME_COLS:
            if col in df.columns:
                df[col] = pd.to_datetime(df[col], errors="coerce", utc=True)

        # Dates
        for col in self.DATE_COLS:
            if col in df.columns:
                df[col] = pd.to_datetime(df[col], errors="coerce").dt.date

        # Floats
        for col in self.FLOAT_COLS:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors="coerce")

        # Integers
        for col in self.INT_COLS:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0).astype(int)

        # Booleans
        for col in self.BOOL_COLS:
            if col in df.columns:
                df[col] = df[col].map(
                    {"true": True, "false": False, True: True, False: False, "1": True, "0": False}
                ).fillna(False)

        return df

    def _normalize_strings(self, df: pd.DataFrame) -> pd.DataFrame:
        """Normalize string columns (strip whitespace, uppercase codes)."""
        for col in self.STRING_STRIP_COLS:
            if col in df.columns:
                df[col] = df[col].astype(str).str.strip()
                df[col] = df[col].replace("nan", "")

        for col in self.STRING_UPPER_COLS:
            if col in df.columns:
                df[col] = df[col].astype(str).str.strip().str.upper()
                df[col] = df[col].replace("NAN", "")

        return df

    def _handle_missing_values(self, df: pd.DataFrame) -> tuple[pd.DataFrame, int]:
        """Handle missing values with domain-specific strategies."""
        defaults: dict[str, object] = {
            "montant_total": 0.0,
            "score_priorite": 0.0,
            "postes_en_retard": 0,
            "nb_lignes": 0,
            "nb_categories_distinctes": 0,
            "quantite_totale_commandee": 0.0,
            "quantite_totale_livree": 0.0,
            "taux_livraison": 0.0,
            "fournisseur_taux_retard": 0.0,
            "fournisseur_delai_moyen": 0.0,
            "fournisseur_score_perf": 1.0,
            "fournisseur_code_sap": "",
            "fournisseur_pays": "",
            "order_type": "NB",
            "devise": "EUR",
            "statut_approbation": "",
            "marqueur_suppression": False,
        }

        for col, default in defaults.items():
            if col in df.columns:
                df[col] = df[col].fillna(default)

        # Drop rows without essential fields
        essential = ["order_id", "numero_sap", "date_creation", "date_previsionnelle"]
        existing_essential = [c for c in essential if c in df.columns]
        before = len(df)
        if existing_essential:
            missing_mask = df[existing_essential].isna().any(axis=1)
            rejected = df[missing_mask]
            for _, row in rejected.iterrows():
                self._rejected_rows.append({
                    "numero_sap": str(row.get("numero_sap", "unknown")),
                    "order_id": str(row.get("order_id", "unknown")),
                    "reason": "missing_essential",
                })
            df = df[~missing_mask].copy()
        removed = before - len(df)
        if removed > 0:
            logger.warning("Dropped %d rows with missing essential fields", removed)
        return df, removed

    def _filter_cancelled(self, df: pd.DataFrame) -> tuple[pd.DataFrame, int]:
        """Optionally remove cancelled orders (not useful for ML)."""
        if not self.drop_cancelled or "statut" not in df.columns:
            return df, 0
        before = len(df)
        cancelled_mask = df["statut"] == "ANNULE"
        rejected = df[cancelled_mask]
        for _, row in rejected.iterrows():
            self._rejected_rows.append({
                "numero_sap": str(row.get("numero_sap", "unknown")),
                "order_id": str(row.get("order_id", "unknown")),
                "reason": "cancelled",
            })
        df = df[~cancelled_mask].copy()
        removed = before - len(df)
        if removed > 0:
            logger.info("Filtered %d cancelled orders", removed)
        return df, removed

    def _cap_outliers(self, df: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, object]]:
        """
        Cap extreme outliers using a two-pass strategy.

        Pass 1: Hard pre-clamp at MAX_MONTANT_PRE_CLAMP / MAX_POIDS_PRE_CLAMP.
                This is necessary because values up to 2B MAD make the raw IQR
                degenerate (a single outlier can inflate Q3 massively).
                These thresholds represent business-level sanity bounds.
        Pass 2: IQR×3 on the pre-clamped distribution to cap statistical
                outliers while preserving the distribution shape.

        Capped rows are KEPT with adjusted values (not rejected).
        """
        capping_log: dict[str, object] = {}
        df = df.copy()

        for col, pre_clamp in [
            ("montant_total", MAX_MONTANT_PRE_CLAMP),
            ("poids_total", MAX_POIDS_PRE_CLAMP),
        ]:
            if col not in df.columns:
                continue

            series = df[col].dropna()
            if len(series) < 4:  # Not enough data for meaningful IQR
                continue

            # Pass 1 — hard pre-clamp (business sanity bound)
            n_pre_clamped = int((df[col] > pre_clamp).sum())
            if n_pre_clamped > 0:
                df.loc[df[col] > pre_clamp, col] = pre_clamp
                logger.info(
                    "Pre-clamped %d rows in '%s' at %.0f (business sanity bound)",
                    n_pre_clamped, col, pre_clamp,
                )

            # Pass 2 — IQR×3 on pre-clamped distribution
            q1 = df[col].quantile(0.25)
            q3 = df[col].quantile(0.75)
            iqr = q3 - q1
            upper = q3 + 3.0 * iqr  # 3× IQR is lenient for small datasets

            n_iqr_capped = int((df[col] > upper).sum())
            if n_iqr_capped > 0:
                df.loc[df[col] > upper, col] = upper
                logger.info(
                    "IQR-capped %d rows in '%s' (Q3=%.2f, IQR=%.2f, cap=%.2f)",
                    n_iqr_capped, col, q3, iqr, upper,
                )

            capping_log[col] = {
                "pre_clamp_threshold": pre_clamp,
                "n_pre_clamped": n_pre_clamped,
                "iqr_upper_cap": round(upper, 2) if iqr > 0 else None,
                "n_iqr_capped": n_iqr_capped,
                "q1": round(float(q1), 2),
                "q3": round(float(q3), 2),
            }

        return df, capping_log
