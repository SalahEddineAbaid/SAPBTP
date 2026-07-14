"""
SmartOrder ML — Data validation against canonical schema.

Validates cleaned DataFrames before they enter the feature engineering
pipeline. Reports validation errors without silently dropping data.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from config.logging_config import get_logger
from schemas.enums import StatutEnum, UrgenceEnum

logger = get_logger("validator")


@dataclass
class ValidationResult:
    """Result of a validation check."""

    is_valid: bool = True
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    row_count: int = 0
    valid_row_count: int = 0

    def add_error(self, msg: str) -> None:
        self.errors.append(msg)
        self.is_valid = False

    def add_warning(self, msg: str) -> None:
        self.warnings.append(msg)

    def summary(self) -> str:
        status = "VALID" if self.is_valid else "INVALID"
        parts = [
            f"{status} -- {self.valid_row_count}/{self.row_count} rows valid",
            f"  Errors: {len(self.errors)}",
            f"  Warnings: {len(self.warnings)}",
        ]
        for e in self.errors[:10]:
            parts.append(f"    [ERR] {e}")
        for w in self.warnings[:10]:
            parts.append(f"    [WARN] {w}")
        return "\n".join(parts)


class DataValidator:
    """
    Validates a cleaned DataFrame against OrderCanonical expectations.

    Checks:
        1. Required columns are present
        2. No null values in essential columns
        3. Enum values are valid
        4. Numeric ranges are plausible
        5. Date consistency (creation < prévision)
    """

    REQUIRED_COLUMNS = [
        "order_id",
        "numero_sap",
        "statut",
        "urgence",
        "date_creation",
        "date_previsionnelle",
        "montant_total",
    ]

    VALID_STATUTS = {e.value for e in StatutEnum}
    VALID_URGENCES = {e.value for e in UrgenceEnum}

    def validate(self, df: pd.DataFrame) -> ValidationResult:
        """Run all validation checks on the DataFrame."""
        result = ValidationResult(row_count=len(df))

        self._check_required_columns(df, result)
        if not result.is_valid:
            return result

        self._check_nulls(df, result)
        self._check_enums(df, result)
        self._check_numeric_ranges(df, result)
        self._check_date_consistency(df, result)
        self._check_unique_ids(df, result)

        result.valid_row_count = len(df) - len(result.errors)
        if result.valid_row_count < 0:
            result.valid_row_count = 0

        logger.info("Validation: %s", "PASSED" if result.is_valid else "FAILED")
        return result

    # --------------------------------------------------------
    # Individual checks
    # --------------------------------------------------------

    def _check_required_columns(self, df: pd.DataFrame, result: ValidationResult) -> None:
        """Verify all required columns exist."""
        missing = [c for c in self.REQUIRED_COLUMNS if c not in df.columns]
        if missing:
            result.add_error(f"Missing required columns: {missing}")

    def _check_nulls(self, df: pd.DataFrame, result: ValidationResult) -> None:
        """Check for null values in essential columns."""
        for col in self.REQUIRED_COLUMNS:
            if col in df.columns:
                null_count = df[col].isna().sum()
                if null_count > 0:
                    result.add_error(f"Column '{col}' has {null_count} null values")

    def _check_enums(self, df: pd.DataFrame, result: ValidationResult) -> None:
        """Validate enum columns contain only valid values."""
        if "statut" in df.columns:
            invalid = set(df["statut"].dropna().unique()) - self.VALID_STATUTS
            if invalid:
                result.add_warning(f"Invalid statut values: {invalid}")

        if "urgence" in df.columns:
            invalid = set(df["urgence"].dropna().unique()) - self.VALID_URGENCES
            if invalid:
                result.add_warning(f"Invalid urgence values: {invalid}")

    def _check_numeric_ranges(self, df: pd.DataFrame, result: ValidationResult) -> None:
        """Verify numeric values are within plausible ranges."""
        if "montant_total" in df.columns:
            neg_count = (df["montant_total"] < 0).sum()
            if neg_count > 0:
                result.add_error(f"montant_total has {neg_count} negative values")

        if "taux_livraison" in df.columns:
            out_of_range = ((df["taux_livraison"] < 0) | (df["taux_livraison"] > 1)).sum()
            if out_of_range > 0:
                result.add_warning(
                    f"taux_livraison has {out_of_range} values outside [0, 1]"
                )

        if "fournisseur_taux_retard" in df.columns:
            out = ((df["fournisseur_taux_retard"] < 0) | (df["fournisseur_taux_retard"] > 1)).sum()
            if out > 0:
                result.add_warning(f"fournisseur_taux_retard has {out} values outside [0, 1]")

    def _check_date_consistency(self, df: pd.DataFrame, result: ValidationResult) -> None:
        """Verify date_creation <= date_previsionnelle."""
        if "date_creation" in df.columns and "date_previsionnelle" in df.columns:
            try:
                creation = pd.to_datetime(df["date_creation"], errors="coerce").dt.date
                previs = pd.to_datetime(df["date_previsionnelle"], errors="coerce")
                if previs.dtype == "object":
                    previs = pd.to_datetime(previs, errors="coerce").dt.date

                invalid_dates = (creation > previs).sum()
                if invalid_dates > 0:
                    result.add_warning(
                        f"{invalid_dates} orders have date_creation > date_previsionnelle"
                    )
            except Exception as e:
                result.add_warning(f"Date consistency check failed: {e}")

    def _check_unique_ids(self, df: pd.DataFrame, result: ValidationResult) -> None:
        """Check for duplicate order IDs."""
        if "order_id" in df.columns:
            dupes = df["order_id"].duplicated().sum()
            if dupes > 0:
                result.add_error(f"Found {dupes} duplicate order_id values")
