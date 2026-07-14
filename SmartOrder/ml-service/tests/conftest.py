"""
SmartOrder ML — Pytest fixtures and shared test configuration.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from pathlib import Path

import pandas as pd
import pytest

from schemas.canonical import OrderCanonical, SupplierCanonical
from schemas.enums import DataSourceEnum, StatutEnum, UrgenceEnum


# ============================================================
# Path fixtures
# ============================================================

@pytest.fixture
def project_root() -> Path:
    """Project root directory."""
    return Path(__file__).resolve().parent.parent


@pytest.fixture
def db_data_dir(project_root: Path) -> Path:
    """CDS seed data directory (../../db/data)."""
    return project_root.parent / "db" / "data"


# ============================================================
# Sample OrderCanonical fixtures
# ============================================================

@pytest.fixture
def sample_order_on_time() -> OrderCanonical:
    """Order delivered on time (target: on_time, delay: 0)."""
    return OrderCanonical(
        order_id="test-0001",
        numero_sap="4500001003",
        order_type="NB",
        statut=StatutEnum.LIVRE,
        urgence=UrgenceEnum.NORMALE,
        date_creation=datetime(2025, 3, 1, 7, 30, tzinfo=timezone.utc),
        date_previsionnelle=date(2025, 4, 1),
        date_livraison_reelle=date(2025, 3, 28),
        date_modification=datetime(2025, 3, 28, 14, 0, tzinfo=timezone.utc),
        montant_total=23800.0,
        devise="EUR",
        company_code="1000",
        purchasing_org="1000",
        purchasing_group="020",
        postes_en_retard=0,
        nb_lignes=1,
        quantite_totale_commandee=50.0,
        quantite_totale_livree=50.0,
        taux_livraison=1.0,
        fournisseur_code_sap="BP001003",
        fournisseur_pays="ESP",
        fournisseur_taux_retard=0.28,
        fournisseur_delai_moyen=12.0,
        fournisseur_score_perf=0.72,
        data_source=DataSourceEnum.CSV_FILE,
    )


@pytest.fixture
def sample_order_late_blocking() -> OrderCanonical:
    """Blocked order (target: late_blocking)."""
    return OrderCanonical(
        order_id="test-0004",
        numero_sap="4500001004",
        order_type="NB",
        statut=StatutEnum.BLOQUE,
        urgence=UrgenceEnum.CRITIQUE,
        date_creation=datetime(2025, 4, 5, 11, 0, tzinfo=timezone.utc),
        date_previsionnelle=date(2025, 4, 25),
        date_livraison_reelle=None,
        date_modification=datetime(2025, 4, 22, 16, 0, tzinfo=timezone.utc),
        montant_total=310000.0,
        devise="EUR",
        company_code="1000",
        purchasing_org="1000",
        purchasing_group="010",
        postes_en_retard=2,
        nb_lignes=1,
        quantite_totale_commandee=100.0,
        quantite_totale_livree=0.0,
        taux_livraison=0.0,
        fournisseur_code_sap="BP001001",
        fournisseur_pays="MAR",
        fournisseur_taux_retard=0.12,
        fournisseur_delai_moyen=6.0,
        fournisseur_score_perf=0.88,
        data_source=DataSourceEnum.CSV_FILE,
    )


@pytest.fixture
def sample_order_pending() -> OrderCanonical:
    """Order still in progress (no target yet)."""
    return OrderCanonical(
        order_id="test-0002",
        numero_sap="4500001002",
        order_type="NB",
        statut=StatutEnum.EN_ATTENTE,
        urgence=UrgenceEnum.NORMALE,
        date_creation=datetime(2025, 4, 12, 9, 0, tzinfo=timezone.utc),
        date_previsionnelle=date(2025, 5, 20),
        date_livraison_reelle=None,
        date_modification=datetime(2025, 4, 12, 9, 0, tzinfo=timezone.utc),
        montant_total=47500.0,
        devise="EUR",
        company_code="1000",
        purchasing_org="1000",
        purchasing_group="010",
        postes_en_retard=0,
        nb_lignes=0,
        data_source=DataSourceEnum.CSV_FILE,
    )


@pytest.fixture
def sample_supplier() -> SupplierCanonical:
    """Sample supplier fixture."""
    return SupplierCanonical(
        supplier_id="f-test-0001",
        code_sap="BP001001",
        nom="ACME Maroc Supply",
        pays="MAR",
        taux_retard_moyen=0.12,
        delai_moyen_jours=6.0,
        score_performance=0.88,
        actif=True,
    )


@pytest.fixture
def sample_orders_df() -> pd.DataFrame:
    """Sample orders DataFrame with canonical column names."""
    return pd.DataFrame([
        {
            "order_id": "a1-001",
            "numero_sap": "4500001003",
            "order_type": "NB",
            "statut": "LIVRE",
            "urgence": "NORMALE",
            "date_creation": "2025-03-01T07:30:00Z",
            "date_previsionnelle": "2025-04-01",
            "date_livraison_reelle": "2025-03-28",
            "date_modification": "2025-03-28T14:00:00Z",
            "montant_total": 23800.0,
            "devise": "EUR",
            "company_code": "1000",
            "purchasing_org": "1000",
            "purchasing_group": "020",
            "marqueur_suppression": False,
            "statut_approbation": "X",
            "postes_en_retard": 0,
            "score_priorite": 30.0,
            "nb_lignes": 1,
            "quantite_totale_commandee": 50.0,
            "quantite_totale_livree": 50.0,
            "taux_livraison": 1.0,
            "fournisseur_id": "f-001",
            "fournisseur_code_sap": "BP001003",
            "fournisseur_pays": "ESP",
            "fournisseur_taux_retard": 0.28,
            "fournisseur_delai_moyen": 12.0,
            "fournisseur_score_perf": 0.72,
        },
        {
            "order_id": "a1-002",
            "numero_sap": "4500001010",
            "order_type": "NB",
            "statut": "LIVRE",
            "urgence": "NORMALE",
            "date_creation": "2025-02-10T08:00:00Z",
            "date_previsionnelle": "2025-03-10",
            "date_livraison_reelle": "2025-03-08",
            "date_modification": "2025-03-08T12:00:00Z",
            "montant_total": 34700.0,
            "devise": "EUR",
            "company_code": "1000",
            "purchasing_org": "1000",
            "purchasing_group": "030",
            "marqueur_suppression": False,
            "statut_approbation": "X",
            "postes_en_retard": 0,
            "score_priorite": 35.0,
            "nb_lignes": 0,
            "quantite_totale_commandee": 0.0,
            "quantite_totale_livree": 0.0,
            "taux_livraison": 0.0,
            "fournisseur_id": "f-004",
            "fournisseur_code_sap": "BP001004",
            "fournisseur_pays": "DZA",
            "fournisseur_taux_retard": 0.08,
            "fournisseur_delai_moyen": 8.0,
            "fournisseur_score_perf": 0.91,
        },
    ])
