"""
SmartOrder — Train Initial Model
Projet PFE SAP BTP — YAAS "Run It Best"

Script exécuté lors du build MTA pour pré-entraîner les modèles ML.
Génère des données synthétiques et sauvegarde les modèles .pkl
dans models_storage/ afin que le service soit immédiatement opérationnel au déploiement.

Usage :
    python train_initial_model.py
"""

import os
import sys
import logging

# Ajouter le répertoire courant au path pour les imports
sys.path.insert(0, os.path.dirname(__file__))

from services.retrain_service import retrain

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger("smartorder.init_train")


def main():
    """Entraîne les modèles initiaux avec des données synthétiques."""
    logger.info("=" * 60)
    logger.info("SmartOrder — Entraînement initial des modèles ML")
    logger.info("=" * 60)

    try:
        result = retrain(min_samples=2000, force=True)

        if result["success"]:
            logger.info("✅ Entraînement réussi!")
            logger.info("   Version      : %s", result["version"])
            logger.info("   Accuracy     : %.4f", result["accuracy"])
            logger.info("   F1-Score     : %.4f", result["f1_score"])
            logger.info("   MAE (durée)  : %.2f jours", result.get("mae", 0))
            logger.info("   R² (durée)   : %.4f", result.get("r2", 0))
            logger.info("   Dataset size : %d", result["dataset_size"])
            logger.info("")
            logger.info("Modèles sauvegardés dans models_storage/")
        else:
            logger.error("❌ Échec de l'entraînement")
            sys.exit(1)

    except Exception as e:
        logger.error("❌ Erreur fatale: %s", e)
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
