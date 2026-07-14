"""
SmartOrder ML — Centralised configuration via Pydantic Settings.

Loads from environment variables and .env file.
Supports dual-connector: PostgreSQL (dev) / SAP HANA (prod).
"""

from __future__ import annotations

from enum import Enum
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


# ============================================================
# Constants
# ============================================================
PROJECT_ROOT = Path(__file__).resolve().parent.parent


class Environment(str, Enum):
    """Runtime environment."""

    DEVELOPMENT = "development"
    STAGING = "staging"
    PRODUCTION = "production"


# ============================================================
# Settings
# ============================================================
class Settings(BaseSettings):
    """Application settings — loaded from env vars / .env."""

    model_config = SettingsConfigDict(
        env_file=str(PROJECT_ROOT / ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- Environment ---
    ml_env: Environment = Environment.DEVELOPMENT
    debug: bool = True

    # --- FastAPI ---
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    api_workers: int = 1

    # --- PostgreSQL (Development) ---
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_db: str = "smartorder"
    postgres_user: str = "smartorder"
    postgres_password: str = "changeme"
    postgres_schema: str = "smartorder"

    # --- SAP HANA (Production) ---
    hana_host: str = ""
    hana_port: int = 443
    hana_user: str = ""
    hana_password: str = ""
    hana_schema: str = "SMARTORDER"
    hana_encrypt: bool = True

    # --- OData CAP Backend (Development) ---
    odata_base_url: str = "http://localhost:4004/odata/v4"
    odata_auth_token: str = ""

    # --- MLflow ---
    mlflow_tracking_uri: str = str(PROJECT_ROOT / "mlruns")
    mlflow_experiment_name: str = "smartorder-ml"
    mlflow_registry_uri: str = ""

    # --- Paths ---
    model_dir: Path = Field(default_factory=lambda: PROJECT_ROOT / "models")
    data_dir: Path = Field(default_factory=lambda: PROJECT_ROOT / "data")

    # --- SAP S/4HANA API ---
    sap_s4_url: str = "https://my422081.s4hana.cloud.sap"
    sap_comm_user: str = ""
    sap_comm_password: str = ""

    # --- Logging ---
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    log_format: Literal["json", "text"] = "json"

    # --------------------------------------------------------
    # Derived properties
    # --------------------------------------------------------
    @property
    def is_production(self) -> bool:
        return self.ml_env == Environment.PRODUCTION

    @property
    def postgres_dsn(self) -> str:
        """SQLAlchemy PostgreSQL connection string."""
        return (
            f"postgresql+psycopg2://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def db_connector_type(self) -> str:
        """Active DB connector based on environment."""
        return "hana" if self.is_production else "postgres"

    @property
    def data_real_dir(self) -> Path:
        return self.data_dir / "real"

    @property
    def data_sandbox_dir(self) -> Path:
        return self.data_dir / "sandbox"

    @property
    def data_synthetic_dir(self) -> Path:
        return self.data_dir / "synthetic"

    # --------------------------------------------------------
    # Validators
    # --------------------------------------------------------
    @field_validator("model_dir", "data_dir", mode="after")
    @classmethod
    def ensure_dirs_exist(cls, v: Path) -> Path:
        v.mkdir(parents=True, exist_ok=True)
        return v


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached singleton — call this instead of Settings() directly."""
    return Settings()
