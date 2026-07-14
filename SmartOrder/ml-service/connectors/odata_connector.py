"""
SmartOrder ML — OData CAP connector (development).

Calls the CAP backend OData endpoints to fetch orders, lines, and suppliers.
Used as an alternative to direct DB access during local development.

Endpoints:
    GET /odata/v4/orders/Orders?$expand=lignes,fournisseur,prediction
    GET /odata/v4/orders/Fournisseurs
"""

from __future__ import annotations

from typing import Any

import httpx
import pandas as pd

from config.logging_config import get_logger
from config.settings import get_settings
from connectors.base_connector import BaseConnector

logger = get_logger("odata_connector")


class ODataConnector(BaseConnector):
    """
    OData CAP connector via httpx.

    Calls the Node.js CAP backend's OData V4 endpoints.
    Handles pagination ($top/$skip) and $expand for associations.
    """

    def __init__(self) -> None:
        self._client: httpx.Client | None = None
        self._settings = get_settings()

    def connect(self) -> None:
        headers: dict[str, str] = {
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        if self._settings.odata_auth_token:
            headers["Authorization"] = f"Bearer {self._settings.odata_auth_token}"

        self._client = httpx.Client(
            base_url=self._settings.odata_base_url,
            headers=headers,
            timeout=30.0,
        )
        logger.info("OData connector ready — base_url=%s", self._settings.odata_base_url)

    def disconnect(self) -> None:
        if self._client:
            self._client.close()
            self._client = None

    def health_check(self) -> bool:
        if not self._client:
            return False
        try:
            resp = self._client.get("/orders/$metadata")
            return resp.status_code == 200
        except Exception:
            return False

    def fetch_orders(self) -> pd.DataFrame:
        """Fetch orders via OData with expanded associations."""
        records = self._fetch_all(
            "/orders/Orders",
            params={
                "$select": (
                    "ID,numero_sap,type,statut,urgence,date_creation,"
                    "date_previsionnelle,date_livraison_reelle,date_modification,"
                    "montant_total,devise,company_code,purchasing_org,"
                    "purchasing_group,marqueur_suppression,statut_approbation,"
                    "date_commande,postes_en_retard,score_priorite"
                ),
                "$expand": "fournisseur($select=ID)",
            },
        )

        rows = []
        for r in records:
            row = {
                "order_id": r.get("ID"),
                "numero_sap": r.get("numero_sap"),
                "order_type": r.get("type"),
                "statut": r.get("statut"),
                "urgence": r.get("urgence"),
                "date_creation": r.get("date_creation"),
                "date_previsionnelle": r.get("date_previsionnelle"),
                "date_livraison_reelle": r.get("date_livraison_reelle"),
                "date_modification": r.get("date_modification"),
                "montant_total": r.get("montant_total"),
                "devise": r.get("devise"),
                "company_code": r.get("company_code"),
                "purchasing_org": r.get("purchasing_org"),
                "purchasing_group": r.get("purchasing_group"),
                "marqueur_suppression": r.get("marqueur_suppression"),
                "statut_approbation": r.get("statut_approbation", ""),
                "date_commande": r.get("date_commande"),
                "postes_en_retard": r.get("postes_en_retard", 0),
                "score_priorite": r.get("score_priorite", 0),
                "fournisseur_id": (r.get("fournisseur") or {}).get("ID"),
            }
            rows.append(row)

        df = pd.DataFrame(rows)
        logger.info("Fetched %d orders via OData", len(df))
        return df

    def fetch_order_lines(self) -> pd.DataFrame:
        """Fetch all order line items via OData — requires expanding from Orders."""
        records = self._fetch_all(
            "/orders/Orders",
            params={
                "$select": "ID",
                "$expand": (
                    "lignes($select=ID,numero_poste,code_produit,designation_produit,"
                    "quantite_commandee,quantite_livree,prix_unitaire,unite,"
                    "poids_total,categorie_article,plant)"
                ),
            },
        )

        rows = []
        for order in records:
            order_id = order.get("ID")
            for line in order.get("lignes", []):
                rows.append({
                    "line_id": line.get("ID"),
                    "order_id": order_id,
                    "numero_poste": line.get("numero_poste"),
                    "code_produit": line.get("code_produit"),
                    "designation_produit": line.get("designation_produit"),
                    "quantite_commandee": line.get("quantite_commandee"),
                    "quantite_livree": line.get("quantite_livree"),
                    "prix_unitaire": line.get("prix_unitaire"),
                    "unite": line.get("unite"),
                    "poids_total": line.get("poids_total"),
                    "categorie_article": line.get("categorie_article"),
                    "plant": line.get("plant"),
                })

        df = pd.DataFrame(rows)
        logger.info("Fetched %d order lines via OData", len(df))
        return df

    def fetch_suppliers(self) -> pd.DataFrame:
        """Fetch suppliers via OData."""
        records = self._fetch_all(
            "/orders/Fournisseurs",
            params={
                "$select": (
                    "ID,code_sap,nom,pays,taux_retard_moyen,"
                    "delai_moyen_jours,score_performance,actif,derniere_sync"
                ),
            },
        )

        rows = []
        for r in records:
            rows.append({
                "supplier_id": r.get("ID"),
                "code_sap": r.get("code_sap"),
                "nom": r.get("nom"),
                "pays": r.get("pays"),
                "taux_retard_moyen": r.get("taux_retard_moyen", 0),
                "delai_moyen_jours": r.get("delai_moyen_jours", 0),
                "score_performance": r.get("score_performance", 1),
                "actif": r.get("actif", True),
                "derniere_sync": r.get("derniere_sync"),
            })

        df = pd.DataFrame(rows)
        logger.info("Fetched %d suppliers via OData", len(df))
        return df

    # --------------------------------------------------------
    # Pagination helper
    # --------------------------------------------------------

    def _fetch_all(
        self,
        path: str,
        params: dict[str, Any] | None = None,
        page_size: int = 100,
    ) -> list[dict]:
        """Fetch all records with OData pagination ($top/$skip)."""
        if not self._client:
            raise RuntimeError("OData connector not connected. Call connect() first.")

        all_records: list[dict] = []
        skip = 0
        params = dict(params or {})

        while True:
            params["$top"] = str(page_size)
            params["$skip"] = str(skip)

            resp = self._client.get(path, params=params)
            resp.raise_for_status()
            data = resp.json()

            records = data.get("value", [])
            if not records:
                break

            all_records.extend(records)
            skip += len(records)

            if len(records) < page_size:
                break

        return all_records
