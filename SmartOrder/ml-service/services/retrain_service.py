"""
SmartOrder — Retrain Service
Projet PFE SAP BTP — YAAS "Run It Best"

Pipeline Scikit-learn pour le réentraînement :
1. Génération de données synthétiques (ou récupération depuis DB)
2. Entraînement RandomForest (classification) + GradientBoosting (régression)
3. Évaluation + sauvegarde .pkl
"""

import os
import logging
import pickle
import datetime
from typing import Dict, Tuple

import numpy as np
from sklearn.ensemble import RandomForestClassifier, GradientBoostingRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, f1_score, mean_absolute_error, r2_score
from sklearn.preprocessing import StandardScaler

logger = logging.getLogger("smartorder.retrain")

MODELS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "models_storage")


def _generate_synthetic_data(n_samples: int = 2000) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Génère des données synthétiques réalistes pour l'entraînement.

    Returns:
        X (features), y_class (labels classification), y_reg (durée réelle)
    """
    np.random.seed(42)

    # 9 features
    montant = np.random.exponential(10000, n_samples)
    nb_lignes = np.random.randint(1, 10, n_samples).astype(float)
    delai = np.random.uniform(3, 60, n_samples)
    taux_retard = np.random.beta(2, 8, n_samples)  # skewed low
    perf_fournisseur = np.random.beta(8, 2, n_samples)  # skewed high
    urgence = np.random.choice([0, 0, 0, 1, 1, 2], n_samples).astype(float)
    poids = np.random.exponential(50, n_samples)
    quantite = np.random.exponential(100, n_samples)
    nb_fournisseurs = np.random.randint(1, 4, n_samples).astype(float)

    X = np.column_stack([
        montant, nb_lignes, delai, taux_retard, perf_fournisseur,
        urgence, poids, quantite, nb_fournisseurs
    ])

    # Risque = fonction des features avec bruit
    risk_score = (
        0.25 * taux_retard
        + 0.20 * (1 - perf_fournisseur)
        + 0.15 * (urgence / 2)
        + 0.10 * np.clip(montant / 100000, 0, 1)
        + 0.10 * np.clip(delai / 60, 0, 1)
        + 0.20 * np.random.normal(0.3, 0.15, n_samples)
    )
    risk_score = np.clip(risk_score, 0, 1)

    # Labels: 0=FAIBLE, 1=MOYEN, 2=ELEVE
    y_class = np.where(risk_score >= 0.55, 2, np.where(risk_score >= 0.3, 1, 0))

    # Durée réelle = délai * facteur retard + bruit
    y_reg = delai * (1 + taux_retard * 0.8) + np.random.normal(0, 2, n_samples)
    y_reg = np.clip(y_reg, 1, 120)

    return X, y_class, y_reg


def retrain(min_samples: int = 100, force: bool = False) -> Dict:
    """
    Réentraîne les modèles ML.

    Returns:
        Dict avec les métriques et la nouvelle version.
    """
    logger.info("Début du réentraînement (min_samples=%d, force=%s)", min_samples, force)

    # Génération données
    n_samples = max(min_samples, 2000)
    X, y_class, y_reg = _generate_synthetic_data(n_samples)
    logger.info("Dataset généré: %d échantillons, %d features", X.shape[0], X.shape[1])

    # Split train/test
    X_train, X_test, y_class_train, y_class_test, y_reg_train, y_reg_test = (
        train_test_split(X, y_class, y_reg, test_size=0.2, random_state=42, stratify=y_class)
    )

    # === Classificateur (RandomForest) ===
    classifier = RandomForestClassifier(
        n_estimators=150,
        max_depth=12,
        min_samples_split=5,
        min_samples_leaf=3,
        class_weight="balanced",
        random_state=42,
        n_jobs=-1,
    )
    classifier.fit(X_train, y_class_train)
    y_class_pred = classifier.predict(X_test)

    accuracy = accuracy_score(y_class_test, y_class_pred)
    f1 = f1_score(y_class_test, y_class_pred, average="weighted")
    logger.info("Classificateur — Accuracy: %.3f, F1: %.3f", accuracy, f1)

    # === Régresseur (GradientBoosting) ===
    regressor = GradientBoostingRegressor(
        n_estimators=150,
        max_depth=6,
        learning_rate=0.1,
        min_samples_split=5,
        min_samples_leaf=3,
        random_state=42,
    )
    regressor.fit(X_train, y_reg_train)
    y_reg_pred = regressor.predict(X_test)

    mae = mean_absolute_error(y_reg_test, y_reg_pred)
    r2 = r2_score(y_reg_test, y_reg_pred)
    logger.info("Régresseur — MAE: %.2f jours, R²: %.3f", mae, r2)

    # === Sauvegarde .pkl ===
    os.makedirs(MODELS_DIR, exist_ok=True)

    classifier_path = os.path.join(MODELS_DIR, "classifier.pkl")
    regressor_path = os.path.join(MODELS_DIR, "regressor.pkl")
    version_path = os.path.join(MODELS_DIR, "version.txt")

    with open(classifier_path, "wb") as f:
        pickle.dump(classifier, f)
    with open(regressor_path, "wb") as f:
        pickle.dump(regressor, f)

    # Nouvelle version basée sur la date
    now = datetime.datetime.now()
    new_version = f"v{now.strftime('%Y%m%d.%H%M')}"
    with open(version_path, "w") as f:
        f.write(new_version)

    logger.info("Modèles sauvegardés: version %s", new_version)

    return {
        "success": True,
        "version": new_version,
        "accuracy": round(accuracy, 4),
        "f1_score": round(f1, 4),
        "mae": round(mae, 2),
        "r2": round(r2, 4),
        "dataset_size": n_samples,
        "message": f"Réentraînement réussi. Nouvelle version: {new_version}",
    }
