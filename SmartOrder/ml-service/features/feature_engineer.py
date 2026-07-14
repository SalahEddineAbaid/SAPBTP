"""
SmartOrder ML — Feature engineering pipeline.

Transforms OrderCanonical records (or DataFrames) into ML-ready feature
vectors. Produces 17 features designed for small datasets (ratio < 1:3).

Features are split into four groups:
    1. Temporal    — date-based calculations
    2. Supplier    — supplier performance metrics (pass-through, with defaults)
    3. Amount      — monetary and volume features
    4. Categorical — ordinal or native encoding for CatBoost

Encoding strategy for categorical features:
    - urgence, statut_approbation: ordinal encoding (NORMALE=0, HAUTE=1, CRITIQUE=2)
    - fournisseur_pays, purchasing_group, order_type: one-hot encoding for sklearn;
      kept as strings for CatBoost native handling

Why NOT target encoding for fournisseur_pays?
    With only 4–9 distinct supplier country values in the real data, target encoding
    would directly leak label information into the feature:
        1. Each category is replaced by its mean target → trivial data leakage.
        2. On such a small cardinality, cross-validation cannot isolate the leakage.
        3. One-hot is safe, interpretable, and adds at most ~5 binary columns.
    If cardinality grows significantly (>30 countries), revisit with proper
    out-of-fold target encoding isolated in training code only.

Empty fournisseur_id handling:
    Approximately 90% of real orders in db/data/ have no fournisseur_id.
    When supplier data is missing, features default to:
        supplier_delay_rate   → 0.0  (optimistic: assume no delay history)
        supplier_avg_lead_time → 0.0  (unknown)
        supplier_perf_score   → 1.0  (optimistic default)
    These are conservative, non-leaking defaults. The model will learn that
    fournisseur_pays="" (empty string) correlates with unknown supplier.
    Document and re-evaluate once more supplier linkage data is available.
"""

from __future__ import annotations

import math
from datetime import date, datetime
from typing import Optional, Sequence

import numpy as np
import pandas as pd

from config.logging_config import get_logger
from schemas.canonical import MLFeatureVector, OrderCanonical

logger = get_logger("feature_engineer")


class FeatureEngineer:
    """
    Transforms OrderCanonical data into ML feature vectors.

    Supports both:
        - Object mode: list[OrderCanonical] → list[MLFeatureVector]
        - DataFrame mode: pd.DataFrame → pd.DataFrame (for batch training)

    This module is intentionally free of FastAPI, MLflow, and any runtime
    dependency that would not be available in a Google Colab environment.
    It can be imported standalone via:
        pip install -e git+<repo_url>#subdirectory=ml-service
    or:
        sys.path.insert(0, "/path/to/ml-service")
        from features.feature_engineer import FeatureEngineer
    """

    # Ordinal mappings for categorical features
    URGENCE_MAP = {"NORMALE": 0, "HAUTE": 1, "CRITIQUE": 2}
    APPROBATION_MAP = {"": 0, "X": 1, "R": 2}

    # Default values for missing supplier data (~90% of real orders have no fournisseur_id)
    DEFAULT_SUPPLIER_DELAY_RATE: float = 0.0
    DEFAULT_SUPPLIER_AVG_LEAD_TIME: float = 0.0
    DEFAULT_SUPPLIER_PERF_SCORE: float = 1.0

    # Columns that CatBoost handles natively (no encoding needed)
    CATBOOST_CAT_COLS = ["fournisseur_pays", "purchasing_group", "order_type"]

    def __init__(self, reference_date: Optional[date] = None) -> None:
        """
        Args:
            reference_date: Date to use for age calculations.
                            Defaults to today if None.
        """
        self.reference_date = reference_date or date.today()

    # ============================================================
    # Object mode
    # ============================================================

    def transform(self, order: OrderCanonical) -> MLFeatureVector:
        """Transform a single OrderCanonical into an MLFeatureVector."""
        creation_date = (
            order.date_creation.date()
            if isinstance(order.date_creation, datetime)
            else order.date_creation
        )

        # Supplier features — use defaults when fournisseur_id is None/empty
        # (the model learns these defaults as a proxy for "unknown supplier")
        supplier_delay = order.fournisseur_taux_retard or self.DEFAULT_SUPPLIER_DELAY_RATE
        supplier_lead = order.fournisseur_delai_moyen or self.DEFAULT_SUPPLIER_AVG_LEAD_TIME
        supplier_perf = order.fournisseur_score_perf if order.fournisseur_score_perf > 0 else self.DEFAULT_SUPPLIER_PERF_SCORE

        return MLFeatureVector(
            # Temporal
            lead_time_days=(order.date_previsionnelle - creation_date).days,
            order_age_days=(self.reference_date - creation_date).days,
            month_creation=order.date_creation.month,
            day_of_week_creation=order.date_creation.weekday(),
            is_quarter_end=order.date_creation.month in (3, 6, 9, 12),
            # Supplier (with safe defaults for missing fournisseur_id)
            supplier_delay_rate=supplier_delay,
            supplier_avg_lead_time=supplier_lead,
            supplier_perf_score=supplier_perf,
            # Amount
            montant_total_log=math.log1p(order.montant_total),
            montant_par_ligne=order.montant_total / max(order.nb_lignes, 1),
            nb_lignes=order.nb_lignes,
            taux_livraison=order.taux_livraison,
            # Categorical (kept as strings for CatBoost native handling)
            urgence=order.urgence.value,
            statut_approbation=order.statut_approbation,
            fournisseur_pays=order.fournisseur_pays or "",  # empty = unknown supplier
            purchasing_group=order.purchasing_group or "",
            order_type=order.order_type,
        )

    def transform_batch(self, orders: Sequence[OrderCanonical]) -> list[MLFeatureVector]:
        """Transform a batch of OrderCanonical objects."""
        return [self.transform(o) for o in orders]

    # ============================================================
    # DataFrame mode (for training pipeline)
    # ============================================================

    def transform_dataframe(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Transform a canonical DataFrame into a feature DataFrame.

        This is the primary method used during training. It operates
        on columns directly for vectorized performance.

        Missing supplier data (fournisseur_id empty/NaN in ~90% of real orders)
        is handled by filling with documented defaults before computing features.

        Args:
            df: DataFrame with OrderCanonical column names.

        Returns:
            DataFrame with ~17 feature columns + target columns.
        """
        features = pd.DataFrame(index=df.index)

        # --- Temporal features ---
        creation = pd.to_datetime(df["date_creation"], errors="coerce")
        previs = pd.to_datetime(df["date_previsionnelle"], errors="coerce")
        ref = pd.Timestamp(self.reference_date)

        features["lead_time_days"] = (previs - creation).dt.days
        features["order_age_days"] = (ref - creation).dt.days
        features["month_creation"] = creation.dt.month
        features["day_of_week_creation"] = creation.dt.weekday
        features["is_quarter_end"] = creation.dt.month.isin([3, 6, 9, 12]).astype(int)

        # --- Supplier features ---
        # Default values are applied for orders with missing fournisseur_id.
        # These are NOT imputed from the training distribution to avoid leakage.
        # They are intentional, documented business defaults (see module docstring).
        features["supplier_delay_rate"] = (
            pd.to_numeric(df.get("fournisseur_taux_retard", None), errors="coerce")
            .fillna(self.DEFAULT_SUPPLIER_DELAY_RATE)
        )
        features["supplier_avg_lead_time"] = (
            pd.to_numeric(df.get("fournisseur_delai_moyen", None), errors="coerce")
            .fillna(self.DEFAULT_SUPPLIER_AVG_LEAD_TIME)
        )
        features["supplier_perf_score"] = (
            pd.to_numeric(df.get("fournisseur_score_perf", None), errors="coerce")
            .fillna(self.DEFAULT_SUPPLIER_PERF_SCORE)
        )

        # --- Amount / Volume features ---
        montant = pd.to_numeric(df.get("montant_total", 0), errors="coerce").fillna(0.0)
        nb_lignes = pd.to_numeric(df.get("nb_lignes", 0), errors="coerce").fillna(0).astype(int)

        features["montant_total_log"] = np.log1p(montant)
        features["montant_par_ligne"] = montant / nb_lignes.replace(0, 1)
        features["nb_lignes"] = nb_lignes
        features["taux_livraison"] = (
            pd.to_numeric(df.get("taux_livraison", 0), errors="coerce")
            .fillna(0.0)
            .clip(0, 1)
        )

        # --- Categorical features ---
        # fournisseur_pays: empty string = unknown supplier (not an error)
        features["urgence"] = df.get("urgence", "NORMALE").fillna("NORMALE").astype(str)
        features["statut_approbation"] = df.get("statut_approbation", "").fillna("").astype(str)
        features["fournisseur_pays"] = df.get("fournisseur_pays", "").fillna("").astype(str)
        features["purchasing_group"] = df.get("purchasing_group", "").fillna("").astype(str)
        # order_type: free string — 'NB', 'ZNBH', etc. are all valid
        features["order_type"] = df.get("order_type", "NB").fillna("NB").astype(str)

        # --- Carry over targets if present ---
        if "target_class" in df.columns:
            features["target_class"] = df["target_class"]
        if "target_delay_days" in df.columns:
            features["target_delay_days"] = df["target_delay_days"]

        n_features = len([c for c in features.columns if not c.startswith("target_")])
        logger.info(
            "Feature engineering: %d samples × %d features",
            len(features),
            n_features,
        )
        return features

    def get_feature_names(self) -> list[str]:
        """Return the ordered list of feature column names."""
        return [
            "lead_time_days",
            "order_age_days",
            "month_creation",
            "day_of_week_creation",
            "is_quarter_end",
            "supplier_delay_rate",
            "supplier_avg_lead_time",
            "supplier_perf_score",
            "montant_total_log",
            "montant_par_ligne",
            "nb_lignes",
            "taux_livraison",
            "urgence",
            "statut_approbation",
            "fournisseur_pays",
            "purchasing_group",
            "order_type",
        ]

    def get_numeric_feature_names(self) -> list[str]:
        """Return only numeric feature names (for scaling)."""
        return [
            "lead_time_days",
            "order_age_days",
            "month_creation",
            "day_of_week_creation",
            "is_quarter_end",
            "supplier_delay_rate",
            "supplier_avg_lead_time",
            "supplier_perf_score",
            "montant_total_log",
            "montant_par_ligne",
            "nb_lignes",
            "taux_livraison",
        ]

    def get_categorical_feature_names(self) -> list[str]:
        """Return categorical feature names."""
        return [
            "urgence",
            "statut_approbation",
            "fournisseur_pays",
            "purchasing_group",
            "order_type",
        ]

    def encode_categoricals_for_sklearn(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Encode categorical features for sklearn models (Logistic Regression, ElasticNet).
        CatBoost/XGBoost handle categoricals natively — this method is not needed for them.

        Strategy:
            - urgence: ordinal (NORMALE=0, HAUTE=1, CRITIQUE=2)
            - statut_approbation: ordinal (''=0, X=1, R=2)
            - fournisseur_pays, purchasing_group, order_type: one-hot encoding

        NOT using target encoding because:
            1. Cardinality is very low (≤9 countries, ≤4 groups, ≤3 order types).
            2. With so few categories, target encoding leaks label information
               directly into the feature — cross-validation cannot prevent this.
            3. One-hot is interpretable, safe, and adds only a small number of columns.
        """
        result = df.copy()

        # Ordinal encode urgence
        if "urgence" in result.columns:
            result["urgence"] = result["urgence"].map(self.URGENCE_MAP).fillna(0).astype(int)

        # Ordinal encode approbation
        if "statut_approbation" in result.columns:
            result["statut_approbation"] = (
                result["statut_approbation"].map(self.APPROBATION_MAP).fillna(0).astype(int)
            )

        # One-hot encode remaining categoricals
        for col in self.CATBOOST_CAT_COLS:
            if col in result.columns:
                dummies = pd.get_dummies(result[col], prefix=col, drop_first=True)
                result = pd.concat([result.drop(columns=[col]), dummies], axis=1)

        return result
