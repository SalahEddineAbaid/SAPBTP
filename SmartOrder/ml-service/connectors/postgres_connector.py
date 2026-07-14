"""
SmartOrder ML — PostgreSQL connector (development).

Uses SQLAlchemy for connection to the PostgreSQL instance
provisioned via cf cups on SAP BTP (or local Docker).
"""

from __future__ import annotations

import pandas as pd
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from config.logging_config import get_logger
from config.settings import get_settings
from connectors.base_connector import BaseConnector

logger = get_logger("postgres_connector")


class PostgresConnector(BaseConnector):
    """
    PostgreSQL connector via SQLAlchemy.

    Used in development (ML_ENV=development) for local/cloud PostgreSQL.
    Connection string from Settings.postgres_dsn.
    """

    def __init__(self) -> None:
        self._engine: Engine | None = None
        self._settings = get_settings()

    def connect(self) -> None:
        try:
            self._engine = create_engine(
                self._settings.postgres_dsn,
                pool_size=5,
                max_overflow=2,
                pool_timeout=30,
                pool_recycle=1800,
            )
            # Test the connection
            with self._engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            logger.info("Connected to PostgreSQL — %s", self._settings.postgres_host)
        except Exception as e:
            logger.error("PostgreSQL connection failed: %s", e)
            raise

    def disconnect(self) -> None:
        if self._engine:
            self._engine.dispose()
            self._engine = None
            logger.info("PostgreSQL connection pool closed")

    def health_check(self) -> bool:
        if not self._engine:
            return False
        try:
            with self._engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return True
        except Exception:
            return False

    def fetch_orders(self) -> pd.DataFrame:
        """Fetch orders with canonical column aliases."""
        query = text("""
            SELECT
                "ID"                    AS order_id,
                "numero_sap"            AS numero_sap,
                "type"                  AS order_type,
                "statut"                AS statut,
                "urgence"               AS urgence,
                "date_creation"         AS date_creation,
                "date_previsionnelle"   AS date_previsionnelle,
                "date_livraison_reelle" AS date_livraison_reelle,
                "date_modification"     AS date_modification,
                "montant_total"         AS montant_total,
                "devise"                AS devise,
                "company_code"          AS company_code,
                "purchasing_org"        AS purchasing_org,
                "purchasing_group"      AS purchasing_group,
                "marqueur_suppression"  AS marqueur_suppression,
                "statut_approbation"    AS statut_approbation,
                "date_commande"         AS date_commande,
                "postes_en_retard"      AS postes_en_retard,
                "score_priorite"        AS score_priorite,
                "fournisseur_ID"        AS fournisseur_id
            FROM smartorder_orders
            WHERE "marqueur_suppression" = false
        """)
        return self._execute_query(query)

    def fetch_order_lines(self) -> pd.DataFrame:
        """Fetch order line items with canonical column aliases."""
        query = text("""
            SELECT
                "ID"                    AS line_id,
                "commande_ID"           AS order_id,
                "numero_poste"          AS numero_poste,
                "code_produit"          AS code_produit,
                "designation_produit"   AS designation_produit,
                "quantite_commandee"    AS quantite_commandee,
                "quantite_livree"       AS quantite_livree,
                "prix_unitaire"         AS prix_unitaire,
                "unite"                 AS unite,
                "poids_total"           AS poids_total,
                "categorie_article"     AS categorie_article,
                "plant"                 AS plant
            FROM smartorder_lignescommande
        """)
        return self._execute_query(query)

    def fetch_suppliers(self) -> pd.DataFrame:
        """Fetch suppliers with canonical column aliases."""
        query = text("""
            SELECT
                "ID"                   AS supplier_id,
                "code_sap"             AS code_sap,
                "nom"                  AS nom,
                "pays"                 AS pays,
                "taux_retard_moyen"    AS taux_retard_moyen,
                "delai_moyen_jours"    AS delai_moyen_jours,
                "score_performance"    AS score_performance,
                "actif"                AS actif,
                "derniere_sync"        AS derniere_sync
            FROM smartorder_fournisseurs
            WHERE "actif" = true
        """)
        return self._execute_query(query)

    def _execute_query(self, query: text) -> pd.DataFrame:
        """Execute SQL query and return DataFrame."""
        if not self._engine:
            raise RuntimeError("PostgreSQL connector not connected. Call connect() first.")
        with self._engine.connect() as conn:
            return pd.read_sql(query, conn)
