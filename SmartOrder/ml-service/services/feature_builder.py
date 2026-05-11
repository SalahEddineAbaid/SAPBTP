"""
SmartOrder — Feature Builder Service
Projet PFE SAP BTP — YAAS "Run It Best"

Transformation des features brutes en vecteur de features pour le modèle ML.
Calcul du score composite de priorité.
"""

import numpy as np
from models.feature_dto import FeatureDTO


# Poids pour le score composite (somme = 1.0)
WEIGHTS = {
    "risque_score": 0.35,
    "urgence_norm": 0.20,
    "retard_fournisseur": 0.15,
    "montant_norm": 0.10,
    "delai_norm": 0.10,
    "perf_inverse": 0.10,
}


def build_feature_vector(feature: FeatureDTO) -> np.ndarray:
    """
    Transforme un FeatureDTO en vecteur numpy pour le modèle ML.

    Returns:
        np.ndarray de shape (9,) — les 9 features normalisées
    """
    return np.array(
        [
            feature.montant_total,
            feature.nombre_lignes,
            feature.delai_prevu_jours,
            feature.taux_retard_fournisseur,
            feature.score_performance_fournisseur,
            feature.urgence_score,
            feature.poids_total,
            feature.quantite_totale,
            feature.nombre_fournisseurs_distincts,
        ],
        dtype=np.float64,
    )


def compute_composite_score(
    risque_score: float, feature: FeatureDTO
) -> float:
    """
    Calcule le score composite de priorité (0-100).

    Combine le score de risque ML avec des facteurs métier :
    - Score de risque (35%)
    - Urgence normalisée (20%)
    - Taux de retard fournisseur (15%)
    - Montant normalisé (10%)
    - Délai normalisé (10%)
    - Inverse performance fournisseur (10%)
    """
    # Normalisation du montant (cap à 100k pour normalisation)
    montant_norm = min(feature.montant_total / 100000.0, 1.0)

    # Normalisation du délai (cap à 90 jours)
    delai_norm = min(feature.delai_prevu_jours / 90.0, 1.0)

    # Urgence normalisée (0-2 → 0-1)
    urgence_norm = min(feature.urgence_score / 2.0, 1.0)

    # Inverse de la performance (1 - perf → mauvaise perf = score élevé)
    perf_inverse = 1.0 - feature.score_performance_fournisseur

    # Score composite pondéré
    composite = (
        WEIGHTS["risque_score"] * risque_score
        + WEIGHTS["urgence_norm"] * urgence_norm
        + WEIGHTS["retard_fournisseur"] * feature.taux_retard_fournisseur
        + WEIGHTS["montant_norm"] * montant_norm
        + WEIGHTS["delai_norm"] * delai_norm
        + WEIGHTS["perf_inverse"] * perf_inverse
    )

    return round(composite * 100, 1)


def determine_priority_action(score_composite: float, risque_label: str) -> str:
    """Détermine l'action de priorité basée sur le score composite."""
    if risque_label == "ELEVE" or score_composite >= 70:
        return "TRAITER_EN_PRIORITE"
    elif risque_label == "MOYEN" or score_composite >= 40:
        return "SURVEILLER"
    else:
        return "SURVEILLER"


def generate_suggestion(
    risque_label: str,
    score_composite: float,
    feature: FeatureDTO,
) -> str:
    """Génère une suggestion textuelle pour le gestionnaire."""
    suggestions = []

    if risque_label == "ELEVE":
        suggestions.append("Commande à risque élevé - intervention immédiate recommandée.")
    elif risque_label == "MOYEN":
        suggestions.append("Risque modéré détecté - surveillance renforcée conseillée.")

    if feature.taux_retard_fournisseur > 0.25:
        suggestions.append(
            f"Fournisseur avec taux de retard élevé ({feature.taux_retard_fournisseur:.0%})."
        )

    if feature.score_performance_fournisseur < 0.7:
        suggestions.append(
            f"Performance fournisseur faible ({feature.score_performance_fournisseur:.0%})."
        )

    if feature.urgence_score >= 2:
        suggestions.append("Urgence critique - prioriser le traitement.")

    if feature.montant_total > 50000:
        suggestions.append(
            f"Montant élevé ({feature.montant_total:,.0f}) - vérifier les conditions."
        )

    if not suggestions:
        suggestions.append("Aucune action particulière requise.")

    return " ".join(suggestions)
