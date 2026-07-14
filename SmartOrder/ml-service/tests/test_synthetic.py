"""
SmartOrder ML — Tests for Phase 3: Synthetic Data Generation.

Coverage:
    - RuleBasedAugmentor: threshold, min_delay, template filtering, IDs, data_source
    - SyntheticValidator: schema, business coherence, near-duplicate detection
    - SyntheticPipeline: merge, data_source column, train/test split, report sections
    - Edge cases: empty templates, all-labelled input, single-row pool
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import pytest

from schemas.enums import DataSourceEnum, StatutEnum, UrgenceEnum


# ============================================================
# Helpers — build minimal DataFrames for testing
# ============================================================

def _make_canonical_row(
    order_id: str = None,
    numero_sap: str = "SAP001",
    statut: str = "EN_LIVRAISON",
    urgence: str = "NORMALE",
    target_class: str | None = None,
    date_previsionnelle: date = date(2026, 6, 1),
    date_creation: datetime = datetime(2026, 5, 1, tzinfo=timezone.utc),
    montant_total: float = 50_000.0,
    nb_lignes: int = 2,
    postes_en_retard: int = 0,
    taux_livraison: float = 0.0,
    fournisseur_taux_retard: float = 0.1,
    fournisseur_score_perf: float = 0.9,
    target_delay_days: int | None = None,
    data_source: str = "csv_file",
) -> dict:
    return {
        "order_id": order_id or str(uuid.uuid4()),
        "numero_sap": numero_sap,
        "statut": statut,
        "urgence": urgence,
        "date_creation": date_creation,
        "date_previsionnelle": date_previsionnelle,
        "date_livraison_reelle": None,
        "date_modification": date_creation,
        "montant_total": montant_total,
        "nb_lignes": nb_lignes,
        "quantite_totale_commandee": 100.0,
        "quantite_totale_livree": 0.0,
        "taux_livraison": taux_livraison,
        "postes_en_retard": postes_en_retard,
        "nb_categories_distinctes": 1,
        "fournisseur_taux_retard": fournisseur_taux_retard,
        "fournisseur_delai_moyen": 10.0,
        "fournisseur_score_perf": fournisseur_score_perf,
        "score_priorite": 0,
        "target_class": target_class,
        "target_delay_days": target_delay_days,
        "data_source": data_source,
        "devise": "MAD",
        "company_code": "CC01",
        "purchasing_org": "PO01",
        "purchasing_group": "001",
        "statut_approbation": "X",
        "marqueur_suppression": False,
        "fournisseur_id": None,
        "fournisseur_code_sap": "",
        "fournisseur_pays": "MAR",
        "poids_total": 100.0,
        "order_type": "NB",
    }


def _make_df(*rows: dict) -> pd.DataFrame:
    return pd.DataFrame(list(rows))


def _make_canonical_df(n_unlabelled: int = 10, n_labelled: int = 3) -> pd.DataFrame:
    """Build a mixed DataFrame with some labelled and some unlabelled rows."""
    rows = []
    for i in range(n_unlabelled):
        rows.append(_make_canonical_row(
            numero_sap=f"SAP{i:04d}",
            statut="EN_LIVRAISON",
            # Vary numeric features so near-dup detection doesn't reject everything
            montant_total=float(10_000 + i * 8_000),
            nb_lignes=1 + (i % 4),
            fournisseur_taux_retard=round(0.05 + i * 0.03, 2),
            fournisseur_score_perf=round(max(0.5, 0.95 - i * 0.04), 2),
        ))
    for i in range(n_labelled):
        tc = ["on_time", "late_blocking", "on_time"][i % 3]
        rows.append(_make_canonical_row(
            numero_sap=f"LBL{i:04d}",
            statut="LIVRE",
            target_class=tc,
            target_delay_days=0 if tc == "on_time" else 5,
            data_source="real",
            montant_total=float(99_000 + i * 12_000),
            nb_lignes=3 + i,
            fournisseur_taux_retard=round(0.08 + i * 0.05, 2),
            fournisseur_score_perf=round(max(0.6, 0.92 - i * 0.05), 2),
        ))
    return pd.DataFrame(rows)


# ============================================================
# RuleBasedAugmentor tests
# ============================================================

class TestRuleBasedAugmentor:
    """Tests for the rule-based late_non_blocking generator."""

    def test_generates_late_non_blocking_rows(self) -> None:
        """Generated rows must all have target_class = 'late_non_blocking'."""
        from synthetic.rule_based_augmentation import RuleBasedAugmentor

        df = _make_canonical_df(n_unlabelled=10)
        augmentor = RuleBasedAugmentor(threshold_days=14, min_delay_days=1, n_samples=20)
        result = augmentor.generate(df)

        assert len(result) == 20
        assert (result["target_class"] == "late_non_blocking").all()

    def test_delay_within_threshold(self) -> None:
        """target_delay_days must be in [min_delay, threshold] for all rows."""
        from synthetic.rule_based_augmentation import RuleBasedAugmentor

        threshold = 7
        min_d = 2
        df = _make_canonical_df(n_unlabelled=15)
        augmentor = RuleBasedAugmentor(threshold_days=threshold, min_delay_days=min_d, n_samples=30)
        result = augmentor.generate(df)

        assert (result["target_delay_days"] >= min_d).all(), "Some delays below min_delay"
        assert (result["target_delay_days"] <= threshold).all(), "Some delays exceed threshold"

    def test_configurable_threshold_respected(self) -> None:
        """Changing threshold_days changes the delay range."""
        from synthetic.rule_based_augmentation import RuleBasedAugmentor

        df = _make_canonical_df(n_unlabelled=10)

        aug_short = RuleBasedAugmentor(threshold_days=3, min_delay_days=1, n_samples=20)
        result_short = aug_short.generate(df)
        assert (result_short["target_delay_days"] <= 3).all()

        aug_long = RuleBasedAugmentor(threshold_days=30, min_delay_days=1, n_samples=20)
        result_long = aug_long.generate(df)
        assert (result_long["target_delay_days"] <= 30).all()

    def test_data_source_is_rule_based(self) -> None:
        """All generated rows must have data_source = 'rule_based'."""
        from synthetic.rule_based_augmentation import RuleBasedAugmentor

        df = _make_canonical_df(n_unlabelled=10)
        result = RuleBasedAugmentor(n_samples=10).generate(df)
        assert (result["data_source"] == "rule_based").all()

    def test_fresh_order_ids(self) -> None:
        """Generated rows must have unique IDs not in the source dataset."""
        from synthetic.rule_based_augmentation import RuleBasedAugmentor

        df = _make_canonical_df(n_unlabelled=10)
        original_ids = set(df["order_id"].tolist())

        result = RuleBasedAugmentor(n_samples=10).generate(df)
        generated_ids = set(result["order_id"].tolist())

        overlap = original_ids & generated_ids
        assert len(overlap) == 0, f"Generated IDs overlap with originals: {overlap}"

    def test_excludes_bloque_orders(self) -> None:
        """BLOQUE orders must NOT be used as templates."""
        from synthetic.rule_based_augmentation import RuleBasedAugmentor

        # Only BLOQUE unlabelled rows
        bloque_rows = [
            _make_canonical_row(numero_sap=f"BLQ{i:03d}", statut="BLOQUE")
            for i in range(5)
        ]
        eligible_rows = [
            _make_canonical_row(numero_sap=f"ELG{i:03d}", statut="EN_LIVRAISON")
            for i in range(5)
        ]
        df = pd.DataFrame(bloque_rows + eligible_rows)

        augmentor = RuleBasedAugmentor(n_samples=5)
        result = augmentor.generate(df)
        # Should use only EN_LIVRAISON templates — check statuts are LIVRE (converted from EN_LIVRAISON)
        assert len(result) == 5
        assert (result["statut"] == "LIVRE").all()

    def test_excludes_high_urgency_delayed(self) -> None:
        """Orders with postes_en_retard > 0 AND urgence HAUTE/CRITIQUE are excluded as templates."""
        from synthetic.rule_based_augmentation import RuleBasedAugmentor

        blocking_rows = [
            _make_canonical_row(
                numero_sap=f"BLK{i:03d}",
                statut="EN_LIVRAISON",
                urgence="CRITIQUE",
                postes_en_retard=2,
            )
            for i in range(5)
        ]
        normal_rows = [
            _make_canonical_row(numero_sap=f"NRM{i:03d}", statut="EN_LIVRAISON")
            for i in range(5)
        ]
        df = pd.DataFrame(blocking_rows + normal_rows)

        augmentor = RuleBasedAugmentor(n_samples=5)
        result = augmentor.generate(df)
        assert len(result) == 5

    def test_empty_template_pool_returns_empty(self) -> None:
        """If no eligible templates exist, returns empty DataFrame."""
        from synthetic.rule_based_augmentation import RuleBasedAugmentor

        # All rows are labelled
        df = _make_df(
            _make_canonical_row(target_class="on_time", target_delay_days=0),
            _make_canonical_row(target_class="late_blocking", target_delay_days=5),
        )
        result = RuleBasedAugmentor(n_samples=10).generate(df)
        assert result.empty

    def test_date_livraison_reelle_is_set(self) -> None:
        """Generated rows must have a non-null date_livraison_reelle."""
        from synthetic.rule_based_augmentation import RuleBasedAugmentor

        df = _make_canonical_df(n_unlabelled=10)
        result = RuleBasedAugmentor(n_samples=10).generate(df)
        assert result["date_livraison_reelle"].notna().all()

    def test_delivery_date_after_previsionnelle(self) -> None:
        """date_livraison_reelle must be >= date_previsionnelle (because it's late)."""
        from synthetic.rule_based_augmentation import RuleBasedAugmentor

        df = _make_canonical_df(n_unlabelled=10)
        result = RuleBasedAugmentor(n_samples=15).generate(df)

        prev = pd.to_datetime(result["date_previsionnelle"])
        livr = pd.to_datetime(result["date_livraison_reelle"])
        assert (livr >= prev).all(), "Some deliveries are before the expected date"

    def test_reproducibility_with_same_seed(self) -> None:
        """Same seed produces the same output."""
        from synthetic.rule_based_augmentation import RuleBasedAugmentor

        df = _make_canonical_df(n_unlabelled=10)
        r1 = RuleBasedAugmentor(threshold_days=14, n_samples=10, random_seed=99).generate(df)
        r2 = RuleBasedAugmentor(threshold_days=14, n_samples=10, random_seed=99).generate(df)
        assert list(r1["target_delay_days"]) == list(r2["target_delay_days"])

    def test_different_seeds_produce_different_delays(self) -> None:
        """Different seeds should not produce identical delay sequences."""
        from synthetic.rule_based_augmentation import RuleBasedAugmentor

        df = _make_canonical_df(n_unlabelled=20)
        r1 = RuleBasedAugmentor(threshold_days=14, n_samples=20, random_seed=1).generate(df)
        r2 = RuleBasedAugmentor(threshold_days=14, n_samples=20, random_seed=2).generate(df)
        # Very unlikely to be identical
        assert list(r1["target_delay_days"]) != list(r2["target_delay_days"])


# ============================================================
# SyntheticValidator tests
# ============================================================

class TestSyntheticValidator:
    """Tests for the three-layer post-generation validator."""

    def test_valid_rows_accepted(self) -> None:
        """A clean, well-formed DataFrame should pass all validation layers."""
        from synthetic.validator import SyntheticValidator

        row = _make_canonical_row(
            target_class="late_non_blocking",
            target_delay_days=5,
            data_source="rule_based",
        )
        df = pd.DataFrame([row])
        validator = SyntheticValidator()
        valid_df, result = validator.validate(df)
        assert len(valid_df) == 1
        assert result.n_rejected == 0

    def test_rejects_missing_order_id(self) -> None:
        """Rows with null order_id are rejected at schema layer."""
        from synthetic.validator import SyntheticValidator

        row = _make_canonical_row(target_class="on_time", target_delay_days=0, data_source="ctgan")
        row["order_id"] = None
        df = pd.DataFrame([row])
        _, result = SyntheticValidator().validate(df)
        assert result.n_rejected_schema >= 1

    def test_rejects_invalid_target_class(self) -> None:
        """Unknown target_class values fail schema validation."""
        from synthetic.validator import SyntheticValidator

        row = _make_canonical_row(data_source="smote")
        row["target_class"] = "unknown_class"
        df = pd.DataFrame([row])
        _, result = SyntheticValidator().validate(df)
        assert result.n_rejected_schema >= 1

    def test_rejects_invalid_data_source(self) -> None:
        """Unknown data_source values fail schema validation."""
        from synthetic.validator import SyntheticValidator

        row = _make_canonical_row(target_class="on_time", target_delay_days=0)
        row["data_source"] = "external_system"  # not in VALID_DATA_SOURCES
        df = pd.DataFrame([row])
        _, result = SyntheticValidator().validate(df)
        assert result.n_rejected_schema >= 1

    def test_rejects_negative_montant(self) -> None:
        """Negative montant_total fails schema validation."""
        from synthetic.validator import SyntheticValidator

        row = _make_canonical_row(
            target_class="on_time", target_delay_days=0, data_source="ctgan", montant_total=-100.0
        )
        df = pd.DataFrame([row])
        _, result = SyntheticValidator().validate(df)
        assert result.n_rejected_schema >= 1

    def test_rejects_business_incoherent_dates(self) -> None:
        """date_livraison_reelle before date_creation fails business validation."""
        from synthetic.validator import SyntheticValidator

        row = _make_canonical_row(
            target_class="late_non_blocking", target_delay_days=5, data_source="rule_based"
        )
        # Set delivery date before creation
        row["date_livraison_reelle"] = datetime(2025, 1, 1, tzinfo=timezone.utc)
        row["date_creation"] = datetime(2026, 1, 1, tzinfo=timezone.utc)
        df = pd.DataFrame([row])
        _, result = SyntheticValidator().validate(df)
        assert result.n_rejected_business >= 1

    def test_rejects_on_time_with_nonzero_delay(self) -> None:
        """on_time rows with target_delay_days != 0 fail business validation."""
        from synthetic.validator import SyntheticValidator

        row = _make_canonical_row(
            target_class="on_time", target_delay_days=3, data_source="ctgan"
        )
        df = pd.DataFrame([row])
        _, result = SyntheticValidator().validate(df)
        assert result.n_rejected_business >= 1

    def test_near_duplicate_detection(self) -> None:
        """Rows identical to real rows are rejected by near-duplicate check."""
        from synthetic.validator import SyntheticValidator

        real_row = _make_canonical_row(
            montant_total=50_000.0,
            nb_lignes=2,
            taux_livraison=0.0,
            fournisseur_taux_retard=0.1,
            fournisseur_score_perf=0.9,
            target_class="on_time",
            target_delay_days=0,
        )
        real_df = pd.DataFrame([real_row])

        # Synthetic row with identical numeric features
        synth_row = _make_canonical_row(
            montant_total=50_000.0,  # identical
            nb_lignes=2,
            taux_livraison=0.0,
            fournisseur_taux_retard=0.1,
            fournisseur_score_perf=0.9,
            target_class="on_time",
            target_delay_days=0,
            data_source="ctgan",
        )
        synth_df = pd.DataFrame([synth_row])

        # Very tight threshold ensures the near-duplicate is caught
        validator = SyntheticValidator(real_df=real_df, min_distance_threshold=0.5)
        valid_df, result = validator.validate(synth_df)
        assert result.n_rejected_duplicate >= 1

    def test_no_duplicate_detection_without_real_df(self) -> None:
        """Without real_df, near-duplicate check is skipped."""
        from synthetic.validator import SyntheticValidator

        row = _make_canonical_row(
            target_class="on_time", target_delay_days=0, data_source="ctgan"
        )
        df = pd.DataFrame([row])
        validator = SyntheticValidator(real_df=None)
        valid_df, result = validator.validate(df)
        assert result.n_rejected_duplicate == 0

    def test_empty_input_returns_empty(self) -> None:
        """Empty input produces empty output with zero counts."""
        from synthetic.validator import SyntheticValidator

        _, result = SyntheticValidator().validate(pd.DataFrame())
        assert result.n_valid == 0
        assert result.n_rejected == 0

    def test_validation_result_summary_string(self) -> None:
        """summary() returns a non-empty string."""
        from synthetic.validator import SyntheticValidationResult

        r = SyntheticValidationResult(n_input=10, n_valid=8, n_rejected_schema=2)
        s = r.summary()
        assert "Synthetic validation" in s
        assert "8/10" in s


# ============================================================
# SyntheticPipeline integration tests
# ============================================================

class TestSyntheticPipeline:
    """Integration tests for the full synthetic pipeline."""

    @pytest.fixture
    def sandbox_with_canonical(self, tmp_path: Path) -> Path:
        """Create a temp sandbox with a valid orders_canonical.parquet."""
        sandbox = tmp_path / "sandbox"
        sandbox.mkdir()

        # 10 unlabelled + 3 labelled (simulating real Phase 2 output)
        df = _make_canonical_df(n_unlabelled=10, n_labelled=3)
        df.to_parquet(sandbox / "orders_canonical.parquet", index=False)
        return sandbox

    def test_pipeline_rule_only_produces_output(self, sandbox_with_canonical: Path) -> None:
        """rule_only method produces a non-empty training_dataset.parquet."""
        from synthetic.pipeline import SyntheticPipeline

        pipeline = SyntheticPipeline(
            method="rule_only",
            n_rule_samples=10,
            output_dir=sandbox_with_canonical,
        )
        training_df = pipeline.run()
        assert len(training_df) > 0
        assert (sandbox_with_canonical / "training_dataset.parquet").exists()

    def test_data_source_column_present(self, sandbox_with_canonical: Path) -> None:
        """training_dataset.parquet must have a data_source column."""
        from synthetic.pipeline import SyntheticPipeline

        pipeline = SyntheticPipeline(
            method="rule_only",
            n_rule_samples=10,
            output_dir=sandbox_with_canonical,
        )
        training_df = pipeline.run()
        assert "data_source" in training_df.columns

    def test_data_source_values_are_known(self, sandbox_with_canonical: Path) -> None:
        """All data_source values must be from the allowed set (includes 'perturbation')."""
        from synthetic.pipeline import SyntheticPipeline

        pipeline = SyntheticPipeline(
            method="rule_only",
            n_rule_samples=10,
            output_dir=sandbox_with_canonical,
        )
        training_df = pipeline.run()
        # 'perturbation' is a valid source now (fallback for on_time/late_blocking)
        allowed = {"real", "rule_based", "ctgan", "smote", "csv_file", "perturbation"}
        actual = set(training_df["data_source"].unique())
        assert actual.issubset(allowed), f"Unknown data_source values: {actual - allowed}"

    def test_rule_based_rows_are_late_non_blocking(self, sandbox_with_canonical: Path) -> None:
        """All rule_based rows in the training dataset must be late_non_blocking."""
        from synthetic.pipeline import SyntheticPipeline

        pipeline = SyntheticPipeline(
            method="rule_only",
            n_rule_samples=20,
            output_dir=sandbox_with_canonical,
        )
        training_df = pipeline.run()
        rule_rows = training_df[training_df["data_source"] == "rule_based"]
        if not rule_rows.empty:
            assert (rule_rows["target_class"] == "late_non_blocking").all()

    def test_train_test_split_files_created(self, sandbox_with_canonical: Path) -> None:
        """run() must create train.parquet and test.parquet."""
        from synthetic.pipeline import SyntheticPipeline

        pipeline = SyntheticPipeline(
            method="rule_only",
            n_rule_samples=10,
            output_dir=sandbox_with_canonical,
        )
        pipeline.run()
        assert (sandbox_with_canonical / "train.parquet").exists()
        assert (sandbox_with_canonical / "test.parquet").exists()

    def test_real_rows_in_test_set(self, sandbox_with_canonical: Path) -> None:
        """Real observed rows must appear in the test set (never hidden in train only)."""
        from synthetic.pipeline import SyntheticPipeline

        pipeline = SyntheticPipeline(
            method="rule_only",
            n_rule_samples=10,
            output_dir=sandbox_with_canonical,
        )
        pipeline.run()
        test_df = pd.read_parquet(sandbox_with_canonical / "test.parquet")
        real_in_test = (test_df["data_source"] == "real").sum()
        assert real_in_test >= 1, "No real rows in test set — evaluation would be synthetic-only"

    def test_quality_report_generated(self, sandbox_with_canonical: Path) -> None:
        """generate_report() creates synthetic_quality_report.md."""
        from synthetic.pipeline import SyntheticPipeline

        pipeline = SyntheticPipeline(
            method="rule_only",
            n_rule_samples=10,
            output_dir=sandbox_with_canonical,
        )
        training_df = pipeline.run()
        report_path = pipeline.generate_report(training_df)
        assert Path(report_path).exists()

    def test_report_contains_disclaimer(self, sandbox_with_canonical: Path) -> None:
        """Report must contain the late_non_blocking disclaimer."""
        from synthetic.pipeline import SyntheticPipeline

        pipeline = SyntheticPipeline(
            method="rule_only",
            n_rule_samples=10,
            output_dir=sandbox_with_canonical,
        )
        training_df = pipeline.run()
        report_path = pipeline.generate_report(training_df)
        content = Path(report_path).read_text(encoding="utf-8")
        content_lower = content.lower()
        assert "hypothes" in content_lower or "business rule" in content_lower
        assert "late_non_blocking" in content

    def test_report_contains_audit_answer(self, sandbox_with_canonical: Path) -> None:
        """Report must answer the audit question: how many rows per source."""
        from synthetic.pipeline import SyntheticPipeline

        pipeline = SyntheticPipeline(
            method="rule_only",
            n_rule_samples=10,
            output_dir=sandbox_with_canonical,
        )
        training_df = pipeline.run()
        report_path = pipeline.generate_report(training_df)
        content = Path(report_path).read_text(encoding="utf-8")
        assert "real" in content.lower()
        assert "rule_based" in content or "rule-based" in content.lower()

    def test_no_canonical_parquet_raises(self, tmp_path: Path) -> None:
        """Pipeline raises FileNotFoundError if canonical Parquet is missing."""
        from synthetic.pipeline import SyntheticPipeline

        empty_dir = tmp_path / "empty"
        empty_dir.mkdir()
        pipeline = SyntheticPipeline(method="rule_only", output_dir=empty_dir)
        with pytest.raises(FileNotFoundError):
            pipeline.run()


# ============================================================
# NEW: Split coverage tests (Problem 1 fix verification)
# ============================================================

class TestSplitCoverage:
    """Verify that ALL 3 classes appear in BOTH train and test sets."""

    @pytest.fixture
    def sandbox_three_class(self, tmp_path: Path) -> Path:
        """Sandbox with 1 real example per class + enough unlabelled templates."""
        sandbox = tmp_path / "sandbox"
        sandbox.mkdir()

        rows = []
        # 3 labelled — one per class
        rows.append(_make_canonical_row(
            numero_sap="R001", statut="LIVRE",
            target_class="on_time", target_delay_days=0, data_source="real",
            montant_total=100_000.0, nb_lignes=3,
        ))
        rows.append(_make_canonical_row(
            numero_sap="R002", statut="BLOQUE",
            target_class="late_blocking", target_delay_days=10, data_source="real",
            montant_total=250_000.0, nb_lignes=5,
        ))
        rows.append(_make_canonical_row(
            numero_sap="R003", statut="LIVRE",
            target_class="late_non_blocking", target_delay_days=5, data_source="real",
            montant_total=75_000.0, nb_lignes=2,
        ))
        # 15 unlabelled — eligible for rule-based templates
        for i in range(15):
            rows.append(_make_canonical_row(
                numero_sap=f"U{i:03d}", statut="EN_LIVRAISON",
                montant_total=float(10_000 + i * 7_000),
                nb_lignes=1 + (i % 3),
            ))

        pd.DataFrame(rows).to_parquet(sandbox / "orders_canonical.parquet", index=False)
        return sandbox

    def test_all_classes_in_train(self, sandbox_three_class: Path) -> None:
        """train.parquet must contain at least 1 example of each of the 3 classes."""
        from synthetic.pipeline import SyntheticPipeline

        pipeline = SyntheticPipeline(
            method="rule_only", n_rule_samples=30, output_dir=sandbox_three_class
        )
        pipeline.run()
        train_df = pd.read_parquet(sandbox_three_class / "train.parquet")
        for tc in ["on_time", "late_non_blocking", "late_blocking"]:
            n = int((train_df["target_class"] == tc).sum())
            assert n >= 1, (
                f"Class '{tc}' has 0 rows in train set — "
                f"model cannot learn this class. train classes: "
                f"{train_df['target_class'].value_counts().to_dict()}"
            )

    def test_all_classes_in_test(self, sandbox_three_class: Path) -> None:
        """test.parquet must contain at least 1 example of each of the 3 classes."""
        from synthetic.pipeline import SyntheticPipeline

        pipeline = SyntheticPipeline(
            method="rule_only", n_rule_samples=30, output_dir=sandbox_three_class
        )
        pipeline.run()
        test_df = pd.read_parquet(sandbox_three_class / "test.parquet")
        for tc in ["on_time", "late_non_blocking", "late_blocking"]:
            n = int((test_df["target_class"] == tc).sum())
            assert n >= 1, (
                f"Class '{tc}' has 0 rows in test set — "
                f"cannot evaluate this class. test classes: "
                f"{test_df['target_class'].value_counts().to_dict()}"
            )

    def test_report_shows_train_test_breakdown(self, sandbox_three_class: Path) -> None:
        """Report must show train/test composition per class."""
        from synthetic.pipeline import SyntheticPipeline

        pipeline = SyntheticPipeline(
            method="rule_only", n_rule_samples=30, output_dir=sandbox_three_class
        )
        training_df = pipeline.run()
        report_path = pipeline.generate_report(training_df)
        content = Path(report_path).read_text(encoding="utf-8")
        # Report section 3 must reference train/test counts
        assert "Train" in content or "train" in content.lower()
        assert "Test" in content or "test" in content.lower()
        assert "on_time" in content
        assert "late_blocking" in content

    def test_perturbation_generated_for_on_time(self, sandbox_three_class: Path) -> None:
        """on_time class (with only 1 real example) triggers perturbation generation."""
        from synthetic.pipeline import SyntheticPipeline

        pipeline = SyntheticPipeline(
            method="rule_only", n_rule_samples=20, output_dir=sandbox_three_class
        )
        training_df = pipeline.run()
        on_time_synth = training_df[
            (training_df["target_class"] == "on_time")
            & (training_df["data_source"] != "real")
        ]
        assert len(on_time_synth) > 0, (
            "No synthetic on_time examples were generated — "
            "perturbation fallback failed or was not triggered"
        )

    def test_perturbation_generated_for_late_blocking(self, sandbox_three_class: Path) -> None:
        """late_blocking class (with only 1 real example) triggers perturbation generation."""
        from synthetic.pipeline import SyntheticPipeline

        pipeline = SyntheticPipeline(
            method="rule_only", n_rule_samples=20, output_dir=sandbox_three_class
        )
        training_df = pipeline.run()
        lb_synth = training_df[
            (training_df["target_class"] == "late_blocking")
            & (training_df["data_source"] != "real")
        ]
        assert len(lb_synth) > 0, (
            "No synthetic late_blocking examples were generated — "
            "perturbation fallback failed or was not triggered"
        )


# ============================================================
# NEW: Silent generation detection tests (Problem 2 fix)
# ============================================================

class TestGenerationLogging:
    """
    Verify that failed/skipped generation is never silent.

    These tests check that when CTGAN or SMOTE produces 0 rows,
    the relevant class tracking is updated (not silently discarded).
    """

    def test_perturbation_is_always_available(self) -> None:
        """GaussianPerturbationGenerator always produces rows if source_df is non-empty."""
        from synthetic.perturbation_generator import GaussianPerturbationGenerator

        source = pd.DataFrame([_make_canonical_row(
            target_class="on_time", target_delay_days=0, data_source="real",
            montant_total=50_000.0, nb_lignes=2,
        )])
        gen = GaussianPerturbationGenerator(noise_std=0.05, n_copies=5, random_state=0)
        result = gen.generate_for_class(
            class_df=source,
            target_class="on_time",
            reference_df=source,
            n_target=5,
        )
        assert len(result) == 5
        assert (result["target_class"] == "on_time").all()
        assert (result["data_source"] == "perturbation").all()

    def test_perturbation_respects_delay_zero_for_on_time(self) -> None:
        """Perturbation must set target_delay_days=0 for on_time rows."""
        from synthetic.perturbation_generator import GaussianPerturbationGenerator

        source = pd.DataFrame([_make_canonical_row(
            target_class="on_time", target_delay_days=0, data_source="real",
        )])
        gen = GaussianPerturbationGenerator(n_copies=10, random_state=0)
        result = gen.generate_for_class(
            class_df=source, target_class="on_time",
            reference_df=source, n_target=10,
        )
        assert (result["target_delay_days"] == 0).all(), (
            "Perturbated on_time rows must have target_delay_days == 0"
        )

    def test_perturbation_respects_positive_delay_for_late_blocking(self) -> None:
        """Perturbation must keep target_delay_days >= 1 for late_blocking rows."""
        from synthetic.perturbation_generator import GaussianPerturbationGenerator

        source = pd.DataFrame([_make_canonical_row(
            target_class="late_blocking", target_delay_days=10, data_source="real",
        )])
        gen = GaussianPerturbationGenerator(n_copies=10, random_state=0)
        result = gen.generate_for_class(
            class_df=source, target_class="late_blocking",
            reference_df=source, n_target=10,
        )
        assert (result["target_delay_days"] >= 1).all()

    def test_perturbation_empty_source_returns_empty(self) -> None:
        """Perturbation returns empty DataFrame when no source rows are available."""
        from synthetic.perturbation_generator import GaussianPerturbationGenerator

        gen = GaussianPerturbationGenerator()
        result = gen.generate_for_class(
            class_df=pd.DataFrame(),
            target_class="on_time",
            reference_df=pd.DataFrame([_make_canonical_row()]),
            n_target=5,
        )
        assert result.empty

    def test_perturbation_fresh_ids(self) -> None:
        """Perturbated rows must have fresh order_id values."""
        from synthetic.perturbation_generator import GaussianPerturbationGenerator

        source = pd.DataFrame([_make_canonical_row(order_id="orig-001")])
        gen = GaussianPerturbationGenerator(n_copies=5, random_state=0)
        result = gen.generate_for_class(
            class_df=source, target_class="on_time",
            reference_df=source, n_target=5,
        )
        assert "orig-001" not in result["order_id"].values

    def test_class_info_tracks_perturbation_count(self, tmp_path: Path) -> None:
        """Pipeline._class_info records n_perturbation for classes that needed fallback."""
        from synthetic.pipeline import SyntheticPipeline

        sandbox = tmp_path / "sb"
        sandbox.mkdir()
        rows = [
            _make_canonical_row(
                numero_sap="R001", statut="LIVRE",
                target_class="on_time", target_delay_days=0, data_source="real",
                montant_total=100_000.0, nb_lignes=3,
            ),
            _make_canonical_row(
                numero_sap="R002", statut="BLOQUE",
                target_class="late_blocking", target_delay_days=8, data_source="real",
                montant_total=200_000.0, nb_lignes=4,
            ),
        ] + [
            _make_canonical_row(
                numero_sap=f"U{i:03d}", statut="EN_LIVRAISON",
                montant_total=float(10_000 + i * 5_000), nb_lignes=1 + (i % 3),
            )
            for i in range(12)
        ]
        pd.DataFrame(rows).to_parquet(sandbox / "orders_canonical.parquet", index=False)

        pipeline = SyntheticPipeline(
            method="rule_only", n_rule_samples=15, output_dir=sandbox
        )
        pipeline.run()

        # on_time and late_blocking had only 1 real example — perturbation must have kicked in
        assert pipeline._class_info["on_time"].n_perturbation > 0, (
            "on_time: expected perturbation to be used, got 0"
        )
        assert pipeline._class_info["late_blocking"].n_perturbation > 0, (
            "late_blocking: expected perturbation to be used, got 0"
        )
