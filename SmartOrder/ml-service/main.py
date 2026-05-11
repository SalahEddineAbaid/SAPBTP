"""
SmartOrder — ML Service (FastAPI)
Projet PFE SAP BTP — YAAS "Run It Best"

Point d'entrée du micro-service ML.
Endpoints :
  - POST /predict        — Prédiction unitaire
  - POST /predict/batch  — Prédiction par lot
  - POST /retrain        — Réentraîner les modèles
  - GET  /health         — Health check
  - GET  /model/info     — Informations modèle
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from models import (
    FeatureDTO,
    BatchFeatureDTO,
    PredictionDTO,
    BatchPredictionDTO,
    RetrainRequest,
    RetrainResponse,
)
from services.predict_service import predict, load_models, get_model_info
from services.retrain_service import retrain

# ---- Logging ----
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger("smartorder.api")


# ---- Lifespan (startup / shutdown) ----
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Charge les modèles ML au démarrage."""
    logger.info("Démarrage ML Service — chargement des modèles…")
    loaded = load_models()
    if loaded:
        logger.info("Modèles chargés avec succès.")
    else:
        logger.warning(
            "Modèles non disponibles — le service fonctionnera en mode heuristique."
        )
    yield
    logger.info("Arrêt du ML Service.")


# ---- Application ----
app = FastAPI(
    title="SmartOrder ML Service",
    description=(
        "Service de prédiction ML pour le système de gestion intelligente des commandes. "
        "Fournit des prédictions de risque, des estimations de durée et des recommandations."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

# CORS (pour les requêtes depuis le backend CAP)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ═══════════════════════════════════════════════════════════════
# ENDPOINTS
# ═══════════════════════════════════════════════════════════════


@app.post("/predict", response_model=PredictionDTO, tags=["Prediction"])
async def predict_single(feature: FeatureDTO):
    """
    Prédit le risque et la durée pour une commande unique.

    Accepte un vecteur de 9 features et retourne :
    - Label de risque (FAIBLE / MOYEN / ELEVE)
    - Score de risque (0-1)
    - Probabilités par classe
    - Durée estimée de livraison (jours)
    - Score composite de priorité (0-100)
    - Action recommandée
    - Suggestion textuelle
    """
    try:
        result = predict(feature)
        return PredictionDTO(**result)
    except Exception as e:
        logger.error("Erreur prédiction: %s", e)
        raise HTTPException(status_code=500, detail=f"Erreur de prédiction: {str(e)}")


@app.post("/predict/batch", response_model=BatchPredictionDTO, tags=["Prediction"])
async def predict_batch(batch: BatchFeatureDTO):
    """
    Prédit le risque et la durée pour un lot de commandes (max 500).
    """
    try:
        predictions = []
        for feature in batch.items:
            result = predict(feature)
            predictions.append(PredictionDTO(**result))

        model_info = get_model_info()
        return BatchPredictionDTO(
            predictions=predictions,
            total=len(predictions),
            modele_version=model_info["version"],
        )
    except Exception as e:
        logger.error("Erreur prédiction batch: %s", e)
        raise HTTPException(
            status_code=500, detail=f"Erreur de prédiction batch: {str(e)}"
        )


@app.post("/retrain", response_model=RetrainResponse, tags=["Model Management"])
async def retrain_model(request: RetrainRequest = RetrainRequest()):
    """
    Réentraîne les modèles ML (classificateur + régresseur).

    Les nouveaux modèles sont sauvegardés et chargés automatiquement.
    """
    try:
        result = retrain(min_samples=request.min_samples, force=request.force)

        # Recharger les modèles en mémoire
        load_models()

        return RetrainResponse(**result)
    except Exception as e:
        logger.error("Erreur réentraînement: %s", e)
        raise HTTPException(
            status_code=500, detail=f"Erreur de réentraînement: {str(e)}"
        )


@app.get("/health", tags=["System"])
async def health_check():
    """
    Health check du ML Service.
    Retourne le statut du service et du modèle.
    """
    info = get_model_info()
    status = "healthy" if info["classifier_loaded"] else "degraded"
    return {
        "status": status,
        "service": "smartorder-ml",
        "model_loaded": info["classifier_loaded"],
        "model_version": info["version"],
    }


@app.get("/model/info", tags=["Model Management"])
async def model_info():
    """
    Retourne les informations détaillées sur le modèle ML courant.
    """
    return get_model_info()


# ═══════════════════════════════════════════════════════════════
# ENTRY POINT
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",
    )
