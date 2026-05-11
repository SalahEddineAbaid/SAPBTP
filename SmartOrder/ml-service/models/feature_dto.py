"""
SmartOrder — Feature DTO (Data Transfer Object)
Projet PFE SAP BTP — YAAS "Run It Best"

Modèles Pydantic pour les features d'entrée du modèle ML.
"""

from pydantic import BaseModel, Field
from typing import Optional, List


class FeatureDTO(BaseModel):
    """Features d'une commande pour la prédiction ML."""

    montant_total: float = Field(..., description="Montant total de la commande", ge=0)
    nombre_lignes: int = Field(..., description="Nombre de lignes de commande", ge=1)
    delai_prevu_jours: float = Field(..., description="Délai prévu en jours", ge=0)
    taux_retard_fournisseur: float = Field(
        0.0, description="Taux de retard moyen du fournisseur", ge=0, le=1
    )
    score_performance_fournisseur: float = Field(
        1.0, description="Score de performance du fournisseur (0-1)", ge=0, le=1
    )
    urgence_score: float = Field(
        0.0, description="Score d'urgence (0=normale, 1=haute, 2=critique)", ge=0
    )
    poids_total: float = Field(0.0, description="Poids total de la commande", ge=0)
    quantite_totale: float = Field(0.0, description="Quantité totale commandée", ge=0)
    nombre_fournisseurs_distincts: int = Field(
        1, description="Nombre de fournisseurs distincts", ge=1
    )

    class Config:
        json_schema_extra = {
            "example": {
                "montant_total": 15000.50,
                "nombre_lignes": 3,
                "delai_prevu_jours": 14.0,
                "taux_retard_fournisseur": 0.15,
                "score_performance_fournisseur": 0.82,
                "urgence_score": 1.0,
                "poids_total": 250.5,
                "quantite_totale": 500.0,
                "nombre_fournisseurs_distincts": 1,
            }
        }


class BatchFeatureDTO(BaseModel):
    """Batch de features pour prédiction multiple."""

    items: List[FeatureDTO] = Field(..., min_length=1, max_length=500)
