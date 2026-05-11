"""
SmartOrder — Prediction DTO
Projet PFE SAP BTP — YAAS "Run It Best"

Modèles Pydantic pour les résultats de prédiction ML.
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Dict


class PredictionDTO(BaseModel):
    """Résultat d'une prédiction ML pour une commande."""

    risque_label: str = Field(..., description="Label de risque: FAIBLE, MOYEN, ELEVE")
    risque_score: float = Field(
        ..., description="Score de risque (0-1)", ge=0.0, le=1.0
    )
    risque_probabilites: Dict[str, float] = Field(
        ..., description="Probabilités par classe"
    )
    duree_estimee_jours: float = Field(
        ..., description="Durée estimée de livraison en jours", ge=0
    )
    score_composite: float = Field(
        ..., description="Score composite de priorité (0-100)", ge=0, le=100
    )
    priorite_action: str = Field(
        ...,
        description="Action recommandée: TRAITER_EN_PRIORITE, SURVEILLER, ESCALADER",
    )
    suggestion: str = Field(..., description="Suggestion textuelle pour le gestionnaire")
    modele_version: str = Field(..., description="Version du modèle utilisé")

    class Config:
        json_schema_extra = {
            "example": {
                "risque_label": "MOYEN",
                "risque_score": 0.62,
                "risque_probabilites": {
                    "FAIBLE": 0.18,
                    "MOYEN": 0.62,
                    "ELEVE": 0.20,
                },
                "duree_estimee_jours": 12.5,
                "score_composite": 58.3,
                "priorite_action": "SURVEILLER",
                "suggestion": "Surveiller les délais fournisseur - taux de retard modéré",
                "modele_version": "v1.0.0",
            }
        }


class BatchPredictionDTO(BaseModel):
    """Résultats de prédiction pour un batch."""

    predictions: List[PredictionDTO]
    total: int
    modele_version: str
