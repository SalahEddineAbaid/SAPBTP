"""
SmartOrder ML — CTGAN synthetic data generator.

Uses the SDV (Synthetic Data Vault) library's CTGAN model to generate
synthetic training examples for the ``on_time`` and ``late_blocking``
classes (which have at least some real examples as seed).

IMPORTANT: ``late_non_blocking`` rows are NOT generated here — they must
first be seeded by ``rule_based_augmentation.py``.  CTGAN is then applied
to the enriched dataset (real + rule-based seed) so the ``late_non_blocking``
class has *some* source rows to interpolate from.

PREREQUISITES
-------------
    pip install sdv>=1.0

SDV ≥ 1.0 uses a simplified API:
    from sdv.single_table import CTGANSynthesizer

LIMITATIONS
-----------
- CTGAN on very small datasets (< 50 rows per class) may produce unstable
  or noisy results.  The validator.py post-processing step is critical.
- Training time: ~1-5 minutes for 300 epochs on CPU.
- Output is NOT deterministic across OS/CPU architectures even with a fixed
  random_state (CTGAN uses PyTorch internally).
"""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Optional

import pandas as pd
import yaml

from config.logging_config import get_logger
from config.settings import get_settings

logger = get_logger("synthetic.ctgan")

_CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "model_config.yaml"

# Columns used for CTGAN training (exclude IDs and metadata)
_CTGAN_FEATURE_COLS = [
    "montant_total",
    "nb_lignes",
    "quantite_totale_commandee",
    "quantite_totale_livree",
    "taux_livraison",
    "postes_en_retard",
    "nb_categories_distinctes",
    "fournisseur_taux_retard",
    "fournisseur_delai_moyen",
    "fournisseur_score_perf",
    "score_priorite",
    "target_delay_days",
    # Categorical
    "statut",
    "urgence",
    "order_type",
    "devise",
    "fournisseur_pays",
]


def _load_ctgan_config() -> dict:
    with open(_CONFIG_PATH, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    return cfg.get("synthetic", {}).get("ctgan", {})


class CTGANGenerator:
    """
    Generates synthetic rows using CTGAN from the SDV library.

    Parameters
    ----------
    n_samples : int
        Target number of synthetic rows per class.
    epochs : int | None
        CTGAN training epochs. Loaded from config if None.
    batch_size : int | None
        CTGAN batch size. Loaded from config if None.
    random_state : int
        Random seed passed to CTGANSynthesizer.
    """

    def __init__(
        self,
        n_samples: int = 50,
        epochs: Optional[int] = None,
        batch_size: Optional[int] = None,
        random_state: int = 42,
    ) -> None:
        cfg = _load_ctgan_config()
        self.n_samples = n_samples
        self.epochs = epochs if epochs is not None else int(cfg.get("epochs", 300))
        self.batch_size = batch_size if batch_size is not None else int(cfg.get("batch_size", 50))
        self.pac = int(cfg.get("pac", 1))
        self.random_state = random_state
        self._synthesizers: dict[str, object] = {}

    def generate(self, enriched_df: pd.DataFrame) -> pd.DataFrame:
        """
        Train CTGAN per target class and generate synthetic rows.

        Parameters
        ----------
        enriched_df : pd.DataFrame
            Labelled rows (real + rule-based).  Must have a non-null
            ``target_class`` column.

        Returns
        -------
        pd.DataFrame
            Synthetic rows with ``data_source = 'ctgan'``.
        """
        try:
            from sdv.single_table import CTGANSynthesizer
            from sdv.metadata import SingleTableMetadata
        except ImportError:
            logger.error(
                "sdv is not installed. Run: pip install sdv>=1.0\n"
                "CTGAN generation skipped — returning empty DataFrame."
            )
            return pd.DataFrame()

        labelled = enriched_df[enriched_df["target_class"].notna()].copy()
        if labelled.empty:
            logger.warning("No labelled rows for CTGAN training — returning empty DataFrame")
            return pd.DataFrame()

        all_synth: list[pd.DataFrame] = []
        for target_class in labelled["target_class"].unique():
            class_df = labelled[labelled["target_class"] == target_class].copy()
            logger.info(
                "Training CTGAN for class '%s' with %d source rows (%d epochs, batch=%d)",
                target_class, len(class_df), self.epochs, self.batch_size,
            )

            if len(class_df) < 2:
                logger.warning(
                    "Class '%s' has only %d row(s) — skipping CTGAN (need >= 2).",
                    target_class, len(class_df),
                )
                continue

            train_df = self._prepare_features(class_df)
            metadata = SingleTableMetadata()
            metadata.detect_from_dataframe(train_df)

            synthesizer = CTGANSynthesizer(
                metadata,
                epochs=self.epochs,
                batch_size=max(self.batch_size, len(class_df)),
                pac=self.pac,
                verbose=False,
            )
            synthesizer.fit(train_df)
            self._synthesizers[str(target_class)] = synthesizer

            synth = synthesizer.sample(num_rows=self.n_samples)
            synth["target_class"] = target_class
            synth["data_source"] = "ctgan"
            synth["order_id"] = [f"synth-ctgan-{uuid.uuid4()}" for _ in range(len(synth))]
            synth["numero_sap"] = [f"CTGN{i:06d}" for i in range(len(synth))]
            all_synth.append(synth)

        if not all_synth:
            return pd.DataFrame()

        result = pd.concat(all_synth, ignore_index=True)
        logger.info("CTGAN generated %d rows across %d classes", len(result), len(all_synth))
        return result

    def _prepare_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Select and clean feature columns for CTGAN training."""
        available = [c for c in _CTGAN_FEATURE_COLS if c in df.columns]
        train = df[available].copy()

        # Fill nulls with sensible defaults
        for col in train.select_dtypes(include="number").columns:
            train[col] = pd.to_numeric(train[col], errors="coerce").fillna(0.0)
        for col in train.select_dtypes(include="object").columns:
            train[col] = train[col].fillna("").astype(str)

        return train


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def _run() -> None:
    from config.logging_config import setup_logging
    setup_logging(level="INFO", fmt="text")

    settings = get_settings()
    sandbox = settings.data_dir / "sandbox"

    # Load enriched labelled dataset (real + rule-based)
    rule_path = sandbox / "rule_based_synthetic.parquet"
    canonical_path = sandbox / "orders_canonical.parquet"

    if not canonical_path.exists():
        logger.error("Canonical Parquet not found — run ingest_pipeline first.")
        return

    dfs = [pd.read_parquet(canonical_path)]
    if rule_path.exists():
        dfs.append(pd.read_parquet(rule_path))
    combined = pd.concat(dfs, ignore_index=True)

    generator = CTGANGenerator(n_samples=50, epochs=300)
    synthetic = generator.generate(combined)

    if synthetic.empty:
        logger.warning("No CTGAN rows generated.")
        return

    output = sandbox / "ctgan_synthetic.parquet"
    synthetic.to_parquet(output, index=False)
    logger.info("Saved %d CTGAN rows to %s", len(synthetic), output)
    print(f"\n[OK] CTGAN generation: {len(synthetic)} rows -> {output}")


if __name__ == "__main__":
    _run()
