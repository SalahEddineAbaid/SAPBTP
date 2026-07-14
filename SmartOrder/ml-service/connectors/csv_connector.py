"""
SmartOrder ML — CSV file connector.

Reads the CDS seed data from db/data/ and maps column names to canonical schema.
Handles the heterogeneous CSV schemas from SAP export files.

Column mapping reference (CSV header → canonical field):
    smartorder-Orders.csv / smartorder_orders.csv:
        ID / id → order_id
        numero_sap → numero_sap
        type → order_type
        statut → statut
        urgence → urgence
        date_creation → date_creation
        date_previsionnelle → date_previsionnelle
        date_livraison_reelle → date_livraison_reelle
        date_modification → date_modification
        montant_total → montant_total
        devise → devise
        company_code → company_code
        purchasing_org → purchasing_org
        purchasing_group → purchasing_group
        marqueur_suppression → marqueur_suppression
        statut_approbation → statut_approbation
        date_commande → date_commande
        postes_en_retard → postes_en_retard
        score_priorite → score_priorite
        fournisseur_ID / fournisseur_id → fournisseur_id

    smartorder-LignesCommande.csv / smartorder_lignescommande.csv:
        commande_ID / commande_id → (join key to Orders)
        quantite_commandee → (aggregated)
        quantite_livree → (aggregated)
        poids_total → (aggregated)
        categorie_article → (count distinct)

    smartorder-Fournisseurs.csv / smartorder_fournisseurs.csv:
        ID / id → supplier_id
        code_sap → fournisseur_code_sap
        pays → fournisseur_pays
        taux_retard_moyen → fournisseur_taux_retard
        delai_moyen_jours → fournisseur_delai_moyen
        score_performance → fournisseur_score_perf

Notes:
    - Supports both dash-format (smartorder-Orders.csv) and underscore-format
      (smartorder_orders.csv) file names, discovered via case-insensitive glob.
    - Supports both uppercase (legacy seed) and lowercase (real export) column names.
    - order_type is treated as a free string — values like 'ZNBH' are valid.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import pandas as pd

from config.logging_config import get_logger
from connectors.base_connector import BaseConnector

logger = get_logger("csv_connector")


# ============================================================
# Column rename mappings
# Dual-entry: uppercase (legacy seed) + lowercase (real export)
# ============================================================

ORDERS_RENAME: dict[str, str] = {
    # PK — two casings observed across seed vs real CSVs
    "ID": "order_id",
    "id": "order_id",
    # Core fields (same name in both formats)
    "numero_sap": "numero_sap",
    "type": "order_type",
    "statut": "statut",
    "urgence": "urgence",
    "date_creation": "date_creation",
    "date_previsionnelle": "date_previsionnelle",
    "date_livraison_reelle": "date_livraison_reelle",
    "date_modification": "date_modification",
    "montant_total": "montant_total",
    "devise": "devise",
    "company_code": "company_code",
    "purchasing_org": "purchasing_org",
    "purchasing_group": "purchasing_group",
    "marqueur_suppression": "marqueur_suppression",
    "statut_approbation": "statut_approbation",
    "date_commande": "date_commande",
    "postes_en_retard": "postes_en_retard",
    "score_priorite": "score_priorite",
    # FK — two casings observed
    "fournisseur_ID": "fournisseur_id",
    "fournisseur_id": "fournisseur_id",
}

LINES_RENAME: dict[str, str] = {
    "ID": "line_id",
    "id": "line_id",
    # FK — two casings observed
    "commande_ID": "order_id",
    "commande_id": "order_id",
    "numero_poste": "numero_poste",
    "code_produit": "code_produit",
    "designation_produit": "designation_produit",
    "quantite_commandee": "quantite_commandee",
    "quantite_livree": "quantite_livree",
    "prix_unitaire": "prix_unitaire",
    "unite": "unite",
    "poids_total": "poids_total",
    "categorie_article": "categorie_article",
    "plant": "plant",
}

SUPPLIERS_RENAME: dict[str, str] = {
    "ID": "supplier_id",
    "id": "supplier_id",
    "code_sap": "code_sap",
    "nom": "nom",
    "pays": "pays",
    "taux_retard_moyen": "taux_retard_moyen",
    "delai_moyen_jours": "delai_moyen_jours",
    "score_performance": "score_performance",
    "actif": "actif",
    "derniere_sync": "derniere_sync",
}

# Canonical entity keyword used for file discovery (lowercase, no accents)
_ENTITY_KEYWORDS: dict[str, list[str]] = {
    "Orders": ["orders"],
    "LignesCommande": ["lignescommande", "lignes"],
    "Fournisseurs": ["fournisseurs"],
    "Predictions": ["predictions"],
    "Alertes": ["alertes"],
    "HistoriqueStatut": ["historiquestatut", "historique"],
    "MlModels": ["mlmodels"],
    "SyncJobs": ["syncjobs"],
    "Utilisateurs": ["utilisateurs"],
}


class CSVConnector(BaseConnector):
    """
    Connector for CDS seed CSV files in db/data/.

    Reads Orders, LignesCommande, and Fournisseurs CSVs,
    renames columns to canonical names, and handles type parsing.

    Supports both filename conventions:
        - Legacy: smartorder-Orders.csv  (dash separator)
        - Real:   smartorder_orders.csv  (underscore separator)
    Discovery is case-insensitive so neither convention is assumed.
    """

    def __init__(self, data_dir: str | Path) -> None:
        self.data_dir = Path(data_dir)
        self._connected = False

    def connect(self) -> None:
        if not self.data_dir.exists():
            raise FileNotFoundError(f"Data directory not found: {self.data_dir}")
        self._connected = True
        logger.info("CSV connector ready — data_dir=%s", self.data_dir)

    def disconnect(self) -> None:
        self._connected = False

    def health_check(self) -> bool:
        return self._connected and self.data_dir.exists()

    # --------------------------------------------------------
    # Fetch methods
    # --------------------------------------------------------

    def fetch_orders(self) -> pd.DataFrame:
        """Read and rename smartorder-Orders.csv / smartorder_orders.csv."""
        path = self._find_csv("Orders")
        df = pd.read_csv(path, dtype=str)
        logger.info("Loaded %d orders from %s", len(df), path.name)

        # Rename columns (handles both casing conventions)
        df = df.rename(columns=ORDERS_RENAME)

        # De-duplicate canonical columns that may appear twice after rename
        # (e.g., if both 'id' and 'ID' exist in a mixed file)
        df = self._deduplicate_columns(df)

        # Keep only mapped canonical columns
        canonical_cols = list(dict.fromkeys(ORDERS_RENAME.values()))  # preserve order, unique
        valid_cols = [c for c in canonical_cols if c in df.columns]
        return df[valid_cols]

    def fetch_order_lines(self) -> pd.DataFrame:
        """Read and rename smartorder-LignesCommande.csv / smartorder_lignescommande.csv."""
        path = self._find_csv("LignesCommande")
        df = pd.read_csv(path, dtype=str)
        logger.info("Loaded %d order lines from %s", len(df), path.name)

        df = df.rename(columns=LINES_RENAME)
        df = self._deduplicate_columns(df)

        canonical_cols = list(dict.fromkeys(LINES_RENAME.values()))
        valid_cols = [c for c in canonical_cols if c in df.columns]
        return df[valid_cols]

    def fetch_suppliers(self) -> pd.DataFrame:
        """Read and rename smartorder-Fournisseurs.csv / smartorder_fournisseurs.csv."""
        path = self._find_csv("Fournisseurs")
        df = pd.read_csv(path, dtype=str)
        logger.info("Loaded %d suppliers from %s", len(df), path.name)

        df = df.rename(columns=SUPPLIERS_RENAME)
        df = self._deduplicate_columns(df)

        canonical_cols = list(dict.fromkeys(SUPPLIERS_RENAME.values()))
        valid_cols = [c for c in canonical_cols if c in df.columns]
        return df[valid_cols]

    def fetch_predictions(self) -> pd.DataFrame:
        """Read smartorder-Predictions.csv (for enrichment)."""
        path = self._find_csv("Predictions")
        return pd.read_csv(path, dtype=str)

    def fetch_alerts(self) -> pd.DataFrame:
        """Read smartorder-Alertes.csv (for enrichment)."""
        path = self._find_csv("Alertes")
        return pd.read_csv(path, dtype=str)

    def fetch_history(self) -> pd.DataFrame:
        """Read smartorder-HistoriqueStatut.csv (for enrichment)."""
        path = self._find_csv("HistoriqueStatut")
        return pd.read_csv(path, dtype=str)

    # --------------------------------------------------------
    # Aggregation: join Orders + Lines + Suppliers
    # --------------------------------------------------------

    def fetch_orders_enriched(self) -> pd.DataFrame:
        """
        Build the canonical order dataset by joining:
        1. Orders (header)
        2. LignesCommande (aggregated per order)
        3. Fournisseurs (denormalized supplier metrics)

        Returns a DataFrame with all OrderCanonical fields.
        """
        orders_df = self.fetch_orders()
        lines_df = self.fetch_order_lines()
        suppliers_df = self.fetch_suppliers()

        # --- Aggregate line items per order ---
        lines_agg = self._aggregate_lines(lines_df)

        # --- Join orders + aggregated lines ---
        enriched = orders_df.merge(lines_agg, on="order_id", how="left")

        # Fill missing aggregates (orders without lines)
        enriched["nb_lignes"] = enriched["nb_lignes"].fillna(0).astype(int)
        enriched["quantite_totale_commandee"] = enriched["quantite_totale_commandee"].fillna(0.0)
        enriched["quantite_totale_livree"] = enriched["quantite_totale_livree"].fillna(0.0)
        enriched["poids_total"] = enriched.get("poids_total_sum")
        enriched["nb_categories_distinctes"] = (
            enriched["nb_categories_distinctes"].fillna(0).astype(int)
        )

        # Compute delivery ratio
        cmd = enriched["quantite_totale_commandee"].astype(float)
        liv = enriched["quantite_totale_livree"].astype(float)
        enriched["taux_livraison"] = (liv / cmd.replace(0, 1)).clip(0, 1)

        # --- Join supplier data ---
        supplier_map = self._build_supplier_map(suppliers_df)
        enriched = enriched.merge(supplier_map, on="fournisseur_id", how="left")

        # Fill missing supplier data (most real orders have no fournisseur_id)
        enriched["fournisseur_code_sap"] = enriched["fournisseur_code_sap"].fillna("")
        enriched["fournisseur_pays"] = enriched["fournisseur_pays"].fillna("")
        enriched["fournisseur_taux_retard"] = enriched["fournisseur_taux_retard"].fillna(0.0)
        enriched["fournisseur_delai_moyen"] = enriched["fournisseur_delai_moyen"].fillna(0.0)
        enriched["fournisseur_score_perf"] = enriched["fournisseur_score_perf"].fillna(1.0)

        # Add data source
        enriched["data_source"] = "csv_file"

        logger.info(
            "Enriched dataset: %d orders × %d columns", len(enriched), len(enriched.columns)
        )
        return enriched

    # --------------------------------------------------------
    # Internal helpers
    # --------------------------------------------------------

    def _find_csv(self, entity_name: str) -> Path:
        """
        Find a CSV file by entity name using case-insensitive search.

        Strategy (in order):
        1. Exact match with known keywords for this entity (case-insensitive).
        2. Falls back to any file containing the entity name substring.

        Supports both conventions:
            smartorder-Orders.csv   (dash, Phase 1 seed)
            smartorder_orders.csv   (underscore, real export)
        """
        keywords = _ENTITY_KEYWORDS.get(entity_name, [entity_name.lower()])

        # Collect all CSV candidates (case-insensitive on Windows too)
        candidates = list(self.data_dir.glob("*.csv"))

        # Try each keyword in priority order
        for kw in keywords:
            matched = [f for f in candidates if kw in f.stem.lower()]
            if matched:
                chosen = matched[0]
                logger.debug(
                    "CSV entity '%s' → matched '%s' (keyword=%s)",
                    entity_name,
                    chosen.name,
                    kw,
                )
                return chosen

        raise FileNotFoundError(
            f"No CSV found for entity '{entity_name}' in {self.data_dir}\n"
            f"  Available files: {[f.name for f in candidates]}"
        )

    @staticmethod
    def _deduplicate_columns(df: pd.DataFrame) -> pd.DataFrame:
        """
        Remove duplicate column names that can arise when a CSV contains
        both 'id' and 'ID' (or similar) and both get renamed to the same target.
        Keeps the first occurrence.
        """
        if df.columns.duplicated().any():
            df = df.loc[:, ~df.columns.duplicated(keep="first")]
        return df

    @staticmethod
    def _aggregate_lines(lines_df: pd.DataFrame) -> pd.DataFrame:
        """Aggregate order lines per order_id."""
        if lines_df.empty:
            return pd.DataFrame(
                columns=[
                    "order_id",
                    "nb_lignes",
                    "quantite_totale_commandee",
                    "quantite_totale_livree",
                    "poids_total_sum",
                    "nb_categories_distinctes",
                ]
            )

        # Convert numeric columns
        for col in ["quantite_commandee", "quantite_livree", "poids_total"]:
            if col in lines_df.columns:
                lines_df[col] = pd.to_numeric(lines_df[col], errors="coerce").fillna(0.0)

        agg = lines_df.groupby("order_id").agg(
            nb_lignes=("order_id", "count"),
            quantite_totale_commandee=("quantite_commandee", "sum"),
            quantite_totale_livree=("quantite_livree", "sum"),
            poids_total_sum=("poids_total", "sum"),
            nb_categories_distinctes=("categorie_article", "nunique"),
        ).reset_index()

        return agg

    @staticmethod
    def _build_supplier_map(suppliers_df: pd.DataFrame) -> pd.DataFrame:
        """Build supplier lookup table for join."""
        rename = {
            "supplier_id": "fournisseur_id",
            "code_sap": "fournisseur_code_sap",
            "pays": "fournisseur_pays",
            "taux_retard_moyen": "fournisseur_taux_retard",
            "delai_moyen_jours": "fournisseur_delai_moyen",
            "score_performance": "fournisseur_score_perf",
        }
        cols = [c for c in rename if c in suppliers_df.columns]
        result = suppliers_df[cols].rename(columns=rename)

        # Convert numeric
        for col in ["fournisseur_taux_retard", "fournisseur_delai_moyen", "fournisseur_score_perf"]:
            if col in result.columns:
                result[col] = pd.to_numeric(result[col], errors="coerce")

        return result
