"""
SmartOrder ML — FastAPI application entry point.

Serves the ML prediction API consumed by the CAP backend (mlService.js).
Endpoints: /health, /predict, /predict/batch, /retrain, /explain.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import health
from config import get_settings
from config.logging_config import setup_logging


@asynccontextmanager
async def lifespan(application: FastAPI):
    """Startup/shutdown events — load models on startup."""
    settings = get_settings()
    setup_logging(level=settings.log_level, fmt=settings.log_format)

    # TODO Phase 6: Load trained models from MLflow registry here
    # from training.trainer import ModelLoader
    # app.state.classifier = ModelLoader.load_classifier()
    # app.state.regressor = ModelLoader.load_regressor()

    yield

    # Cleanup on shutdown (if needed)


app = FastAPI(
    title="SmartOrder ML Service",
    description=(
        "Machine Learning prediction API for SmartOrder — "
        "Purchase Order delay classification and regression."
    ),
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# CORS — allow CAP backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# Routes
# ============================================================
app.include_router(health.router)

# TODO Phase 10: Include predict, retrain, explain routers
# from api.routes import predict, retrain, explain
# app.include_router(predict.router)
# app.include_router(retrain.router)
# app.include_router(explain.router)


def run() -> None:
    """CLI entry point: smartorder-ml."""
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "api.main:app",
        host=settings.api_host,
        port=settings.api_port,
        workers=settings.api_workers,
        reload=not settings.is_production,
    )


if __name__ == "__main__":
    run()
