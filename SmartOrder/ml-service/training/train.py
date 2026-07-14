"""
SmartOrder ML — Model loader stub for production inference.

This module does NOT contain training logic.
Training is performed in a separate Google Colab notebook (see README.md).

At API startup (FastAPI lifespan), this module loads pre-trained models
from MLflow Model Registry by their version URI, making them available
for the /predict and /explain endpoints.

Model contract:
    - clf_model : classification model (predicts target_class)
                  expects feature matrix X with columns from feature_engineer.get_feature_names()
                  outputs class probabilities array [n_samples, 3]
    - reg_model : regression model (predicts target_delay_days)
                  expects same feature matrix X
                  outputs float array [n_samples]

MLflow Model Registry URI format:
    models:/<model_name>/<version_or_stage>

Examples:
    models:/smartorder-clf/1
    models:/smartorder-clf/Production
    models:/smartorder-reg/Staging
"""

from __future__ import annotations

import logging
from typing import Any, Optional

logger = logging.getLogger("smartorder.ml.training")

# Module-level model cache — populated at API startup
_clf_model: Optional[Any] = None
_reg_model: Optional[Any] = None


def load_model(
    clf_uri: str,
    reg_uri: str,
) -> tuple[Any, Any]:
    """
    Load classification and regression models from MLflow Model Registry.

    This is the only function called at API startup. It does not train anything —
    it only retrieves already-trained models pushed to MLflow by the Colab notebook.

    Args:
        clf_uri: MLflow model URI for the classification model.
                 Format: "models:/smartorder-clf/<version>"
        reg_uri: MLflow model URI for the regression model.
                 Format: "models:/smartorder-reg/<version>"

    Returns:
        (clf_model, reg_model) — loaded scikit-learn compatible models.

    Raises:
        RuntimeError: If MLflow cannot find the model at the given URI.

    Example:
        clf, reg = load_model(
            clf_uri="models:/smartorder-clf/Production",
            reg_uri="models:/smartorder-reg/Production",
        )
    """
    global _clf_model, _reg_model

    try:
        import mlflow.sklearn  # lazy import — avoids cost at module load
    except ImportError as exc:
        raise RuntimeError(
            "mlflow is not installed. Add it to requirements.txt or run: pip install mlflow"
        ) from exc

    logger.info("Loading classification model from: %s", clf_uri)
    try:
        _clf_model = mlflow.sklearn.load_model(clf_uri)
        logger.info("Classification model loaded successfully (%s)", type(_clf_model).__name__)
    except Exception as exc:
        raise RuntimeError(
            f"Failed to load classification model from {clf_uri!r}: {exc}"
        ) from exc

    logger.info("Loading regression model from: %s", reg_uri)
    try:
        _reg_model = mlflow.sklearn.load_model(reg_uri)
        logger.info("Regression model loaded successfully (%s)", type(_reg_model).__name__)
    except Exception as exc:
        raise RuntimeError(
            f"Failed to load regression model from {reg_uri!r}: {exc}"
        ) from exc

    return _clf_model, _reg_model


def get_loaded_models() -> tuple[Optional[Any], Optional[Any]]:
    """
    Return the currently loaded models (None if not yet loaded).

    Used by API endpoints to access the models without reloading.
    """
    return _clf_model, _reg_model


def is_model_loaded() -> bool:
    """Return True if both models are loaded and ready for inference."""
    return _clf_model is not None and _reg_model is not None
