"""
SmartOrder ML — SAP HANA connector (production).

Uses hdbcli for direct connection to SAP HANA Cloud on BTP.
Reads from the SMARTORDER schema deployed by CDS.
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from config.logging_config import get_logger
from config.settings import get_settings
from connectors.base_connector import BaseConnector

logger = get_logger("hana_connector")


class HANAConnector(BaseConnector):
    """
    SAP HANA Cloud connector via hdbcli.

    Used in production (ML_ENV=production) for direct DB access.
    Connection parameters from Settings (HANA_HOST, HANA_PORT, etc.).
    """

    def __init__(self) -> None:
        self._conn: Any = None
        self._settings = get_settings()

    def connect(self) -> None:
        try:
            from hdbcli import dbapi

            self._conn = dbapi.connect(
                address=self._settings.hana_host,
                port=self._settings.hana_port,
                user=self._settings.hana_user,
                password=self._settings.hana_password,
                schema=self._settings.hana_schema,
                encrypt=self._settings.hana_encrypt,
                sslValidateCertificate=True,
            )
            logger.info(
                "Connected to SAP HANA — %s:%d schema=%s",
                self._settings.hana_host,
                self._settings.hana_port,
                self._settings.hana_schema,
            )
        except Exception as e:
            logger.error("HANA connection failed: %s", e)
            raise

    def disconnect(self) -> None:
        if self._conn:
            self._conn.close()
            self._conn = None
            logger.info("HANA connection closed")

    def health_check(self) -> bool:
        if not self._conn:
            return False
        try:
            cursor = self._conn.cursor()
            cursor.execute("SELECT 1 FROM DUMMY")
            cursor.close()
            return True
        except Exception:
            return False

    def fetch_orders(self) -> pd.DataFrame:
        """Fetch orders from SMARTORDER.SMARTORDER_ORDERS."""
        query = """
            SELECT
                "ID"                    AS order_id,
                "NUMERO_SAP"            AS numero_sap,
                "TYPE"                  AS order_type,
                "STATUT"                AS statut,
                "URGENCE"               AS urgence,
                "DATE_CREATION"         AS date_creation,
                "DATE_PREVISIONNELLE"   AS date_previsionnelle,
                "DATE_LIVRAISON_REELLE" AS date_livraison_reelle,
                "DATE_MODIFICATION"     AS date_modification,
                "MONTANT_TOTAL"         AS montant_total,
                "DEVISE"                AS devise,
                "COMPANY_CODE"          AS company_code,
                "PURCHASING_ORG"        AS purchasing_org,
                "PURCHASING_GROUP"      AS purchasing_group,
                "MARQUEUR_SUPPRESSION"  AS marqueur_suppression,
                "STATUT_APPROBATION"    AS statut_approbation,
                "DATE_COMMANDE"         AS date_commande,
                "POSTES_EN_RETARD"      AS postes_en_retard,
                "SCORE_PRIORITE"        AS score_priorite,
                "FOURNISSEUR_ID"        AS fournisseur_id
            FROM "{schema}"."SMARTORDER_ORDERS"
            WHERE "MARQUEUR_SUPPRESSION" = FALSE
        """.format(schema=self._settings.hana_schema)

        df = self._execute_query(query)
        logger.info("Fetched %d orders from HANA", len(df))
        return df

    def fetch_order_lines(self) -> pd.DataFrame:
        """Fetch order line items from SMARTORDER.SMARTORDER_LIGNESCOMMANDE."""
        query = """
            SELECT
                "ID"                    AS line_id,
                "COMMANDE_ID"           AS order_id,
                "NUMERO_POSTE"          AS numero_poste,
                "CODE_PRODUIT"          AS code_produit,
                "DESIGNATION_PRODUIT"   AS designation_produit,
                "QUANTITE_COMMANDEE"    AS quantite_commandee,
                "QUANTITE_LIVREE"       AS quantite_livree,
                "PRIX_UNITAIRE"         AS prix_unitaire,
                "UNITE"                 AS unite,
                "POIDS_TOTAL"           AS poids_total,
                "CATEGORIE_ARTICLE"     AS categorie_article,
                "PLANT"                 AS plant
            FROM "{schema}"."SMARTORDER_LIGNESCOMMANDE"
        """.format(schema=self._settings.hana_schema)

        df = self._execute_query(query)
        logger.info("Fetched %d order lines from HANA", len(df))
        return df

    def fetch_suppliers(self) -> pd.DataFrame:
        """Fetch suppliers from SMARTORDER.SMARTORDER_FOURNISSEURS."""
        query = """
            SELECT
                "ID"                   AS supplier_id,
                "CODE_SAP"             AS code_sap,
                "NOM"                  AS nom,
                "PAYS"                 AS pays,
                "TAUX_RETARD_MOYEN"    AS taux_retard_moyen,
                "DELAI_MOYEN_JOURS"    AS delai_moyen_jours,
                "SCORE_PERFORMANCE"    AS score_performance,
                "ACTIF"                AS actif,
                "DERNIERE_SYNC"        AS derniere_sync
            FROM "{schema}"."SMARTORDER_FOURNISSEURS"
            WHERE "ACTIF" = TRUE
        """.format(schema=self._settings.hana_schema)

        df = self._execute_query(query)
        logger.info("Fetched %d suppliers from HANA", len(df))
        return df

    def _execute_query(self, query: str) -> pd.DataFrame:
        """Execute SQL and return a DataFrame."""
        if not self._conn:
            raise RuntimeError("HANA connector not connected. Call connect() first.")
        cursor = self._conn.cursor()
        cursor.execute(query)
        columns = [desc[0] for desc in cursor.description]
        rows = cursor.fetchall()
        cursor.close()
        return pd.DataFrame(rows, columns=columns)
