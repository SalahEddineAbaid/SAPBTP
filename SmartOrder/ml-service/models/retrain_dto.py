"""
SmartOrder — Retrain DTO
Projet PFE SAP BTP — YAAS "Run It Best"

Modèles Pydantic pour le réentraînement du modèle ML.
"""

from pydantic import BaseModel, Field
from typing import Optional


class RetrainRequest(BaseModel):
    """Requête de réentraînement du modèle."""

    force: bool = Field(False, description="Forcer le réentraînement même si le modèle est récent")
    min_samples: int = Field(100, description="Nombre minimum d'échantillons requis", ge=10)


class RetrainResponse(BaseModel):
    """Résultat du réentraînement."""

    success: bool
    version: str = Field(..., description="Nouvelle version du modèle")
    accuracy: float = Field(..., description="Accuracy du classificateur", ge=0, le=1)
    f1_score: float = Field(..., description="F1-score moyen du classificateur", ge=0, le=1)
    mae: Optional[float] = Field(None, description="MAE du régresseur (durée)")
    r2: Optional[float] = Field(None, description="R² du régresseur (durée)")
    dataset_size: int = Field(..., description="Taille du dataset d'entraînement")
    message: str = Field(..., description="Message descriptif")
