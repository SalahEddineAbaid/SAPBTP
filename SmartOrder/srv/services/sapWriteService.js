'use strict';

/**
 * sapWriteService.js — Écriture bidirectionnelle vers SAP S/4HANA
 * Projet PFE SAP BTP — YAAS "Run It Best"
 *
 * Ce service gère toutes les opérations d'écriture vers l'API
 * Purchase Order OData v4 de SAP S/4HANA Cloud :
 *
 *   createOrderInSAP()      → POST /A_PurchaseOrder
 *   updateOrderInSAP()      → PATCH /A_PurchaseOrder('{numerosap}')
 *   deleteOrderInSAP()      → PATCH avec PurOrderIsMarkedForDeletion: true
 *   propagateStatusToSAP()  → Propage un changement de statut vers SAP
 *
 * Fonctionnalités :
 *   - CSRF token automatique via cds.connect.to('SAP_ERP') (fetch_csrf: true)
 *   - Retry exponentiel : 1s → 2s → 4s (3 tentatives)
 *   - Mode mock (USE_MOCK_SAP=true) pour tests locaux sans connexion SAP
 *   - Mapping CDS → SAP OData complet (tous les champs validés)
 *   - Gestion des erreurs SAP avec messages lisibles
 */

const cds = require('@sap/cds');
const LOG = cds.log('sap-write');

// ===========================================================================
// CONSTANTES
// ===========================================================================

const BASE_PO_URL  = '/sap/opu/odata4/sap/api_purchaseorder_2/srvd_a2x/sap/purchaseorder/0001';
const PO_ENTITY    = 'PurchaseOrder';

/** Délais retry en ms : 1s → 2s → 4s */
const RETRY_DELAYS = [1000, 2000, 4000];

// ===========================================================================
// HELPERS — Retry + Erreurs HTTP
// ===========================================================================

function getHttpStatus(err) {
  return err?.reason?.response?.status
    || err?.response?.status
    || err?.reason?.status
    || err?.status
    || err?.statusCode;
}

function isRetryable(err) {
  const status = getHttpStatus(err);
  return !status || status === 408 || status === 429 || status >= 500;
}

async function withRetry(fn, label = 'opération SAP') {
  let lastErr;
  for (let i = 0; i <= RETRY_DELAYS.length; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err)) {
        LOG.warn('[SAP-WRITE] Retry "%s" annulé (erreur non-transitoire): %s', label, err.message);
        throw err;
      }
      if (i < RETRY_DELAYS.length) {
        const delay = RETRY_DELAYS[i];
        LOG.warn('[SAP-WRITE] Retry "%s" — tentative %d/%d échouée (%s), retry dans %dms',
          label, i + 1, RETRY_DELAYS.length, err.message, delay);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

/**
 * Formate un message d'erreur SAP lisible.
 * L'API SAP renvoie les erreurs dans error.message.value (OData v4).
 */
function parseSAPError(err, operation) {
  const status  = getHttpStatus(err);
  const sapMsg  = err?.reason?.error?.message?.value
    || err?.error?.message?.value
    || err?.reason?.message
    || err?.message
    || 'Erreur inconnue';

  if (status === 401 || status === 403)
    return `Authentification SAP refusée (${status}). Vérifiez la destination SAP_ERP.`;
  if (status === 404)
    return `Commande introuvable dans SAP (${operation}).`;
  if (status === 409)
    return `Conflit SAP (${status}) : ${sapMsg}. La commande est peut-être verrouillée.`;

  return `Erreur SAP (${operation}) [${status || 'N/A'}] : ${sapMsg}`;
}

// ===========================================================================
// MOCK — Numéro SAP fictif pour tests locaux
// ===========================================================================

function generateMockPONumber() {
  const num = 4500000000 + Math.floor(Math.random() * 999999);
  return String(num);
}

// ===========================================================================
// MAPPING — CDS → SAP OData
// ===========================================================================

/**
 * Mappe les données CDS SmartOrder vers le format OData SAP
 * pour la création d'une Purchase Order.
 *
 * @param {Object} orderData   - Données commande (format CDS)
 * @param {Object} fournisseur - Fournisseur associé (pour code_sap)
 * @param {Array}  lignes      - Lignes de commande (format CDS)
 * @returns {Object} Payload OData SAP valide pour POST
 */
function mapCDSOrderToSAP(orderData, fournisseur, lignes = []) {
  const dateCommande = orderData.date_commande
    ? new Date(orderData.date_commande).toISOString().split('T')[0]
    : new Date().toISOString().split('T')[0];

  return {
    PurchaseOrderType:      orderData.type || 'NB',
    Supplier:               fournisseur?.code_sap || orderData.supplier_code || '',
    CompanyCode:            orderData.company_code || '',
    PurchasingOrganization: orderData.purchasing_org || '',
    PurchasingGroup:        orderData.purchasing_group || '',
    DocumentCurrency:       orderData.devise || 'EUR',
    PurchaseOrderDate:      dateCommande,
    to_PurchaseOrderItem:   lignes.map((l, idx) => mapCDSLineToSAP(l, idx)),
  };
}

/**
 * Mappe une ligne CDS vers un PurchaseOrderItem SAP.
 * SAP numérote les postes 00010, 00020, 00030...
 *
 * @param {Object} ligne - Ligne commande (format CDS)
 * @param {number} index - Index 0-based
 * @returns {Object} PurchaseOrderItem OData SAP
 */
function mapCDSLineToSAP(ligne, index) {
  const posteNum = String((index + 1) * 10).padStart(5, '0');
  return {
    PurchaseOrderItem:     posteNum,
    Material:              ligne.code_produit || '',
    PurchaseOrderItemText: ligne.designation_produit || '',
    OrderQuantity:         String(ligne.quantite_commandee || 1),
    NetPriceAmount:        String(ligne.prix_unitaire || 0),
    OrderPriceUnit:        ligne.unite || 'PC',
    Plant:                 ligne.plant || '',
  };
}

/**
 * Construit le payload PATCH pour une mise à jour partielle.
 * Seuls les champs SAP modifiables sont inclus.
 *
 * NOTE : Les champs 100% SmartOrder (urgence, score_priorite, predictions)
 * ne sont jamais envoyés à SAP car ils n'ont pas d'équivalent dans l'API PO.
 *
 * @param {Object} updateData - Champs à mettre à jour (format CDS)
 * @returns {Object} Payload OData SAP pour PATCH
 */
function mapCDSUpdateToSAP(updateData) {
  const patch = {};
  if (updateData.purchasing_group !== undefined)
    patch.PurchasingGroup = updateData.purchasing_group;
  if (updateData.date_commande)
    patch.PurchaseOrderDate = new Date(updateData.date_commande).toISOString().split('T')[0];
  if (updateData.devise)
    patch.DocumentCurrency = updateData.devise;
  if (updateData.marqueur_suppression !== undefined)
    patch.PurOrderIsMarkedForDeletion = updateData.marqueur_suppression;
  return patch;
}

// ===========================================================================
// APPELS API SAP
// ===========================================================================

/**
 * Appelle la destination SAP_ERP pour une opération d'écriture.
 * Le CSRF token est géré automatiquement par cds.connect.to('SAP_ERP')
 * grâce à la config `features.fetch_csrf: true` dans package.json.
 */
async function callSAPWrite(method, path, body) {
  const dest = await cds.connect.to('SAP_ERP');
  const url  = `${BASE_PO_URL}/${path}`;

  LOG.debug('[SAP-WRITE] %s %s', method.toUpperCase(), url.substring(0, 120));

  try {
    return await dest[method](url, body);
  } catch (err) {
    const status  = getHttpStatus(err);
    const message = parseSAPError(err, `${method.toUpperCase()} ${path}`);
    LOG.error('[SAP-WRITE] Erreur %s : %s', method.toUpperCase(), message);
    const wrapped = new Error(message);
    wrapped.statusCode = status;
    wrapped.sapError   = true;
    wrapped.cause      = err;
    throw wrapped;
  }
}

// ===========================================================================
// API PUBLIQUE — Opérations d'écriture SAP
// ===========================================================================

/**
 * Crée une commande dans SAP S/4HANA via POST /PurchaseOrder.
 *
 * @param {Object} orderData   - Données commande (format CDS SmartOrder)
 * @param {Object} fournisseur - Fournisseur associé (nécessite code_sap)
 * @param {Array}  lignes      - Lignes de commande (format CDS)
 * @returns {{ numero_sap: string, success: boolean, mock: boolean }}
 */
async function createOrderInSAP(orderData, fournisseur, lignes = []) {
  // ── Mode mock ────────────────────────────────────────────────────────────
  if (process.env.USE_MOCK_SAP === 'true') {
    const mockPO = generateMockPONumber();
    LOG.info('[SAP-WRITE] MODE MOCK — CREATE simulé, numero_sap=%s', mockPO);
    await new Promise(r => setTimeout(r, 300));
    return { numero_sap: mockPO, success: true, mock: true };
  }

  // ── Appel SAP réel ───────────────────────────────────────────────────────
  const payload = mapCDSOrderToSAP(orderData, fournisseur, lignes);

  LOG.info('[SAP-WRITE] CREATE PurchaseOrder — Supplier=%s CompanyCode=%s',
    payload.Supplier, payload.CompanyCode);

  const response = await withRetry(
    () => callSAPWrite('post', PO_ENTITY, payload),
    'CREATE PurchaseOrder'
  );

  // Extraire le numéro SAP depuis la réponse OData v4 ou v2
  const numerosap = response?.PurchaseOrder
    || response?.d?.PurchaseOrder
    || response?.value?.[0]?.PurchaseOrder;

  if (!numerosap) {
    LOG.warn('[SAP-WRITE] CREATE SAP réussi mais PurchaseOrder absent de la réponse');
    return { numero_sap: null, success: true, mock: false };
  }

  LOG.info('[SAP-WRITE] Commande SAP créée : numero_sap=%s', numerosap);
  return { numero_sap: numerosap, success: true, mock: false };
}

/**
 * Met à jour une commande dans SAP S/4HANA via PATCH /PurchaseOrder('{numerosap}').
 *
 * Seuls les champs SAP modifiables sont envoyés (patch partiel).
 * PurchasingGroup, PurchaseOrderDate, DocumentCurrency.
 *
 * @param {string} numerosap  - Numéro SAP de la commande
 * @param {Object} updateData - Champs à mettre à jour (format CDS)
 * @returns {{ success: boolean, mock: boolean, reason?: string }}
 */
async function updateOrderInSAP(numerosap, updateData) {
  if (!numerosap || numerosap.startsWith('DRAFT-')) {
    LOG.warn('[SAP-WRITE] UPDATE ignoré — commande DRAFT non encore confirmée par SAP');
    return { success: false, mock: false, reason: 'draft' };
  }

  if (process.env.USE_MOCK_SAP === 'true') {
    LOG.info('[SAP-WRITE] MODE MOCK — UPDATE simulé pour numero_sap=%s', numerosap);
    await new Promise(r => setTimeout(r, 200));
    return { success: true, mock: true };
  }

  const patch = mapCDSUpdateToSAP(updateData);

  if (Object.keys(patch).length === 0) {
    LOG.debug('[SAP-WRITE] UPDATE ignoré — aucun champ SAP modifiable');
    return { success: true, mock: false, reason: 'no_sap_fields' };
  }

  LOG.info('[SAP-WRITE] UPDATE PurchaseOrder — numero_sap=%s champs=%s',
    numerosap, Object.keys(patch).join(','));

  await withRetry(
    () => callSAPWrite('patch', `${PO_ENTITY}('${numerosap}')`, patch),
    `UPDATE PurchaseOrder ${numerosap}`
  );

  LOG.info('[SAP-WRITE] Commande SAP mise à jour : numero_sap=%s', numerosap);
  return { success: true, mock: false };
}

/**
 * Marque une commande comme supprimée dans SAP S/4HANA.
 *
 * IMPORTANT : L'API SAP ne permet PAS la suppression physique d'une PO.
 * La seule opération autorisée est le marquage pour suppression :
 *   PATCH /PurchaseOrder('{numerosap}') { PurOrderIsMarkedForDeletion: true }
 *
 * La suppression physique dans SmartOrder BDD est gérée par le handler CAP.
 *
 * @param {string} numerosap - Numéro SAP de la commande
 * @returns {{ success: boolean, mock: boolean, logicalDelete: true }}
 */
async function deleteOrderInSAP(numerosap) {
  if (!numerosap || numerosap.startsWith('DRAFT-')) {
    LOG.warn('[SAP-WRITE] DELETE ignoré — commande DRAFT sans numéro SAP confirmé');
    return { success: true, mock: false, reason: 'draft', logicalDelete: true };
  }

  if (process.env.USE_MOCK_SAP === 'true') {
    LOG.info('[SAP-WRITE] MODE MOCK — DELETE logique simulé pour numero_sap=%s', numerosap);
    await new Promise(r => setTimeout(r, 200));
    return { success: true, mock: true, logicalDelete: true };
  }

  LOG.info('[SAP-WRITE] Marquage suppression SAP — numero_sap=%s', numerosap);

  await withRetry(
    () => callSAPWrite('patch', `${PO_ENTITY}('${numerosap}')`, {
      PurOrderIsMarkedForDeletion: true,
    }),
    `DELETE (logique) PurchaseOrder ${numerosap}`
  );

  LOG.info('[SAP-WRITE] Commande SAP marquée pour suppression : numero_sap=%s', numerosap);
  return { success: true, mock: false, logicalDelete: true };
}

/**
 * Propage un changement de statut SmartOrder vers SAP S/4HANA.
 *
 * Mapping StatutEnum SmartOrder → action SAP :
 *   ANNULE  → PurOrderIsMarkedForDeletion: true (seule action directe possible)
 *   Autres  → aucune action directe (le statut SAP est calculé automatiquement
 *              par SAP depuis les GR/GI, sera recalculé au prochain syncDelta)
 *
 * NOTE : PurchasingProcessingStatus est calculé par SAP depuis les livraisons
 * et ne peut pas être forcé via PATCH de l'en-tête de commande.
 *
 * @param {string} numerosap     - Numéro SAP de la commande
 * @param {string} nouveauStatut - Nouveau statut SmartOrder
 * @returns {{ success: boolean, sapAction: string|null, error?: string }}
 */
async function propagateStatusToSAP(numerosap, nouveauStatut) {
  if (!numerosap || numerosap.startsWith('DRAFT-')) {
    return { success: true, sapAction: null, reason: 'draft' };
  }

  if (nouveauStatut === 'ANNULE') {
    try {
      const result = await deleteOrderInSAP(numerosap);
      return { success: result.success, sapAction: 'MARK_FOR_DELETION' };
    } catch (err) {
      // Non bloquant — le statut local est déjà mis à jour
      LOG.warn('[SAP-WRITE] Impossible de marquer la commande SAP pour suppression : %s', err.message);
      return { success: false, sapAction: 'MARK_FOR_DELETION', error: err.message };
    }
  }

  // Pour les autres statuts : aucune action SAP directe
  LOG.debug('[SAP-WRITE] Statut "%s" → aucune action SAP directe (sera synchro au prochain DELTA)',
    nouveauStatut);
  return { success: true, sapAction: null };
}

// ===========================================================================
// EXPORTS
// ===========================================================================
module.exports = {
  createOrderInSAP,
  updateOrderInSAP,
  deleteOrderInSAP,
  propagateStatusToSAP,
  // Utilitaires exposés pour tests unitaires
  mapCDSOrderToSAP,
  mapCDSLineToSAP,
  mapCDSUpdateToSAP,
};
