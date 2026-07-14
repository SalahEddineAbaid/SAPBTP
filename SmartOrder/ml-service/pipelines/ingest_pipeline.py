"""
SmartOrder ML — Ingestion pipeline (end-to-end).

Orchestrates: Connector → Cleaner → Validator → SchemaMapper → Feature Store.
Supports CSV, PostgreSQL, SAP HANA, and OData sources.

CLI usage:
    python -m pipelines.ingest_pipeline --source csv
    python -m pipelines.ingest_pipeline --source csv --report
    python -m pipelines.ingest_pipeline --source csv --report --output-dir data/sandbox
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
from typing import Optional

import pandas as pd

from config.logging_config import get_logger, setup_logging
from config.settings import get_settings
from connectors.base_connector import BaseConnector
from connectors.csv_connector import CSVConnector
from preprocessing.cleaner import DataCleaner
from preprocessing.schema_mapper import SchemaMapper
from preprocessing.validator import DataValidator
from schemas.enums import DataSourceEnum

logger = get_logger("ingest_pipeline")

# Minimum labelled examples to train confidently
MIN_LABELLED_THRESHOLD = 20


class IngestPipeline:
    """
    End-to-end data ingestion pipeline.

    Flow:
        Source → Raw DataFrame → Clean → Validate → Map to Canonical → Save

    Usage:
        pipeline = IngestPipeline(source="csv", csv_dir="../../db/data")
        df = pipeline.run()
        report = pipeline.generate_report(df)
    """

    def __init__(
        self,
        source: str = "csv",
        csv_dir: Optional[str | Path] = None,
        drop_cancelled: bool = True,
    ) -> None:
        self.source = source
        self.csv_dir = csv_dir
        self.drop_cancelled = drop_cancelled
        self._settings = get_settings()
        self._cleaner: Optional[DataCleaner] = None
        self._mapper: Optional[SchemaMapper] = None
        self._validator_result = None
        self._step_counts: dict[str, int] = {}

    def run(self) -> pd.DataFrame:
        """
        Execute the full ingestion pipeline.

        Returns:
            Validated and cleaned DataFrame in canonical schema.
        """
        logger.info("=== Ingestion Pipeline START (source=%s) ===", self.source)

        # Step 1: Connect and fetch
        connector = self._create_connector()
        with connector:
            raw_df = connector.fetch_orders_enriched()

        self._step_counts["raw"] = len(raw_df)
        logger.info("Step 1 — Fetched %d raw orders", len(raw_df))

        # Step 2: Clean
        self._cleaner = DataCleaner(drop_cancelled=self.drop_cancelled)
        clean_df = self._cleaner.clean(raw_df)
        self._step_counts["after_cleaning"] = len(clean_df)
        logger.info("Step 2 — Cleaned: %s", self._cleaner.report)

        # Step 3: Validate
        validator = DataValidator()
        self._validator_result = validator.validate(clean_df)
        logger.info("Step 3 — Validation:\n%s", self._validator_result.summary())

        if not self._validator_result.is_valid:
            logger.warning("Validation failed — proceeding with warnings")

        # Step 4: Map to canonical schema
        data_source = self._resolve_data_source()
        self._mapper = SchemaMapper(data_source=data_source)
        canonical_df = self._mapper.map_to_dataframe(clean_df)
        self._step_counts["after_mapping"] = len(canonical_df)

        if self._mapper.errors:
            logger.warning("Mapping errors: %d rows skipped", len(self._mapper.errors))

        logger.info(
            "=== Ingestion Pipeline DONE — %d canonical orders ===",
            len(canonical_df),
        )
        return canonical_df

    def run_and_save(self, output_dir: Optional[Path] = None) -> pd.DataFrame:
        """Run pipeline and save result to the appropriate data/ subdirectory."""
        df = self.run()

        if output_dir is None:
            if self.source == "csv":
                output_dir = self._settings.data_dir / "sandbox"
            else:
                output_dir = self._settings.data_real_dir

        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / "orders_canonical.parquet"
        df.to_parquet(output_path, index=False)
        logger.info("Saved canonical data to %s", output_path)

        return df

    def generate_report(
        self, canonical_df: pd.DataFrame, output_dir: Optional[Path] = None
    ) -> str:
        """
        Generate a markdown data quality report.

        Args:
            canonical_df: The canonical DataFrame output of run().
            output_dir: Where to save data_quality_report.md (default: data/sandbox/).

        Returns:
            Path to the generated report as a string.
        """
        if output_dir is None:
            output_dir = self._settings.data_dir / "sandbox"
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        report_path = output_dir / "data_quality_report.md"
        content = self._build_report_markdown(canonical_df)
        report_path.write_text(content, encoding="utf-8")
        logger.info("Data quality report saved to %s", report_path)
        return str(report_path)

    # --------------------------------------------------------
    # Report builder
    # --------------------------------------------------------

    def _build_report_markdown(self, canonical_df: pd.DataFrame) -> str:
        """Build the full markdown quality report content."""
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        cleaner_report = self._cleaner.report if self._cleaner else {}
        step_counts = cleaner_report.get("steps", self._step_counts)
        rejected_rows = self._cleaner.get_rejected_rows() if self._cleaner else []
        mapping_errors = self._mapper.errors if self._mapper else []
        capping = cleaner_report.get("outlier_capping", {})

        # Target class distribution
        target_dist: dict[str, int] = {}
        labelled_count = 0
        if "target_class" in canonical_df.columns:
            counts = canonical_df["target_class"].value_counts(dropna=False)
            for k, v in counts.items():
                label = str(k) if k is not None else "None (unlabelled)"
                target_dist[label] = int(v)
            # Count labelled = non-None
            labelled_count = int(canonical_df["target_class"].notna().sum())

        lines = [
            f"# SmartOrder ML — Data Quality Report",
            f"",
            f"**Generated:** {now}  ",
            f"**Source:** `{self.source}`  ",
            f"",
            f"---",
            f"",
            f"## 1. Pipeline Step Counts",
            f"",
            f"| Step | Rows |",
            f"|------|------|",
        ]

        step_labels = {
            "input": "Raw input (after connector fetch)",
            "after_dedup": "After duplicate removal",
            "after_drop_missing": "After drop missing essentials",
            "after_filter_cancelled": "After filter ANNULÉ",
            "final": "After all cleaning steps",
        }
        for step_key, step_label in step_labels.items():
            count = step_counts.get(step_key, "—")
            lines.append(f"| {step_label} | {count} |")

        lines += [
            f"| **After Pydantic mapping (canonical)** | **{len(canonical_df)}** |",
            f"",
            f"---",
            f"",
            f"## 2. Rejected Rows",
            f"",
        ]

        if rejected_rows:
            lines += [
                f"| # | numero_sap | reason |",
                f"|---|-----------|--------|",
            ]
            for i, r in enumerate(rejected_rows, 1):
                lines.append(f"| {i} | `{r.get('numero_sap', '?')}` | {r.get('reason', '?')} |")
        else:
            lines.append("_No rows rejected during cleaning._")

        lines += [f""]

        if mapping_errors:
            lines += [
                f"### Mapping Errors (Pydantic validation)",
                f"",
                f"| # | numero_sap | error_type | message |",
                f"|---|-----------|------------|---------|",
            ]
            for i, e in enumerate(mapping_errors, 1):
                msg = str(e.get("error", ""))[:80].replace("|", "\\|")
                lines.append(
                    f"| {i} | `{e.get('numero_sap', '?')}` | "
                    f"`{e.get('error_type', '?')}` | {msg} |"
                )
            lines.append("")

        lines += [
            f"---",
            f"",
            f"## 3. Outlier Capping",
            f"",
        ]

        if capping:
            for col, info in capping.items():
                if isinstance(info, dict):
                    lines += [
                        f"### `{col}`",
                        f"",
                        f"| Metric | Value |",
                        f"|--------|-------|",
                        f"| Pre-clamp threshold (business bound) | {info.get('pre_clamp_threshold', '—'):,.0f} |",
                        f"| Rows pre-clamped | {info.get('n_pre_clamped', 0)} |",
                        f"| Q1 (post pre-clamp) | {info.get('q1', '—')} |",
                        f"| Q3 (post pre-clamp) | {info.get('q3', '—')} |",
                        f"| IQR×3 upper cap | {info.get('iqr_upper_cap', '—')} |",
                        f"| Rows IQR-capped | {info.get('n_iqr_capped', 0)} |",
                        f"",
                        f"> **Note:** Values above the pre-clamp threshold are treated as data-entry",
                        f"> errors (e.g., 2 000 000 000 MAD for a single PO). Adjust",
                        f"> `MAX_MONTANT_PRE_CLAMP` / `MAX_POIDS_PRE_CLAMP` in `cleaner.py` if",
                        f"> your domain has legitimately large orders.",
                        f"",
                    ]
        else:
            lines.append("_Outlier capping was not performed or no outliers found._\n")

        lines += [
            f"---",
            f"",
            f"## 4. Target Class Distribution",
            f"",
        ]

        if target_dist:
            lines += [
                f"| target_class | Count | % |",
                f"|-------------|-------|---|",
            ]
            total = sum(target_dist.values())
            for label, count in sorted(target_dist.items(), key=lambda x: -x[1]):
                pct = 100 * count / total if total > 0 else 0
                lines.append(f"| `{label}` | {count} | {pct:.1f}% |")

            lines += [
                f"",
                f"**Total labelled (non-None):** {labelled_count} / {len(canonical_df)}",
                f"",
            ]
        else:
            lines.append("_No target_class column found in canonical output._\n")

        # ⚠️ Critical warning if too few labels
        if labelled_count < MIN_LABELLED_THRESHOLD:
            lines += [
                f"> [!CAUTION]",
                f"> **Only {labelled_count} labelled examples** — far below the minimum of "
                f"{MIN_LABELLED_THRESHOLD} recommended for reliable ML training.",
                f"> ",
                f"> **Actions required before training:**",
                f"> 1. Generate synthetic data (Phase 5 — CTGAN/SMOTE) to reach ≥200 labelled examples.",
                f"> 2. Collect more real orders with completed delivery dates (`date_livraison_reelle`).",
                f"> 3. Do NOT train any model on this data alone — results would be meaningless.",
                f"",
            ]

        lines += [
            f"---",
            f"",
            f"## 5. Summary",
            f"",
            f"| Metric | Value |",
            f"|--------|-------|",
            f"| Orders processed (canonical) | {len(canonical_df)} |",
            f"| Labelled (has target_class) | {labelled_count} |",
            f"| Unlabelled (in-flight / no delivery date) | {len(canonical_df) - labelled_count} |",
            f"| Mapping errors | {len(mapping_errors)} |",
            f"| Cleaning rejections | {len(rejected_rows)} |",
            f"",
        ]

        return "\n".join(lines)

    # --------------------------------------------------------
    # Helpers
    # --------------------------------------------------------

    def _create_connector(self) -> BaseConnector:
        """Factory: create the appropriate connector."""
        if self.source == "csv":
            csv_path = self.csv_dir or (
                Path(__file__).resolve().parent.parent.parent / "db" / "data"
            )
            return CSVConnector(data_dir=csv_path)

        elif self.source == "postgres":
            from connectors.postgres_connector import PostgresConnector
            return PostgresConnector()

        elif self.source == "hana":
            from connectors.hana_connector import HANAConnector
            return HANAConnector()

        elif self.source == "odata":
            from connectors.odata_connector import ODataConnector
            return ODataConnector()

        else:
            raise ValueError(f"Unknown source: {self.source!r}. Choose: csv, postgres, hana, odata")

    def _resolve_data_source(self) -> DataSourceEnum:
        source_map = {
            "csv": DataSourceEnum.CSV_FILE,
            "postgres": DataSourceEnum.POSTGRES,
            "hana": DataSourceEnum.SAP_HANA,
            "odata": DataSourceEnum.ODATA_API,
        }
        return source_map.get(self.source, DataSourceEnum.CSV_FILE)


# ============================================================
# CLI entry point
# ============================================================

def _build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="SmartOrder ML — Data Ingestion Pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--source",
        choices=["csv", "postgres", "hana", "odata"],
        default="csv",
        help="Data source connector to use (default: csv)",
    )
    parser.add_argument(
        "--report",
        action="store_true",
        help="Generate data_quality_report.md in the output directory",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="Override output directory (default: data/sandbox/ for CSV source)",
    )
    parser.add_argument(
        "--keep-cancelled",
        action="store_true",
        help="Include ANNULÉ orders (excluded by default)",
    )
    parser.add_argument(
        "--log-level",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        default="INFO",
    )
    return parser


if __name__ == "__main__":
    args = _build_arg_parser().parse_args()
    setup_logging(level=args.log_level, fmt="text")

    pipeline = IngestPipeline(
        source=args.source,
        drop_cancelled=not args.keep_cancelled,
    )
    result_df = pipeline.run_and_save(output_dir=args.output_dir)

    print(f"\n[OK] Ingestion complete: {len(result_df)} canonical orders")

    if args.report:
        report_path = pipeline.generate_report(result_df, output_dir=args.output_dir)
        print(f"[Report] Quality report: {report_path}")

    # Print target class summary to stdout regardless
    if "target_class" in result_df.columns:
        dist = result_df["target_class"].value_counts(dropna=False)
        print("\nTarget class distribution:")
        for label, count in dist.items():
            print(f"   {label!s:<30} {count:>4} ({100*count/len(result_df):.1f}%)")
        labelled = int(result_df["target_class"].notna().sum())
        print(f"\n   Labelled total: {labelled}/{len(result_df)}")
        if labelled < MIN_LABELLED_THRESHOLD:
            print(
                f"\n[WARNING] Only {labelled} labelled examples. "
                f"Synthetic data generation required before training."
            )
