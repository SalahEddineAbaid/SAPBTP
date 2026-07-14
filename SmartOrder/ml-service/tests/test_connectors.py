"""
SmartOrder ML — Tests for data connectors.

Tests CSV connector against the actual db/data/ seed files.
Tests are skipped if the seed files are not found.

Changes from Phase 1:
    - test_fetch_orders: no longer asserts len == 10. The real CSV has 61 orders
      (plus legacy seed rows). We assert structural properties instead.
    - test_line_aggregation: asserts on a specific known order (4500001001, 2 lines)
      that exists in both seed and real CSV, plus a structural property.
    - New tests cover the case-insensitive file discovery and dual-casing columns.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from connectors.csv_connector import (
    CSVConnector,
    LINES_RENAME,
    ORDERS_RENAME,
    SUPPLIERS_RENAME,
)


# ============================================================
# CSV Connector Tests
# ============================================================

class TestCSVConnector:
    """Tests for CSVConnector using actual db/data/ seed files."""

    @pytest.fixture
    def csv_connector(self, db_data_dir: Path) -> CSVConnector:
        """Create a CSV connector pointing to db/data/."""
        if not db_data_dir.exists():
            pytest.skip(f"Seed data not found at {db_data_dir}")
        return CSVConnector(data_dir=db_data_dir)

    def test_connect(self, csv_connector: CSVConnector) -> None:
        """Connector connects successfully."""
        csv_connector.connect()
        assert csv_connector.health_check() is True
        csv_connector.disconnect()
        assert csv_connector.health_check() is False

    def test_context_manager(self, csv_connector: CSVConnector) -> None:
        """Connector works as context manager."""
        with csv_connector:
            assert csv_connector.health_check() is True

    def test_fetch_orders_returns_dataframe(self, csv_connector: CSVConnector) -> None:
        """Fetch orders returns a non-empty DataFrame with canonical column names."""
        with csv_connector:
            df = csv_connector.fetch_orders()

        assert isinstance(df, pd.DataFrame)
        assert len(df) > 0, "Expected at least 1 order"
        assert "order_id" in df.columns
        assert "numero_sap" in df.columns
        assert "statut" in df.columns
        # Original CDS column names should NOT be present
        assert "ID" not in df.columns
        assert "id" not in df.columns

    def test_fetch_orders_no_duplicate_columns(self, csv_connector: CSVConnector) -> None:
        """Fetched orders have no duplicate columns (dual-casing dedup works)."""
        with csv_connector:
            df = csv_connector.fetch_orders()
        assert not df.columns.duplicated().any(), "Duplicate columns found after rename"

    def test_fetch_orders_contains_known_sap_numbers(self, csv_connector: CSVConnector) -> None:
        """The legacy seed SAP numbers (4500001001..4500001010) are present in the CSV."""
        with csv_connector:
            df = csv_connector.fetch_orders()
        # Seed orders that are in the consolidated real CSV
        expected_sap_present = ["4500001001", "4500001003", "4500001010"]
        for sap in expected_sap_present:
            assert sap in df["numero_sap"].values, f"SAP {sap} not found in orders"

    def test_fetch_order_lines(self, csv_connector: CSVConnector) -> None:
        """Fetch order lines returns DataFrame."""
        with csv_connector:
            df = csv_connector.fetch_order_lines()

        assert isinstance(df, pd.DataFrame)
        assert len(df) > 0
        assert "order_id" in df.columns
        assert "quantite_commandee" in df.columns
        # Legacy FK column names should NOT be present
        assert "commande_ID" not in df.columns
        assert "commande_id" not in df.columns

    def test_fetch_suppliers(self, csv_connector: CSVConnector) -> None:
        """Fetch suppliers returns DataFrame with canonical names."""
        with csv_connector:
            df = csv_connector.fetch_suppliers()

        assert isinstance(df, pd.DataFrame)
        assert len(df) >= 4  # at least the 4 legacy seed suppliers
        assert "supplier_id" in df.columns
        assert "code_sap" in df.columns
        assert "taux_retard_moyen" in df.columns

    def test_fetch_orders_enriched(self, csv_connector: CSVConnector) -> None:
        """Enriched orders join orders + lines + suppliers."""
        with csv_connector:
            df = csv_connector.fetch_orders_enriched()

        assert isinstance(df, pd.DataFrame)
        assert len(df) > 0

        # Check aggregated line columns exist
        assert "nb_lignes" in df.columns
        assert "quantite_totale_commandee" in df.columns
        assert "taux_livraison" in df.columns

        # Check supplier columns exist
        assert "fournisseur_code_sap" in df.columns
        assert "fournisseur_pays" in df.columns
        assert "fournisseur_taux_retard" in df.columns

        # Check data_source is set
        assert "data_source" in df.columns
        assert (df["data_source"] == "csv_file").all()

    def test_orders_with_no_supplier_have_defaults(self, csv_connector: CSVConnector) -> None:
        """Orders with missing fournisseur_id get supplier default values (not NaN)."""
        with csv_connector:
            df = csv_connector.fetch_orders_enriched()

        # All supplier numeric columns should be non-null after enrichment
        assert df["fournisseur_taux_retard"].isna().sum() == 0, (
            "fournisseur_taux_retard has NaN — default fill failed"
        )
        assert df["fournisseur_score_perf"].isna().sum() == 0, (
            "fournisseur_score_perf has NaN — default fill failed"
        )

    def test_line_aggregation_known_order(self, csv_connector: CSVConnector) -> None:
        """Order 4500001001 (legacy seed) has exactly 2 lines in the CSV."""
        with csv_connector:
            df = csv_connector.fetch_orders_enriched()

        order_1 = df[df["numero_sap"] == "4500001001"]
        assert len(order_1) == 1, "Order 4500001001 should appear exactly once"
        assert order_1.iloc[0]["nb_lignes"] == 2, (
            "Order 4500001001 should have 2 line items (MAT-001 + MAT-002)"
        )

    def test_orders_without_lines_have_zero_nb_lignes(self, csv_connector: CSVConnector) -> None:
        """Orders with no associated lines should have nb_lignes=0, not NaN."""
        with csv_connector:
            df = csv_connector.fetch_orders_enriched()

        assert df["nb_lignes"].isna().sum() == 0, "nb_lignes should never be NaN"
        assert (df["nb_lignes"] >= 0).all(), "nb_lignes should be >= 0"

    def test_supplier_join_for_known_order(self, csv_connector: CSVConnector) -> None:
        """Order 4500001001 → supplier BP001001 (ACME Maroc, taux_retard=0.12)."""
        with csv_connector:
            df = csv_connector.fetch_orders_enriched()

        order_1 = df[df["numero_sap"] == "4500001001"]
        assert len(order_1) == 1
        assert order_1.iloc[0]["fournisseur_code_sap"] == "BP001001"


# ============================================================
# Column Mapping Tests
# ============================================================

class TestColumnMappings:
    """Verify column rename dictionaries cover both CSV format conventions."""

    def test_orders_rename_covers_lowercase_columns(self, db_data_dir: Path) -> None:
        """ORDERS_RENAME covers all lowercase columns in smartorder_orders.csv."""
        csv_path = _find_csv(db_data_dir, "orders")
        if csv_path is None:
            pytest.skip("Orders CSV not found")

        df = pd.read_csv(csv_path, nrows=0)
        csv_cols = set(df.columns)
        mapped_cols = set(ORDERS_RENAME.keys())

        # Columns intentionally excluded (non-ML audit columns)
        non_ml = {"createdat", "updatedat", "manager_id", "createdAt", "updatedAt", "manager_ID"}
        unmapped = csv_cols - mapped_cols - non_ml
        assert len(unmapped) == 0, f"Unmapped CSV columns: {unmapped}"

    def test_orders_rename_covers_uppercase_columns(self) -> None:
        """ORDERS_RENAME must still cover legacy uppercase keys (backward compat)."""
        assert "ID" in ORDERS_RENAME, "Legacy uppercase 'ID' must remain in ORDERS_RENAME"
        assert "fournisseur_ID" in ORDERS_RENAME, "Legacy 'fournisseur_ID' must remain"

    def test_lines_rename_covers_both_fk_casings(self) -> None:
        """LINES_RENAME must cover both commande_ID and commande_id."""
        assert "commande_ID" in LINES_RENAME, "Legacy 'commande_ID' must be in LINES_RENAME"
        assert "commande_id" in LINES_RENAME, "Real-data 'commande_id' must be in LINES_RENAME"

    def test_suppliers_rename_covers_csv(self, db_data_dir: Path) -> None:
        """SUPPLIERS_RENAME covers relevant columns."""
        csv_path = _find_csv(db_data_dir, "fournisseurs")
        if csv_path is None:
            pytest.skip("Suppliers CSV not found")

        df = pd.read_csv(csv_path, nrows=0)
        csv_cols = set(df.columns)
        mapped_cols = set(SUPPLIERS_RENAME.keys())

        non_ml = {"email", "telephone", "createdat", "updatedat", "createdAt", "updatedAt"}
        unmapped = csv_cols - mapped_cols - non_ml
        assert len(unmapped) == 0, f"Unmapped supplier columns: {unmapped}"

    def test_no_duplicate_canonical_values(self) -> None:
        """All rename dicts map different source keys to the same canonical target correctly."""
        # Multiple keys can map to the same value (e.g., 'id' and 'ID' → 'order_id')
        # but the dedup logic in the connector ensures only one column survives
        canonical_targets = list(ORDERS_RENAME.values())
        unique_targets = set(canonical_targets)
        # It's OK to have duplicates here — what matters is no column is accidentally omitted
        assert "order_id" in unique_targets
        assert "fournisseur_id" in unique_targets


# ============================================================
# Helpers
# ============================================================

def _find_csv(data_dir: Path, keyword: str) -> Path | None:
    """Find a CSV file containing `keyword` in its stem (case-insensitive)."""
    if not data_dir.exists():
        return None
    matches = [f for f in data_dir.glob("*.csv") if keyword.lower() in f.stem.lower()]
    return matches[0] if matches else None
