"""SmartOrder ML — Schema definitions module."""

from schemas.enums import (
    StatutEnum,
    UrgenceEnum,
    RisqueEnum,
    TargetClassEnum,
    PrioriteActionEnum,
)
from schemas.canonical import (
    OrderCanonical,
    SupplierCanonical,
    MLFeatureVector,
    PredictionResult,
)
from schemas.api_contracts import (
    PredictRequest,
    PredictResponse,
    BatchPredictRequest,
    BatchPredictResponse,
    HealthResponse,
)

__all__ = [
    "StatutEnum",
    "UrgenceEnum",
    "RisqueEnum",
    "TargetClassEnum",
    "PrioriteActionEnum",
    "OrderCanonical",
    "SupplierCanonical",
    "MLFeatureVector",
    "PredictionResult",
    "PredictRequest",
    "PredictResponse",
    "BatchPredictRequest",
    "BatchPredictResponse",
    "HealthResponse",
]
