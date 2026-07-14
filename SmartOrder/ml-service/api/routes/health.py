"""
SmartOrder ML — Health check endpoint.

GET /health — called by:
    - SAP BTP Cloud Foundry health-check (mta.yaml: health-check-http-endpoint)
    - CAP mlService.js healthCheck()
    - Docker HEALTHCHECK
"""

from __future__ import annotations

from fastapi import APIRouter

from config import get_settings
from schemas.api_contracts import HealthResponse

router = APIRouter(tags=["Health"])


@router.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """
    Health check endpoint.

    Returns service status, loaded models info, and environment.
    """
    settings = get_settings()

    return HealthResponse(
        status="healthy",
        version="1.0.0",
        models_loaded=False,  # TODO: Check app.state.classifier is not None
        classification_model=None,
        regression_model=None,
        environment=settings.ml_env.value,
        mlflow_tracking_uri=settings.mlflow_tracking_uri,
    )
