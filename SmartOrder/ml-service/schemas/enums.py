"""
SmartOrder ML — Enums mirroring CDS schema + ML-specific enums.

Source: db/schema.cds (smartorder namespace)
"""

from __future__ import annotations

from enum import StrEnum


# ============================================================
# CDS Mirror Enums
# ============================================================

class StatutEnum(StrEnum):
    """Order status — mirrors smartorder.StatutEnum in CDS."""

    EN_ATTENTE = "EN_ATTENTE"
    EN_COURS = "EN_COURS"
    EN_LIVRAISON = "EN_LIVRAISON"
    LIVRE = "LIVRE"
    ANNULE = "ANNULE"
    BLOQUE = "BLOQUE"


class UrgenceEnum(StrEnum):
    """Urgency level — mirrors smartorder.UrgenceEnum in CDS."""

    NORMALE = "NORMALE"
    HAUTE = "HAUTE"
    CRITIQUE = "CRITIQUE"


class RisqueEnum(StrEnum):
    """Risk level — mirrors smartorder.RisqueEnum in CDS."""

    FAIBLE = "FAIBLE"
    MOYEN = "MOYEN"
    ELEVE = "ELEVE"


class PrioriteActionEnum(StrEnum):
    """Action priority — mirrors smartorder.PrioriteEnum in CDS."""

    TRAITER_EN_PRIORITE = "TRAITER_EN_PRIORITE"
    SURVEILLER = "SURVEILLER"
    ESCALADER = "ESCALADER"


class SeveriteEnum(StrEnum):
    """Alert severity — mirrors smartorder.SeveriteEnum."""

    FAIBLE = "FAIBLE"
    MOYEN = "MOYEN"
    ELEVE = "ELEVE"
    CRITIQUE = "CRITIQUE"


# ============================================================
# ML-Specific Enums
# ============================================================

class TargetClassEnum(StrEnum):
    """Classification target — delivery status prediction."""

    ON_TIME = "on_time"
    LATE_NON_BLOCKING = "late_non_blocking"
    LATE_BLOCKING = "late_blocking"


class DataSourceEnum(StrEnum):
    """Data source identifier for traceability."""

    SAP_HANA = "sap_hana"
    POSTGRES = "postgres"
    CSV_FILE = "csv_file"
    ODATA_API = "odata_api"
    SYNTHETIC = "synthetic"


class ModelTypeEnum(StrEnum):
    """ML model type identifier."""

    CLASSIFICATION = "classification"
    REGRESSION = "regression"
