"""
SmartOrder ML — Structured logging configuration.

JSON format in production, human-readable in development.
"""

from __future__ import annotations

import logging
import logging.config
import sys
from typing import Any


def setup_logging(level: str = "INFO", fmt: str = "json") -> None:
    """Configure structured logging for the ML service."""

    config: dict[str, Any] = {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "json": {
                "format": '{"time":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","message":"%(message)s"}',
                "datefmt": "%Y-%m-%dT%H:%M:%S%z",
            },
            "text": {
                "format": "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
                "datefmt": "%Y-%m-%d %H:%M:%S",
            },
        },
        "handlers": {
            "console": {
                "class": "logging.StreamHandler",
                "stream": sys.stdout,
                "formatter": fmt,
                "level": level,
            },
        },
        "root": {
            "level": level,
            "handlers": ["console"],
        },
        "loggers": {
            "smartorder.ml": {"level": level, "propagate": True},
            "uvicorn": {"level": "INFO", "propagate": False, "handlers": ["console"]},
            "mlflow": {"level": "WARNING", "propagate": False, "handlers": ["console"]},
            "httpx": {"level": "WARNING", "propagate": False, "handlers": ["console"]},
        },
    }

    logging.config.dictConfig(config)


def get_logger(name: str) -> logging.Logger:
    """Get a named logger under the smartorder.ml namespace."""
    return logging.getLogger(f"smartorder.ml.{name}")
