"""
SmartOrder ML — Canonical data schemas (Pydantic v2).

Central contract for the ML pipeline. All data sources (SAP HANA,
PostgreSQL, CSV, OData) are mapped to these schemas before processing.

Mapping from CDS entities:
    db/schema.cds → Orders + LignesCommande (aggregated) + Fournisseurs
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from schemas.enums import (
    DataSourceEnum,
    PrioriteActionEnum,
    RisqueEnum,
    StatutEnum,
    TargetClassEnum,
    UrgenceEnum,
)


# ============================================================
# SupplierCanonical
# ============================================================

class SupplierCanonical(BaseModel):
    """
    Canonical supplier schema.

    Source CDS: smartorder.Fournisseurs
    CSV source: smartorder-Fournisseurs.csv
    """

    supplier_id: str = Field(..., description="UUID — Fournisseurs.ID")
    code_sap: str = Field(..., max_length=10, description="Fournisseurs.code_sap")
    nom: str = Field(..., max_length=81, description="Fournisseurs.nom")
    pays: str = Field(..., max_length=3, description="ISO country code")
    taux_retard_moyen: float = Field(0.0, ge=0.0, le=1.0)
    delai_moyen_jours: float = Field(0.0, ge=0.0)
    score_performance: float = Field(1.0, ge=0.0, le=1.0)
    actif: bool = True
    derniere_sync: Optional[datetime] = None


# ============================================================
# OrderCanonical
# ============================================================

class OrderCanonical(BaseModel):
    """
    Canonical order schema — single row = one purchase order + aggregated lines
    + supplier metadata.

    This is the central data contract for the ML pipeline.

    Sources:
        - CDS: smartorder.Orders + smartorder.LignesCommande + smartorder.Fournisseurs
        - CSV: smartorder-Orders.csv + smartorder-LignesCommande.csv + smartorder-Fournisseurs.csv
        - OData: A_PurchaseOrder + A_PurchaseOrderItem + A_BusinessPartner
    """

    # --- Order Header (from Orders) ---
    order_id: str = Field(..., description="UUID — Orders.ID")
    numero_sap: str = Field(..., max_length=10, description="SAP Purchase Order number")
    order_type: str = Field("NB", max_length=4, description="PurchaseOrderType")
    statut: StatutEnum = Field(StatutEnum.EN_ATTENTE, description="SmartOrder computed status")
    urgence: UrgenceEnum = Field(UrgenceEnum.NORMALE, description="Manual urgency level")

    # --- Dates ---
    date_creation: datetime = Field(..., description="Order creation datetime (UTC)")
    date_previsionnelle: date = Field(..., description="Expected delivery date")
    date_livraison_reelle: Optional[date] = Field(None, description="Actual delivery date")
    date_modification: datetime = Field(..., description="Last modification datetime")
    date_commande: Optional[date] = Field(None, description="Business order date")

    # --- Amounts ---
    montant_total: float = Field(0.0, ge=0.0, description="Total order amount")
    devise: str = Field("EUR", max_length=5, description="Currency code")

    # --- SAP Organizational Data ---
    company_code: Optional[str] = Field(None, max_length=4)
    purchasing_org: Optional[str] = Field(None, max_length=4)
    purchasing_group: Optional[str] = Field(None, max_length=3)

    # --- Status Flags ---
    marqueur_suppression: bool = Field(False, description="Marked for deletion in SAP")
    statut_approbation: str = Field("", max_length=1, description="Release status: '' | X | R")
    postes_en_retard: int = Field(0, ge=0, description="Number of delayed line items")
    score_priorite: float = Field(0.0, description="SmartOrder priority score")

    # --- Aggregated Line Items ---
    nb_lignes: int = Field(0, ge=0, description="Number of order lines")
    quantite_totale_commandee: float = Field(0.0, ge=0.0, description="Total ordered quantity")
    quantite_totale_livree: float = Field(0.0, ge=0.0, description="Total delivered quantity")
    taux_livraison: float = Field(0.0, ge=0.0, le=1.0, description="Delivery ratio (0-1)")
    poids_total: Optional[float] = Field(None, ge=0.0, description="Total weight in kg")
    nb_categories_distinctes: int = Field(0, ge=0, description="Distinct article categories")

    # --- Supplier Data (denormalized) ---
    fournisseur_id: Optional[str] = Field(None, description="Supplier UUID")
    fournisseur_code_sap: str = Field("", max_length=10)
    fournisseur_pays: str = Field("", max_length=3)
    fournisseur_taux_retard: float = Field(0.0, ge=0.0, le=1.0)
    fournisseur_delai_moyen: float = Field(0.0, ge=0.0)
    fournisseur_score_perf: float = Field(1.0, ge=0.0, le=1.0)

    # --- Target Variables (computed, nullable for unlabeled data) ---
    target_class: Optional[TargetClassEnum] = Field(
        None, description="on_time | late_non_blocking | late_blocking"
    )
    target_delay_days: Optional[int] = Field(
        None, ge=0, description="Delay in days (0 if on_time)"
    )

    # --- Metadata ---
    data_source: DataSourceEnum = Field(
        DataSourceEnum.CSV_FILE, description="Origin of this record"
    )

    # --------------------------------------------------------
    # Validators
    # --------------------------------------------------------
    @field_validator("taux_livraison", mode="before")
    @classmethod
    def clamp_taux_livraison(cls, v: float) -> float:
        if v is None:
            return 0.0
        return max(0.0, min(float(v), 1.0))

    @model_validator(mode="after")
    def compute_targets(self) -> "OrderCanonical":
        """Auto-compute target variables if not already set and data allows it."""
        if self.target_class is not None:
            return self

        if self.date_livraison_reelle is not None:
            delta = (self.date_livraison_reelle - self.date_previsionnelle).days
            if delta <= 0:
                self.target_class = TargetClassEnum.ON_TIME
                self.target_delay_days = 0
            elif self.statut == StatutEnum.BLOQUE or (
                self.postes_en_retard > 0
                and self.urgence in (UrgenceEnum.HAUTE, UrgenceEnum.CRITIQUE)
            ):
                self.target_class = TargetClassEnum.LATE_BLOCKING
                self.target_delay_days = delta
            else:
                self.target_class = TargetClassEnum.LATE_NON_BLOCKING
                self.target_delay_days = delta

        elif self.statut == StatutEnum.BLOQUE:
            delta = (date.today() - self.date_previsionnelle).days
            self.target_class = TargetClassEnum.LATE_BLOCKING
            self.target_delay_days = max(delta, 0)

        return self


# ============================================================
# MLFeatureVector — output of feature engineering
# ============================================================

class MLFeatureVector(BaseModel):
    """
    Flat feature vector ready for model input.

    Produced by features/feature_engineer.py from OrderCanonical.
    """

    # Temporal
    lead_time_days: int = Field(..., description="date_previsionnelle - date_creation")
    order_age_days: int = Field(..., description="now - date_creation")
    month_creation: int = Field(..., ge=1, le=12)
    day_of_week_creation: int = Field(..., ge=0, le=6)
    is_quarter_end: bool = False

    # Supplier
    supplier_delay_rate: float = Field(0.0, ge=0.0, le=1.0)
    supplier_avg_lead_time: float = Field(0.0, ge=0.0)
    supplier_perf_score: float = Field(1.0, ge=0.0, le=1.0)

    # Amount / Volume
    montant_total_log: float = Field(0.0)
    montant_par_ligne: float = Field(0.0, ge=0.0)
    nb_lignes: int = Field(0, ge=0)
    taux_livraison: float = Field(0.0, ge=0.0, le=1.0)

    # Categorical (encoded or native for CatBoost)
    urgence: str = "NORMALE"
    statut_approbation: str = ""
    fournisseur_pays: str = ""
    purchasing_group: str = ""
    order_type: str = "NB"


# ============================================================
# PredictionResult — output of inference
# ============================================================

class PredictionResult(BaseModel):
    """
    Prediction result combining classification + regression.

    This schema matches the contract in srv/services/mlService.js.
    """

    risque_label: RisqueEnum = Field(..., description="FAIBLE | MOYEN | ELEVE")
    risque_score: float = Field(..., ge=0.0, le=1.0, description="Confidence score")
    risque_probabilites: dict[str, float] = Field(
        default_factory=dict,
        description="Class probabilities {FAIBLE: 0.x, MOYEN: 0.x, ELEVE: 0.x}",
    )
    duree_estimee_jours: float = Field(0.0, ge=0.0, description="Predicted delivery days")
    score_composite: float = Field(0.0, ge=0.0, le=1.0, description="Weighted risk score")
    priorite_action: PrioriteActionEnum = Field(PrioriteActionEnum.SURVEILLER)
    suggestion: str = Field("", description="Human-readable recommendation")
    modele_version: str = Field("v1.0.0", description="Model version used for inference")

    # Extended fields (not in mlService.js contract but useful internally)
    target_class_predicted: Optional[TargetClassEnum] = Field(
        None, description="on_time | late_non_blocking | late_blocking"
    )
    delay_days_predicted: Optional[int] = Field(
        None, ge=0, description="Predicted delay in days"
    )

    def map_target_to_risque(self) -> "PredictionResult":
        """Map target_class to RisqueEnum for backward compatibility with CDS."""
        if self.target_class_predicted is None:
            return self
        mapping = {
            TargetClassEnum.ON_TIME: RisqueEnum.FAIBLE,
            TargetClassEnum.LATE_NON_BLOCKING: RisqueEnum.MOYEN,
            TargetClassEnum.LATE_BLOCKING: RisqueEnum.ELEVE,
        }
        self.risque_label = mapping[self.target_class_predicted]
        return self
