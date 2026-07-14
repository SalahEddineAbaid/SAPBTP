"""
SmartOrder ML — FastAPI request/response schemas.

These schemas define the API contract between the CAP Node.js backend
(srv/services/mlService.js) and the FastAPI ML service.
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field

from schemas.canonical import MLFeatureVector, PredictionResult
from schemas.enums import RisqueEnum, PrioriteActionEnum


# ============================================================
# Predict
# ============================================================

class PredictRequest(BaseModel):
    """
    Single prediction request.

    Matches the FeatureDTO sent by mlService.js → POST /predict.
    Accepts both the flat feature format AND the raw SAP-style fields.
    """

    # --- Supplier metrics (from mlService.js heuristic) ---
    taux_retard_fournisseur: float = Field(0.0, description="Supplier delay rate")
    delai_moyen_fournisseur: float = Field(0.0, description="Supplier avg lead time")
    score_performance_fournisseur: float = Field(1.0, description="Supplier perf score")

    # --- Order metrics ---
    urgence: str = Field("NORMALE", description="NORMALE | HAUTE | CRITIQUE")
    montant: float = Field(0.0, description="Total order amount")
    nb_lignes: int = Field(1, ge=1, description="Number of order lines")
    taux_livraison: float = Field(0.0, ge=0.0, le=1.0)

    # --- Temporal ---
    lead_time_days: Optional[int] = Field(None, description="Days between creation and expected delivery")
    order_age_days: Optional[int] = Field(None, description="Days since order creation")

    # --- SAP Categorical ---
    fournisseur_pays: str = Field("", description="Supplier country ISO3")
    purchasing_group: str = Field("", description="SAP purchasing group")
    order_type: str = Field("NB", description="SAP order type")
    statut_approbation: str = Field("", description="SAP release status")

    def to_feature_vector(self) -> MLFeatureVector:
        """Convert API request to ML feature vector."""
        import math
        from datetime import datetime

        return MLFeatureVector(
            lead_time_days=self.lead_time_days or 30,
            order_age_days=self.order_age_days or 0,
            month_creation=datetime.now().month,
            day_of_week_creation=datetime.now().weekday(),
            is_quarter_end=datetime.now().month in (3, 6, 9, 12),
            supplier_delay_rate=self.taux_retard_fournisseur,
            supplier_avg_lead_time=self.delai_moyen_fournisseur,
            supplier_perf_score=self.score_performance_fournisseur,
            montant_total_log=math.log1p(self.montant),
            montant_par_ligne=self.montant / max(self.nb_lignes, 1),
            nb_lignes=self.nb_lignes,
            taux_livraison=self.taux_livraison,
            urgence=self.urgence,
            statut_approbation=self.statut_approbation,
            fournisseur_pays=self.fournisseur_pays,
            purchasing_group=self.purchasing_group,
            order_type=self.order_type,
        )


class PredictResponse(BaseModel):
    """
    Single prediction response.

    Matches the PredictionResult expected by mlService.js.
    """

    risque_label: RisqueEnum
    risque_score: float
    risque_probabilites: dict[str, float]
    duree_estimee_jours: float
    score_composite: float
    priorite_action: PrioriteActionEnum
    suggestion: str
    modele_version: str

    @classmethod
    def from_prediction_result(cls, result: PredictionResult) -> "PredictResponse":
        return cls(
            risque_label=result.risque_label,
            risque_score=result.risque_score,
            risque_probabilites=result.risque_probabilites,
            duree_estimee_jours=result.duree_estimee_jours,
            score_composite=result.score_composite,
            priorite_action=result.priorite_action,
            suggestion=result.suggestion,
            modele_version=result.modele_version,
        )


# ============================================================
# Batch Predict
# ============================================================

class BatchPredictRequest(BaseModel):
    """Batch prediction request — list of features."""

    features: list[PredictRequest] = Field(..., min_length=1, max_length=1000)


class BatchPredictResponse(BaseModel):
    """Batch prediction response."""

    predictions: list[PredictResponse]
    count: int


# ============================================================
# Retrain
# ============================================================

class RetrainRequest(BaseModel):
    """Retrain request from CAP backend."""

    records: list[dict] = Field(default_factory=list, description="Training records from DB")
    force: bool = Field(False, description="Force retrain even if metrics are sufficient")


class RetrainResponse(BaseModel):
    """Retrain response — async job info."""

    job_id: str
    status: str = "accepted"
    message: str = ""


# ============================================================
# Explain
# ============================================================

class ExplainRequest(BaseModel):
    """SHAP explanation request for a single prediction."""

    features: PredictRequest


class ExplainResponse(BaseModel):
    """SHAP explanation response."""

    shap_values: dict[str, float] = Field(
        default_factory=dict, description="Feature name → SHAP value"
    )
    feature_importance: list[dict[str, float]] = Field(
        default_factory=list, description="Sorted feature importances"
    )
    base_value: float = Field(0.0, description="SHAP base value (expected value)")


# ============================================================
# Health
# ============================================================

class HealthResponse(BaseModel):
    """Health check response — matches mlService.js healthCheck()."""

    status: str = "healthy"
    version: str = "1.0.0"
    models_loaded: bool = False
    classification_model: Optional[str] = None
    regression_model: Optional[str] = None
    environment: str = "development"
    mlflow_tracking_uri: str = ""
