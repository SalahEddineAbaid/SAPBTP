"""
SmartOrder ML — Tests for canonical schemas.

Validates:
    - OrderCanonical instantiation and field types
    - Auto-computed target variables (on_time, late_blocking, late_non_blocking)
    - SupplierCanonical
    - MLFeatureVector
    - PredictionResult mapping
    - Enum consistency
"""

from __future__ import annotations

from datetime import date, datetime, timezone

import pytest

from schemas.canonical import MLFeatureVector, OrderCanonical, PredictionResult, SupplierCanonical
from schemas.enums import (
    DataSourceEnum,
    RisqueEnum,
    StatutEnum,
    TargetClassEnum,
    UrgenceEnum,
    PrioriteActionEnum,
)


# ============================================================
# OrderCanonical
# ============================================================

class TestOrderCanonical:
    """Tests for OrderCanonical schema."""

    def test_create_minimal_order(self):
        """OrderCanonical can be created with only required fields."""
        order = OrderCanonical(
            order_id="test-001",
            numero_sap="4500000001",
            date_creation=datetime(2025, 1, 1, tzinfo=timezone.utc),
            date_previsionnelle=date(2025, 2, 1),
            date_modification=datetime(2025, 1, 1, tzinfo=timezone.utc),
        )
        assert order.order_id == "test-001"
        assert order.numero_sap == "4500000001"
        assert order.statut == StatutEnum.EN_ATTENTE
        assert order.urgence == UrgenceEnum.NORMALE
        assert order.montant_total == 0.0

    def test_auto_target_on_time(self, sample_order_on_time: OrderCanonical):
        """Order delivered before deadline → on_time, delay=0."""
        assert sample_order_on_time.target_class == TargetClassEnum.ON_TIME
        assert sample_order_on_time.target_delay_days == 0

    def test_auto_target_late_blocking(self, sample_order_late_blocking: OrderCanonical):
        """Blocked order past deadline → late_blocking."""
        assert sample_order_late_blocking.target_class == TargetClassEnum.LATE_BLOCKING
        assert sample_order_late_blocking.target_delay_days is not None
        assert sample_order_late_blocking.target_delay_days >= 0

    def test_auto_target_pending_no_target(self, sample_order_pending: OrderCanonical):
        """Pending order with future deadline → no target (excluded from training)."""
        # If date_previsionnelle is in the future, a non-BLOQUE, non-delivered order
        # should have no target class (None)
        assert sample_order_pending.target_class is None
        assert sample_order_pending.target_delay_days is None

    def test_auto_target_late_non_blocking(self):
        """Late delivery but not blocked → late_non_blocking."""
        order = OrderCanonical(
            order_id="test-late-nb",
            numero_sap="4500099999",
            statut=StatutEnum.LIVRE,
            urgence=UrgenceEnum.NORMALE,
            date_creation=datetime(2025, 1, 1, tzinfo=timezone.utc),
            date_previsionnelle=date(2025, 2, 1),
            date_livraison_reelle=date(2025, 2, 10),  # 9 days late
            date_modification=datetime(2025, 2, 10, tzinfo=timezone.utc),
            postes_en_retard=0,
        )
        assert order.target_class == TargetClassEnum.LATE_NON_BLOCKING
        assert order.target_delay_days == 9

    def test_taux_livraison_clamped(self):
        """taux_livraison is clamped to [0, 1]."""
        order = OrderCanonical(
            order_id="test-clamp",
            numero_sap="4500099998",
            date_creation=datetime(2025, 1, 1, tzinfo=timezone.utc),
            date_previsionnelle=date(2025, 2, 1),
            date_modification=datetime(2025, 1, 1, tzinfo=timezone.utc),
            taux_livraison=1.5,  # Should be clamped to 1.0
        )
        assert order.taux_livraison == 1.0

    def test_data_source_default(self):
        """Default data_source is csv_file."""
        order = OrderCanonical(
            order_id="test-src",
            numero_sap="4500099997",
            date_creation=datetime(2025, 1, 1, tzinfo=timezone.utc),
            date_previsionnelle=date(2025, 2, 1),
            date_modification=datetime(2025, 1, 1, tzinfo=timezone.utc),
        )
        assert order.data_source == DataSourceEnum.CSV_FILE


# ============================================================
# SupplierCanonical
# ============================================================

class TestSupplierCanonical:
    """Tests for SupplierCanonical schema."""

    def test_create_supplier(self, sample_supplier: SupplierCanonical):
        assert sample_supplier.code_sap == "BP001001"
        assert sample_supplier.pays == "MAR"
        assert 0.0 <= sample_supplier.taux_retard_moyen <= 1.0
        assert sample_supplier.score_performance == 0.88

    def test_supplier_defaults(self):
        supplier = SupplierCanonical(
            supplier_id="s-001",
            code_sap="BP999",
            nom="Test Supplier",
            pays="FRA",
        )
        assert supplier.taux_retard_moyen == 0.0
        assert supplier.score_performance == 1.0
        assert supplier.actif is True


# ============================================================
# MLFeatureVector
# ============================================================

class TestMLFeatureVector:
    """Tests for MLFeatureVector schema."""

    def test_create_feature_vector(self):
        fv = MLFeatureVector(
            lead_time_days=30,
            order_age_days=60,
            month_creation=4,
            day_of_week_creation=2,
            is_quarter_end=False,
            supplier_delay_rate=0.12,
            supplier_avg_lead_time=6.0,
            supplier_perf_score=0.88,
            montant_total_log=11.7,
            montant_par_ligne=125000.0,
            nb_lignes=2,
            taux_livraison=0.0,
            urgence="HAUTE",
            statut_approbation="X",
            fournisseur_pays="MAR",
            purchasing_group="010",
            order_type="NB",
        )
        assert fv.lead_time_days == 30
        assert fv.urgence == "HAUTE"
        assert fv.fournisseur_pays == "MAR"

    def test_feature_vector_defaults(self):
        fv = MLFeatureVector(
            lead_time_days=10,
            order_age_days=5,
            month_creation=1,
            day_of_week_creation=0,
        )
        assert fv.supplier_delay_rate == 0.0
        assert fv.urgence == "NORMALE"
        assert fv.order_type == "NB"


# ============================================================
# PredictionResult
# ============================================================

class TestPredictionResult:
    """Tests for PredictionResult schema."""

    def test_create_prediction(self):
        pred = PredictionResult(
            risque_label=RisqueEnum.MOYEN,
            risque_score=0.45,
            risque_probabilites={"FAIBLE": 0.3, "MOYEN": 0.45, "ELEVE": 0.25},
            duree_estimee_jours=35.0,
            score_composite=0.62,
            priorite_action=PrioriteActionEnum.SURVEILLER,
            suggestion="Surveiller les délais fournisseur",
            modele_version="v1.0.0",
        )
        assert pred.risque_label == RisqueEnum.MOYEN
        assert pred.score_composite == 0.62

    def test_map_target_to_risque(self):
        """Test backward-compatible mapping from TargetClassEnum to RisqueEnum."""
        pred = PredictionResult(
            risque_label=RisqueEnum.FAIBLE,
            risque_score=0.0,
            duree_estimee_jours=0.0,
            score_composite=0.0,
            suggestion="",
            modele_version="v1.0.0",
            target_class_predicted=TargetClassEnum.LATE_BLOCKING,
        )
        pred.map_target_to_risque()
        assert pred.risque_label == RisqueEnum.ELEVE


# ============================================================
# Enums
# ============================================================

class TestEnums:
    """Test enum values match CDS schema."""

    def test_statut_values(self):
        expected = {"EN_ATTENTE", "EN_COURS", "EN_LIVRAISON", "LIVRE", "ANNULE", "BLOQUE"}
        actual = {e.value for e in StatutEnum}
        assert actual == expected

    def test_urgence_values(self):
        expected = {"NORMALE", "HAUTE", "CRITIQUE"}
        actual = {e.value for e in UrgenceEnum}
        assert actual == expected

    def test_target_class_values(self):
        expected = {"on_time", "late_non_blocking", "late_blocking"}
        actual = {e.value for e in TargetClassEnum}
        assert actual == expected
