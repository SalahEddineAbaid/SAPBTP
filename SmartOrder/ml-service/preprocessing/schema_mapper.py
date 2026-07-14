"""
SmartOrder ML — Schema mapper.

Maps raw DataFrames from heterogeneous sources to OrderCanonical Pydantic models.
Handles the conversion from cleaned DataFrame rows to validated Pydantic objects.

Error collection:
    Errors are collected per-row (non-fatal) so the entire batch is not aborted
    on a single bad row. Each error entry contains:
        - row_index: DataFrame row index
        - numero_sap: SAP order number for traceability
        - error: human-readable message
        - error_type: one of {schema_invalid, enum_unknown, field_required, type_error}
        - was_enum_fallback: True if any enum field silently fell back to default

This design allows the ingest pipeline to produce a complete quality report
including all rejected rows and their categorized failure reasons.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Optional

import pandas as pd
from pydantic import ValidationError

from config.logging_config import get_logger
from schemas.canonical import OrderCanonical
from schemas.enums import DataSourceEnum, StatutEnum, UrgenceEnum

logger = get_logger("schema_mapper")


class SchemaMapper:
    """
    Maps cleaned DataFrames to lists of OrderCanonical Pydantic models.

    Handles:
        - Type conversions (str → date, str → datetime, str → enum)
        - Default values for missing optional fields
        - Source tagging (csv_file, sap_hana, postgres, odata_api)
        - Validation error collection (non-fatal: logs and skips bad rows)
        - Enum fallback detection (reports rows where enum was silently defaulted)
    """

    def __init__(self, data_source: DataSourceEnum = DataSourceEnum.CSV_FILE) -> None:
        self.data_source = data_source
        self._errors: list[dict[str, object]] = []

    def map_dataframe(self, df: pd.DataFrame) -> list[OrderCanonical]:
        """
        Convert a cleaned DataFrame to a list of OrderCanonical objects.

        Args:
            df: Cleaned DataFrame with canonical column names.

        Returns:
            List of validated OrderCanonical instances.
            Invalid rows are skipped and logged with categorized error_type.
        """
        orders: list[OrderCanonical] = []
        self._errors = []

        for idx, row in df.iterrows():
            try:
                order, enum_fallbacks = self._map_row(row)
                orders.append(order)
                # Log (non-fatal) enum fallbacks as warnings
                if enum_fallbacks:
                    logger.debug(
                        "Row %s (SAP %s): enum fallbacks used for %s",
                        idx, row.get("numero_sap", "?"), enum_fallbacks,
                    )
            except ValidationError as e:
                self._errors.append({
                    "row_index": int(idx),
                    "numero_sap": str(row.get("numero_sap", "unknown")),
                    "error": str(e),
                    "error_type": "schema_invalid",
                    "was_enum_fallback": False,
                })
                logger.warning(
                    "Row %s (SAP %s) Pydantic validation failed: %s",
                    idx, row.get("numero_sap", "?"), e,
                )
            except (KeyError, ValueError, TypeError) as e:
                # Categorise error type
                error_type = self._categorise_error(e)
                self._errors.append({
                    "row_index": int(idx),
                    "numero_sap": str(row.get("numero_sap", "unknown")),
                    "error": str(e),
                    "error_type": error_type,
                    "was_enum_fallback": False,
                })
                logger.warning(
                    "Row %s (SAP %s) skipped [%s]: %s",
                    idx, row.get("numero_sap", "?"), error_type, e,
                )

        logger.info(
            "Schema mapping: %d/%d rows mapped successfully (%d errors)",
            len(orders),
            len(df),
            len(self._errors),
        )
        return orders

    def map_to_dataframe(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Convert a cleaned DataFrame to a validated DataFrame via Pydantic round-trip.

        Useful when you need a DataFrame (not list[OrderCanonical]) but want
        schema validation applied.
        """
        orders = self.map_dataframe(df)
        if not orders:
            return pd.DataFrame()
        return pd.DataFrame([o.model_dump() for o in orders])

    @property
    def errors(self) -> list[dict[str, object]]:
        """Mapping errors from the last map_dataframe() call, with error_type."""
        return self._errors

    # --------------------------------------------------------
    # Row mapping
    # --------------------------------------------------------

    def _map_row(self, row: pd.Series) -> tuple[OrderCanonical, list[str]]:
        """
        Map a single DataFrame row to an OrderCanonical instance.

        Returns:
            (OrderCanonical, list of field names where enum fell back to default)
        """
        enum_fallbacks: list[str] = []

        statut_val, statut_fallback = self._safe_enum(
            StatutEnum, row.get("statut"), StatutEnum.EN_ATTENTE
        )
        if statut_fallback:
            enum_fallbacks.append("statut")

        urgence_val, urgence_fallback = self._safe_enum(
            UrgenceEnum, row.get("urgence"), UrgenceEnum.NORMALE
        )
        if urgence_fallback:
            enum_fallbacks.append("urgence")

        order = OrderCanonical(
            # --- Header ---
            order_id=str(row["order_id"]),
            numero_sap=str(row["numero_sap"]),
            order_type=str(row.get("order_type", "NB")),
            statut=statut_val,
            urgence=urgence_val,
            # --- Dates ---
            date_creation=self._to_datetime(row["date_creation"]),
            date_previsionnelle=self._to_date(row["date_previsionnelle"]),
            date_livraison_reelle=self._to_date_optional(row.get("date_livraison_reelle")),
            date_modification=self._to_datetime(
                self._coalesce_timestamp(row.get("date_modification"), row["date_creation"])
            ),
            date_commande=self._to_date_optional(row.get("date_commande")),
            # --- Amounts ---
            montant_total=float(row.get("montant_total", 0) or 0),
            devise=str(row.get("devise", "EUR")),
            # --- SAP Org ---
            company_code=self._to_str_optional(row.get("company_code")),
            purchasing_org=self._to_str_optional(row.get("purchasing_org")),
            purchasing_group=self._to_str_optional(row.get("purchasing_group")),
            # --- Flags ---
            marqueur_suppression=bool(row.get("marqueur_suppression", False)),
            statut_approbation=str(row.get("statut_approbation", "")),
            postes_en_retard=self._to_int(row.get("postes_en_retard", 0)),
            score_priorite=float(row.get("score_priorite", 0) or 0),
            # --- Aggregated Lines ---
            nb_lignes=self._to_int(row.get("nb_lignes", 0)),
            quantite_totale_commandee=float(row.get("quantite_totale_commandee", 0) or 0),
            quantite_totale_livree=float(row.get("quantite_totale_livree", 0) or 0),
            taux_livraison=float(row.get("taux_livraison", 0) or 0),
            poids_total=self._to_float_optional(row.get("poids_total")),
            nb_categories_distinctes=self._to_int(row.get("nb_categories_distinctes", 0)),
            # --- Supplier ---
            fournisseur_id=self._to_str_optional(row.get("fournisseur_id")),
            fournisseur_code_sap=str(row.get("fournisseur_code_sap", "") or ""),
            fournisseur_pays=str(row.get("fournisseur_pays", "") or ""),
            fournisseur_taux_retard=float(row.get("fournisseur_taux_retard", 0) or 0),
            fournisseur_delai_moyen=float(row.get("fournisseur_delai_moyen", 0) or 0),
            fournisseur_score_perf=float(row.get("fournisseur_score_perf", 1.0) or 1.0),
            # --- Metadata ---
            data_source=self.data_source,
            # target_class and target_delay_days are auto-computed by model_validator
        )
        return order, enum_fallbacks

    # --------------------------------------------------------
    # Error categorisation
    # --------------------------------------------------------

    @staticmethod
    def _categorise_error(exc: Exception) -> str:
        """Map an exception to a categorised error_type string."""
        msg = str(exc).lower()
        if "required" in msg or "missing" in msg:
            return "field_required"
        if "enum" in msg or "not a valid" in msg or "invalid" in msg:
            return "enum_unknown"
        if isinstance(exc, (TypeError, ValueError)):
            return "type_error"
        return "schema_invalid"

    # --------------------------------------------------------
    # Type conversion helpers
    # --------------------------------------------------------

    @staticmethod
    def _coalesce_timestamp(val: object, fallback: object) -> object:
        """Return val if it is a valid (non-NaT) timestamp, otherwise fallback."""
        if val is None or val is pd.NaT:
            return fallback
        if isinstance(val, pd.Timestamp) and pd.isna(val):
            return fallback
        return val

    @staticmethod
    def _to_int(val: object, default: int = 0) -> int:
        """Safe int conversion that handles float64 from pandas (avoids TypeError)."""
        if val is None or (isinstance(val, float) and pd.isna(val)):
            return default
        try:
            return int(float(val))
        except (TypeError, ValueError):
            return default

    @staticmethod
    def _to_datetime(val: object) -> datetime:
        """Convert to a timezone-aware native Python datetime (not pd.Timestamp)."""
        from datetime import timezone as _tz
        # pd.NaT or None → raise (caller catches and skips row)
        if val is None or val is pd.NaT:
            raise ValueError(f"Cannot convert {val!r} to datetime")
        if isinstance(val, pd.Timestamp):
            # Always convert to native datetime — Pydantic v2 on Python 3.11
            # rejects pd.Timestamp even though it's a datetime subclass in some
            # builds, causing a cryptic TypeError from pydantic-core.
            ts = val.to_pydatetime(warn=False)
            if ts.tzinfo is None:
                return ts.replace(tzinfo=_tz.utc)
            return ts
        if isinstance(val, datetime):
            if val.tzinfo is None:
                return val.replace(tzinfo=_tz.utc)
            return val
        # Fallback: parse string or other types
        parsed = pd.to_datetime(val, utc=True)
        return parsed.to_pydatetime(warn=False)

    @staticmethod
    def _to_date(val: object) -> date:
        if isinstance(val, date) and not isinstance(val, datetime):
            return val
        if isinstance(val, datetime):
            return val.date()
        if isinstance(val, pd.Timestamp):
            return val.date()
        return pd.to_datetime(val).date()

    @staticmethod
    def _to_date_optional(val: object) -> Optional[date]:
        """Convert to date or return None for missing/NaT/empty values."""
        # Handle pd.NaT explicitly (it's not a float, not None, but is falsy)
        if val is pd.NaT:
            return None
        if val is None or (isinstance(val, float) and pd.isna(val)):
            return None
        if isinstance(val, str) and val.strip() in ("", "nan", "NaT", "None"):
            return None
        try:
            if isinstance(val, date) and not isinstance(val, datetime):
                return val
            if isinstance(val, pd.Timestamp):
                if val is pd.NaT or pd.isna(val):
                    return None
                return val.date()
            return pd.to_datetime(val).date()
        except Exception:
            return None

    @staticmethod
    def _to_str_optional(val: object) -> Optional[str]:
        if val is None or (isinstance(val, float) and pd.isna(val)):
            return None
        s = str(val).strip()
        return s if s and s not in ("nan", "None", "") else None

    @staticmethod
    def _to_float_optional(val: object) -> Optional[float]:
        if val is None or (isinstance(val, float) and pd.isna(val)):
            return None
        try:
            f = float(val)
            return f if not pd.isna(f) else None
        except (ValueError, TypeError):
            return None

    @staticmethod
    def _safe_enum(enum_cls: type, val: object, default: object) -> tuple[object, bool]:
        """
        Parse an enum value, returning (value, was_fallback).

        Returns:
            (parsed_enum, False)  — if val was a valid enum member
            (default, True)       — if val was invalid/None and default was used
        """
        if val is None or (isinstance(val, float) and pd.isna(val)):
            return default, True
        try:
            return enum_cls(str(val).strip()), False
        except ValueError:
            logger.debug(
                "Unknown %s value %r — falling back to %s", enum_cls.__name__, val, default
            )
            return default, True
