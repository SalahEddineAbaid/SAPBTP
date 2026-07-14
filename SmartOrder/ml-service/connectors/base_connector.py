"""
SmartOrder ML — Abstract base connector.

All data connectors (HANA, PostgreSQL, CSV, OData) implement this interface.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

import pandas as pd

from config.logging_config import get_logger

logger = get_logger("connector")


class BaseConnector(ABC):
    """Abstract base class for data connectors."""

    @abstractmethod
    def connect(self) -> None:
        """Establish connection to the data source."""

    @abstractmethod
    def disconnect(self) -> None:
        """Close the connection."""

    @abstractmethod
    def fetch_orders(self) -> pd.DataFrame:
        """Fetch raw orders data."""

    @abstractmethod
    def fetch_order_lines(self) -> pd.DataFrame:
        """Fetch raw order line items."""

    @abstractmethod
    def fetch_suppliers(self) -> pd.DataFrame:
        """Fetch raw supplier data."""

    @abstractmethod
    def health_check(self) -> bool:
        """Verify the connection is alive."""

    def __enter__(self) -> "BaseConnector":
        self.connect()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.disconnect()
