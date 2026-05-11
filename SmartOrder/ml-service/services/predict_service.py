"""
SmartOrder — Predict Service
Projet PFE SAP BTP — YAAS "Run It Best"

Service de prédiction utilisant RandomForest (classification) et GradientBoosting (régression).
Chargement des modèles .pkl avec fallback heuristique si modèle absent.
"""

import os
import logging
import pickle
from typing import Optional, Tuple, Dict

import numpy as np

from models.feature_dto import FeatureDTO
from services.feature_builder import (
    build_feature_vector,
    compute_composite_score,
    determine_priority_action,
    generate_suggestion,
)

logger = logging.getLogger("smartorder.predict")

# Chemins des modèles
MODELS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "models_storage")
CLASSIFIER_PATH = os.path.join(MODELS_DIR, "classifier.pkl")
REGRESSOR_PATH = os.path.join(MODELS_DIR, "regressor.pkl")
VERSION_PATH = os.path.join(MODELS_DIR, "version.txt")

# Cache en mémoire
_classifier = None
_regressor = None
_model_version = "v0.0.0"
_label_mapping = {0: "FAIBLE", 1: "MOYEN", 2: "ELEVE"}


def load_models() -> bool:
    """Charge les modèles depuis le disque. Retourne True si succès."""
    global _classifier, _regressor, _model_version

    try:
        if os.path.exists(CLASSIFIER_PATH):
            with open(CLASSIFIER_PATH, "rb") as f:
                _classifier = pickle.load(f)
            logger.info("Classificateur chargé: %s", CLASSIFIER_PATH)
        else:
            logger.warning("Classificateur non trouvé: %s", CLASSIFIER_PATH)

        if os.path.exists(REGRESSOR_PATH):
            with open(REGRESSOR_PATH, "rb") as f:
                _regressor = pickle.load(f)
            logger.info("Régresseur chargé: %s", REGRESSOR_PATH)
        else:
            logger.warning("Régresseur non trouvé: %s", REGRESSOR_PATH)

        if os.path.exists(VERSION_PATH):
            with open(VERSION_PATH, "r") as f:
                _model_version = f.read().strip()

        return _classifier is not None
    except Exception as e:
        logger.error("Erreur chargement modèles: %s", e)
        return False


def get_model_info() -> Dict:
    """Retourne les informations sur le modèle courant."""
    return {
        "version": _model_version,
        "classifier_loaded": _classifier is not None,
        "regressor_loaded": _regressor is not None,
        "models_dir": MODELS_DIR,
        "classifier_type": type(_classifier).__name__ if _classifier else None,
        "regressor_type": type(_regressor).__name__ if _regressor else None,
    }


def _fallback_predict(feature: FeatureDTO) -> Tuple[str, float, Dict[str, float], float]:
    """
    Prédiction heuristique de fallback si le modèle n'est pas disponible.
    Utilise des règles métier simples.
    """
    score = 0.0

    # Facteur retard fournisseur (max 30%)
    score += feature.taux_retard_fournisseur * 0.30

    # Facteur performance (max 25%)
    score += (1 - feature.score_performance_fournisseur) * 0.25

    # Facteur urgence (max 20%)
    score += (feature.urgence_score / 2.0) * 0.20

    # Facteur montant (max 15%, cap 100k)
    score += min(feature.montant_total / 100000, 1.0) * 0.15

    # Facteur délai (max 10%, cap 60j)
    score += min(feature.delai_prevu_jours / 60, 1.0) * 0.10

    # Déterminer le label
    if score >= 0.6:
        label = "ELEVE"
    elif score >= 0.3:
        label = "MOYEN"
    else:
        label = "FAIBLE"

    probas = {
        "FAIBLE": round(max(0, 1 - score * 1.5), 3),
        "MOYEN": round(min(1, score * 1.2) if score < 0.6 else max(0, 1 - score), 3),
        "ELEVE": round(min(1, score * 1.5) if score >= 0.3 else score * 0.5, 3),
    }

    # Normaliser les probabilités
    total = sum(probas.values())
    if total > 0:
        probas = {k: round(v / total, 3) for k, v in probas.items()}

    # Durée estimée heuristique
    duree = feature.delai_prevu_jours * (1 + feature.taux_retard_fournisseur * 0.5)

    return label, round(score, 3), probas, round(duree, 1)


def predict(feature: FeatureDTO) -> Dict:
    """
    Prédit le risque et la durée pour une commande.

    Returns:
        Dict contenant risque_label, risque_score, probabilités,
        durée estimée, score composite, priorité d'action, suggestion.
    """
    if _classifier is not None:
        try:
            X = build_feature_vector(feature).reshape(1, -1)

            # Classification du risque
            class_pred = _classifier.predict(X)[0]
            class_probas = _classifier.predict_proba(X)[0]

            risque_label = _label_mapping.get(int(class_pred), "MOYEN")
            risque_score = float(class_probas[int(class_pred)])
            probas = {
                _label_mapping[i]: round(float(p), 3)
                for i, p in enumerate(class_probas)
            }

            # Régression de la durée
            if _regressor is not None:
                duree_estimee = float(_regressor.predict(X)[0])
                duree_estimee = max(1.0, round(duree_estimee, 1))
            else:
                duree_estimee = feature.delai_prevu_jours * (
                    1 + feature.taux_retard_fournisseur * 0.5
                )
                duree_estimee = round(duree_estimee, 1)

        except Exception as e:
            logger.error("Erreur prédiction ML, fallback: %s", e)
            risque_label, risque_score, probas, duree_estimee = _fallback_predict(
                feature
            )
    else:
        logger.info("Modèle non chargé, utilisation du fallback heuristique")
        risque_label, risque_score, probas, duree_estimee = _fallback_predict(feature)

    # Score composite
    score_composite = compute_composite_score(risque_score, feature)

    # Priorité d'action
    priorite_action = determine_priority_action(score_composite, risque_label)

    # Suggestion
    suggestion = generate_suggestion(risque_label, score_composite, feature)

    return {
        "risque_label": risque_label,
        "risque_score": risque_score,
        "risque_probabilites": probas,
        "duree_estimee_jours": duree_estimee,
        "score_composite": score_composite,
        "priorite_action": priorite_action,
        "suggestion": suggestion,
        "modele_version": _model_version,
    }
