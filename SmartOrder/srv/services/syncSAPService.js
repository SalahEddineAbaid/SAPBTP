'use strict';

const cds = require('@sap/cds');
const { uuid } = cds.utils;
const LOG = cds.log('sap-sync');
const {
  normalizeCountryCode,
  recalculateSupplierMetrics,
} = require('./supplierService');

// ---------------------------------------------------------------------------
// SQL compatible PostgreSQL et SQLite pour le mode hybrid BAS/local.
// ---------------------------------------------------------------------------
function isPostgres() {
  const db = cds.env.requires?.db || {};
  const kind = db.kind || db[process.env.NODE_ENV]?.kind || 'sqlite';
  return kind === 'postgres' || kind === 'postgresql';
}

function p(index) {
  return isPostgres() ? `$${index}` : '?';
}

function scalar(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (['string', 'number', 'bigint'].includes(typeof value)) return value;
  if (Buffer.isBuffer(value)) return value;
  if (Array.isArray(value)) return value.length ? scalar(value[0], fallback) : fallback;
  if (typeof value === 'object') {
    if ('value' in value) return scalar(value.value, fallback);
    if ('Value' in value) return scalar(value.Value, fallback);
    if ('results' in value) return scalar(value.results, fallback);
    if ('Name' in value) return scalar(value.Name, fallback);
    if ('Description' in value) return scalar(value.Description, fallback);
    return JSON.stringify(value);
  }
  return String(value);
}

function text(value, fallback = null) {
  const v = scalar(value, fallback);
  return v === null || v === undefined ? fallback : String(v).trim();
}

function limitText(value, maxLength, fallback = null) {
  const raw = text(value, fallback);
  if (raw === null || raw === undefined) return fallback;
  return raw.length > maxLength ? raw.slice(0, maxLength) : raw;
}

function bind(values) {
  return values.map((value) => scalar(value));
}

function parseBoolean(value) {
  const raw = scalar(value);
  if (raw === true || raw === 1) return true;
  if (raw === false || raw === 0) return false;
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (['true', 'x', '1', 'yes', 'y'].includes(normalized)) return true;
    if (['false', '', '0', 'no', 'n'].includes(normalized)) return false;
  }
  return null;
}

function mapApprovalStatus(sapOrder) {
  // 1. Vérifier le champ explicite ReleaseStatus
  const releaseStatus = text(sapOrder.ReleaseStatus || sapOrder.PurgReleaseSequenceStatus, '');
  if (releaseStatus) return releaseStatus;

  // 2. Vérifier ReleaseIsNotCompleted (booléen inversé)
  const releaseIsNotCompleted = parseBoolean(sapOrder.ReleaseIsNotCompleted);
  if (releaseIsNotCompleted === false) return 'X'; // Approuvée
  if (releaseIsNotCompleted === true) return '';    // En attente

  // 3. Vérifier le statut de processing — si la commande est en cours
  //    de traitement (03+), elle est implicitement approuvée
  const processingStatus = text(sapOrder.PurchasingProcessingStatus, '');
  const statusNum = parseInt(processingStatus, 10);
  if (!isNaN(statusNum) && statusNum >= 3) return 'X';

  // 4. Défaut : en attente
  return '';
}

// ===========================================================================
// CONSTANTES — Field Mapping SAP → CDS
// ===========================================================================

/**
 * Mapping des statuts SAP (PurchasingProcessingStatus) vers StatutEnum CDS.
 * Codes SAP S/4HANA : 01-09
 */
const SAP_STATUS_MAP = {
  '01': 'EN_ATTENTE',    // En cours de création
  '02': 'EN_ATTENTE',    // Approuvé → pas encore en traitement
  '03': 'EN_COURS',      // En commande
  '04': 'EN_COURS',      // Confirmé
  '05': 'EN_LIVRAISON',  // Partiellement livré
  '06': 'LIVRE',         // Livré
  '07': 'LIVRE',         // Facturé → considéré livré
  '08': 'ANNULE',        // Annulé
  '09': 'BLOQUE',        // Bloqué
};

/**
 * Labels d'affichage pour les types de commandes SAP.
 * Les codes SAP bruts (NB, UB, etc.) sont désormais stockés directement en BDD.
 * Ce map sert uniquement pour l'affichage côté UI / exports.
 */
const SAP_TYPE_LABELS = {
  'NB': 'Commande standard',
  'UB': 'Transfert de stock',
  'KB': 'Consignation',
  'LP': 'Sous-traitance',
  'FO': 'Commande cadre',
};

/** Types SAP valides — utilisé pour la validation */
const VALID_SAP_TYPES = Object.keys(SAP_TYPE_LABELS);

/**
 * Champs obligatoires dans la réponse SAP.
 * La validation échoue si l'un de ces champs est absent ou vide.
 */
const REQUIRED_SAP_FIELDS = [
  'PurchaseOrder',
  'PurchaseOrderType',
  'PurchasingProcessingStatus',
  'CreationDate',
  'Supplier',
  'DocumentCurrency',
];

// ===========================================================================
// PARSING — OData v4 Response
// ===========================================================================

/**
 * Parse une réponse OData v4 SAP et extrait les entités.
 *
 * @param {Object} odataResponse - Réponse brute de l'API SAP
 * @returns {{ entities: Object[], count: number, errors: string[] }}
 *
 * Format attendu :
 *   { d: { results: [...] } }          — OData v2
 *   { value: [...] }                   — OData v4
 *   { d: { ... } }                     — Entité unique OData v2
 */
function parseODataResponse(odataResponse) {
  const errors = [];

  if (!odataResponse || typeof odataResponse !== 'object') {
    return { entities: [], count: 0, errors: ['Réponse OData invalide : objet attendu.'] };
  }

  let entities = [];

  // OData v4 : { value: [...] }
  if (Array.isArray(odataResponse.value)) {
    entities = odataResponse.value;
  }
  // OData v2 : { d: { results: [...] } }
  else if (odataResponse.d?.results && Array.isArray(odataResponse.d.results)) {
    entities = odataResponse.d.results;
  }
  // OData v2 : entité unique { d: { ... } }
  else if (odataResponse.d && !odataResponse.d.results) {
    entities = [odataResponse.d];
  }
  // Tableau brut
  else if (Array.isArray(odataResponse)) {
    entities = odataResponse;
  }
  else {
    errors.push('Format OData non reconnu. Attendu: { value: [...] } ou { d: { results: [...] } }.');
  }

  return {
    entities,
    count: entities.length,
    errors,
  };
}

// ===========================================================================
// VALIDATION — Champs individuels
// ===========================================================================

/**
 * Parse et valide une date ISO 8601 ou SAP.
 * Supporte :
 *   - ISO 8601 : "2024-03-15T10:30:00Z"
 *   - SAP Edm.DateTime : "/Date(1710489000000)/"
 *   - Date simple : "2024-03-15"
 *
 * @param {string|number} value - Valeur brute
 * @param {string} fieldName - Nom du champ (pour les messages d'erreur)
 * @returns {{ value: string|null, error: string|null }}
 */
function parseDate(value, fieldName) {
  value = scalar(value);
  if (!value && value !== 0) {
    return { value: null, error: null }; // champ optionnel
  }

  let date;

  // SAP Edm.DateTime : "/Date(1710489000000)/"
  if (typeof value === 'string' && /^\/Date\(\d+\)\/$/.test(value)) {
    const ms = parseInt(value.match(/\d+/)[0], 10);
    date = new Date(ms);
  }
  // Timestamp numérique
  else if (typeof value === 'number') {
    date = new Date(value);
  }
  // ISO 8601 ou date simple
  else {
    date = new Date(value);
  }

  if (isNaN(date.getTime())) {
    return { value: null, error: `${fieldName} : date invalide "${value}". Format attendu : ISO 8601.` };
  }

  // Vérification de plage raisonnable (2000 - 2099)
  const year = date.getFullYear();
  if (year < 2000 || year > 2099) {
    return { value: null, error: `${fieldName} : année hors plage (${year}). Attendu : 2000-2099.` };
  }

  return { value: date.toISOString(), error: null };
}

/**
 * Parse et valide un montant décimal.
 *
 * @param {string|number} value - Valeur brute
 * @param {string} fieldName - Nom du champ
 * @param {Object} opts - { allowNegative: false, defaultValue: 0 }
 * @returns {{ value: number, error: string|null }}
 */
function parseDecimal(value, fieldName, opts = {}) {
  const { allowNegative = false, defaultValue = 0 } = opts;
  value = scalar(value);

  if (value === null || value === undefined || value === '') {
    return { value: defaultValue, error: null };
  }

  // Nettoyer les séparateurs de milliers SAP
  const cleaned = typeof value === 'string'
    ? value.replace(/[,\s]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '')
    : value;

  const num = Number(cleaned);

  if (isNaN(num)) {
    return { value: defaultValue, error: `${fieldName} : valeur numérique invalide "${value}".` };
  }

  if (!allowNegative && num < 0) {
    return { value: defaultValue, error: `${fieldName} : valeur négative non autorisée (${num}).` };
  }

  return { value: Math.round(num * 100) / 100, error: null };
}

/**
 * Valide qu'un champ obligatoire est présent et non vide.
 */
function validateRequired(sapOrder, field) {
  const val = scalar(sapOrder[field]);
  if (val === null || val === undefined || (typeof val === 'string' && val.trim() === '')) {
    return `Champ obligatoire manquant : "${field}".`;
  }
  return null;
}

// ===========================================================================
// MAPPING — SAP Order → CDS Order
// ===========================================================================

/**
 * Mappe un objet commande SAP (OData) vers une entité CDS `smartorder.Orders`.
 *
 * @param {Object} sapOrder - Objet commande SAP brut
 * @returns {{ order: Object|null, supplier: Object|null, errors: string[], warnings: string[] }}
 */
function mapSAPOrderToCDS(sapOrder) {
  const errors = [];
  const warnings = [];

  // 1. Valider les champs obligatoires
  for (const field of REQUIRED_SAP_FIELDS) {
    const err = validateRequired(sapOrder, field);
    if (err) errors.push(err);
  }

  if (errors.length > 0) {
    return { order: null, supplier: null, errors, warnings };
  }

  // 2. Mapper le statut SAP → StatutEnum CDS
  const sapStatus = text(sapOrder.PurchasingProcessingStatus, '').padStart(2, '0');
  const statut = SAP_STATUS_MAP[sapStatus];
  if (!statut) {
    warnings.push(`Statut SAP inconnu "${sapStatus}" — défaut: EN_ATTENTE.`);
  }

  // 3. Mapper le type de commande — stocke le code SAP brut
  const type = text(sapOrder.PurchaseOrderType, 'NB');
  if (!VALID_SAP_TYPES.includes(type)) {
    warnings.push(`Type de commande SAP inconnu "${type}" — stocké tel quel.`);
  }

  // 4. Parser les dates
  const dateCreation = parseDate(sapOrder.CreationDate, 'CreationDate');
  if (dateCreation.error) errors.push(dateCreation.error);

  const dateDocument = parseDate(sapOrder.DocumentDate || sapOrder.PurchaseOrderDate, 'DocumentDate');
  if (dateDocument.error) warnings.push(dateDocument.error);

  const dateModification = parseDate(sapOrder.LastChangeDateTime, 'LastChangeDateTime');
  if (dateModification.error) warnings.push(dateModification.error);

  // Date prévisionnelle — source confirmée par CE_PURCHASEORDER_0001.cds :
  // PurchaseOrderScheduleLine.ScheduleLineDeliveryDate (via _PurchaseOrderScheduleLineTP)
  // Pas de RequestedDeliveryDate au niveau header PO dans cette API.
  const firstItemScheduleLines = Array.isArray(sapOrder._PurchaseOrderItem)
    ? (sapOrder._PurchaseOrderItem[0]?._PurchaseOrderScheduleLineTP || [])
    : [];
  const firstScheduleLine = firstItemScheduleLines[0] || {};
  const rawDatePrev = firstScheduleLine.ScheduleLineDeliveryDate
    || sapOrder.ScheduleLineDeliveryDate
    || sapOrder.RequestedDeliveryDate
    || sapOrder.DeliveryDate;
  const datePrevisionnelle = parseDate(rawDatePrev, 'ScheduleLineDeliveryDate');
  if (!datePrevisionnelle.value) {
    // Fallback : date création + 14 jours (schedule line non expandée)
    const fallback = dateCreation.value ? new Date(dateCreation.value) : new Date();
    fallback.setDate(fallback.getDate() + 14);
    datePrevisionnelle.value = fallback.toISOString().split('T')[0];
    warnings.push('ScheduleLineDeliveryDate absente — défaut: date_creation + 14 jours.');
  }

  // 5. Parser le montant total
  const montant = parseDecimal(
    sapOrder.TotalNetAmount || sapOrder.NetAmount || sapOrder.PurchaseOrderNetAmount || 0,
    'TotalNetAmount'
  );
  if (montant.error) warnings.push(montant.error);

  // 6. Déterminer l'urgence basée sur le montant et la date
  let urgence = 'NORMALE';
  const priority = text(sapOrder.Priority, '').toUpperCase();
  if (montant.value > 500000 || priority === 'HIGH') {
    urgence = 'CRITIQUE';
  } else if (montant.value > 100000 || priority === 'MEDIUM') {
    urgence = 'HAUTE';
  }

  // 7. Construire l'entité CDS Order
  const now = new Date().toISOString();
  const order = {
    numero_sap: text(sapOrder.PurchaseOrder, ''),
    type: type,
    statut: statut || 'EN_ATTENTE',
    urgence: urgence,
    date_creation: dateCreation.value || now,
    date_previsionnelle: typeof datePrevisionnelle.value === 'string'
      ? datePrevisionnelle.value.split('T')[0]
      : datePrevisionnelle.value,
    date_livraison_reelle: statut === 'LIVRE'
      ? (dateModification.value || now).split('T')[0]
      : null,
    date_modification: dateModification.value || now,
    montant_total: montant.value,
    devise: text(sapOrder.DocumentCurrency, 'EUR').toUpperCase(),
    score_priorite: 0, // calculé par ML ensuite
    // Champs organisationnels SAP
    company_code: text(sapOrder.CompanyCode) || null,
    purchasing_org: text(sapOrder.PurchasingOrganization) || null,
    purchasing_group: text(sapOrder.PurchasingGroup) || null,
    marqueur_suppression: parseBoolean(sapOrder.PurOrderIsMarkedForDeletion) === true
      || text(sapOrder.PurchaseOrderDeletionCode) === 'L',
    // Champs ajoutés depuis analyse S/4HANA Cloud YAAS
    statut_approbation: mapApprovalStatus(sapOrder),
    date_commande: (dateDocument.value || dateCreation.value || now).split('T')[0],
    postes_en_retard: 0, // calculé après import des lignes
    createdAt: now,
    updatedAt: now,
  };

  // 8. Extraire les infos fournisseur (pour UPSERT)
  // Source confirmée par CE_PURCHASEORDER_0001.cds :
  //   _SupplierAddress (Composition of one PurchaseOrderSupplierAddress)
  //     └── OrganizationName1  = Nom 1 du fournisseur (ex: "FRS 8")
  //     └── Country            = Pays ISO (ex: "MA")
  //     └── EmailAddress       = Email
  // Il n'existe PAS de champ SupplierName au niveau header PO dans cette API.
  const supplierAddr = sapOrder._SupplierAddress || {};
  const supplier = {
    code_sap: text(sapOrder.Supplier || sapOrder.SupplierCode, ''),
    nom: text(
      supplierAddr.OrganizationName1    // Nom principal — confirmé par CDS
        || supplierAddr.AddresseeFullName // Fallback : personne physique
        || null,
      'Fournisseur inconnu'
    ),
    pays: text(supplierAddr.Country, 'MA'),
    email: text(supplierAddr.EmailAddress),
    telephone: text(sapOrder.SupplierPhoneNumber), // Champ header PO confirmé par CDS
    actif: true,
  };

  return { order, supplier, errors, warnings };
}

/**
 * Mappe un tableau de lignes SAP (A_PurchaseOrderItem) vers des entités CDS LignesCommande.
 *
 * @param {Object[]} sapItems - Lignes brutes SAP
 * @returns {{ lignes: Object[], errors: string[] }}
 */
function mapSAPItemsToCDS(sapItems) {
  if (!Array.isArray(sapItems) || sapItems.length === 0) {
    return { lignes: [], errors: [] };
  }

  const lignes = [];
  const errors = [];

  for (const item of sapItems) {
    // Valider les champs obligatoires
    if (!item.PurchaseOrderItem && !item.PurchaseOrderItemNumber) {
      errors.push('Ligne sans numéro de poste — ignorée.');
      continue;
    }

    const qte = parseDecimal(item.OrderQuantity || item.QuantityOrdered, 'OrderQuantity');
    const prix = parseDecimal(item.NetPriceAmount || item.UnitPrice, 'NetPriceAmount');
    const hasOpenQty = item.OpenPurchaseOrderQuantity !== undefined && item.OpenPurchaseOrderQuantity !== null && item.OpenPurchaseOrderQuantity !== '';
    const openQty = hasOpenQty ? parseDecimal(item.OpenPurchaseOrderQuantity, 'OpenPurchaseOrderQuantity').value : null;
    const deliveredQty = item.DeliveredQuantity !== undefined
      ? parseDecimal(item.DeliveredQuantity, 'DeliveredQuantity').value
      : hasOpenQty ? Math.max(qte.value - openQty, 0) : 0;

    if (qte.error) errors.push(qte.error);
    if (prix.error) errors.push(prix.error);

    lignes.push({
      ID: uuid(),
      numero_poste: parseInt(text(item.PurchaseOrderItem || item.PurchaseOrderItemNumber, '0'), 10),
      code_produit: limitText(item.Material || item.ProductCode, 40, 'INCONNU'),
      designation_produit: limitText(item.PurchaseOrderItemText || item.Description, 80),
      quantite_commandee: qte.value,
      quantite_livree: deliveredQty,
      prix_unitaire: prix.value,
      unite: limitText(item.OrderPriceUnit || item.PurchaseOrderQuantityUnit || item.OrderQuantityUnit || item.Unit, 6, 'PC'),
      poids_total: parseDecimal(item.ItemGrossWeight || item.GrossWeight || 0, 'ItemGrossWeight').value || null,
      // Champs SAP au niveau item — nouveaux
      categorie_article: limitText(item.ArticleCategory || item.MaterialGroup, 20) || null,
      plant: limitText(item.Plant, 4) || null,
    });
  }

  return { lignes, errors };
}

function computeOrderAmountFromItems(sapItems) {
  if (!Array.isArray(sapItems) || sapItems.length === 0) return 0;
  return Math.round(sapItems.reduce((total, item) => {
    const explicitNet = parseDecimal(item.NetAmount || item.PurchaseOrderItemNetAmount, 'ItemNetAmount').value;
    if (explicitNet) return total + explicitNet;

    const qty = parseDecimal(item.OrderQuantity || item.QuantityOrdered, 'OrderQuantity').value;
    const price = parseDecimal(item.NetPriceAmount || item.UnitPrice, 'NetPriceAmount').value;
    const priceQty = parseDecimal(item.NetPriceQuantity || item.PriceQuantity || 1, 'PriceQuantity', { defaultValue: 1 }).value || 1;
    return total + ((qty * price) / priceQty);
  }, 0) * 100) / 100;
}

// ===========================================================================
// RETRY — Exponential Backoff
// ===========================================================================

/** Délais de retry en ms : 1s, 2s, 4s */
const RETRY_DELAYS = [1000, 2000, 4000];
const MAX_RETRIES = RETRY_DELAYS.length;

function getHttpStatus(err) {
  return err?.reason?.response?.status || err?.response?.status || err?.reason?.status || err?.status || err?.statusCode;
}

function isRetryableError(err) {
  const status = getHttpStatus(err);
  return !status || status === 408 || status === 429 || status >= 500;
}

function toODataDateTimeOffset(value) {
  const source = value || new Date(Date.now() - 86400000);
  const date = source instanceof Date ? source : new Date(source);

  if (Number.isNaN(date.getTime())) {
    LOG.warn('Date DELTA invalide (%s) - fallback 24h', source);
    return new Date(Date.now() - 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function buildPurchaseOrderUrl({ mode, lastSyncDate, pageSize }) {
  const baseUrl = '/sap/opu/odata4/sap/api_purchaseorder_2/srvd_a2x/sap/purchaseorder/0001/PurchaseOrder';
  const query = [
    `$expand=${encodeURIComponent('_PurchaseOrderItem,_SupplierAddress')}`,
    `$top=${encodeURIComponent(String(pageSize))}`,
  ];

  if (mode !== 'FULL') {
    const filterDate = toODataDateTimeOffset(lastSyncDate);
    query.push(`$filter=${encodeURIComponent(`LastChangeDateTime gt ${filterDate}`)}`);
  }

  return `${baseUrl}?${query.join('&')}`;
}

function normalizeSapRelativeUrl(url) {
  if (!url || typeof url !== 'string') return null;
  if (url.startsWith('/')) return url;

  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

/**
 * Exécute une fonction async avec retry + exponential backoff.
 * 3 tentatives avec délais : 1s → 2s → 4s.
 *
 * @param {Function} fn - Fonction async à exécuter
 * @param {string} label - Label pour les logs
 * @returns {Promise<any>} Résultat de la fonction
 */
async function _withRetry(fn, label = 'opération') {
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isRetryableError(err)) {
        LOG.warn('Retry %s annule : erreur non transitoire (%s)', label, err.message);
        throw err;
      }
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAYS[attempt];
        LOG.warn('Retry %s — tentative %d/%d échouée (%s), retry dans %dms',
          label, attempt + 1, MAX_RETRIES, err.message, delay);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

// ===========================================================================
// SYNC — Orchestration de la synchronisation SAP
// ===========================================================================

/**
 * Synchronise les commandes depuis SAP (DELTA ou FULL).
 *
 * Fonctionnalités :
 * - Mode DELTA : $filter sur LastChangeDateTime > dernier sync réussi
 * - Mode FULL  : récupère toutes les commandes (max 500/page)
 * - Pagination  : suit automatiquement @odata.nextLink
 * - Retry       : 3 tentatives avec backoff exponentiel (1s, 2s, 4s)
 * - SyncJobs    : enregistre le résultat dans smartorder_SyncJobs
 * - WebSocket   : émet SYNC_AUTO_COMPLETE vers la room ADMIN
 *
 * @param {string} mode - 'DELTA' (dernière sync) ou 'FULL' (toutes les commandes)
 * @param {{ jobId?: string, skipJobInsert?: boolean }} options - Réutilisation d'un job créé par la route admin.
 * @returns {{ creees: number, mises_a_jour: number, erreurs: number, details: Object[] }}
 */
async function syncDelta(mode = 'DELTA', options = {}) {
  const db = await cds.connect.to('db');
  const io = global._socketIO;
  let creees = 0, mises_a_jour = 0, erreurs = 0;
  const details = [];
  const startedAt = new Date();

  // Créer le job de sync en BDD
  const jobId = options.jobId || uuid();
  if (!options.skipJobInsert) {
    try {
      await db.run(
        `INSERT INTO smartorder_SyncJobs (ID, mode, statut, started_at, createdAt)
         VALUES (${p(1)}, ${p(2)}, 'EN_COURS', ${p(3)}, ${p(4)})`,
        bind([jobId, mode, startedAt.toISOString(), startedAt.toISOString()])
      );
    } catch (err) {
      LOG.warn('Impossible d\'enregistrer le job sync : %s', err.message);
    }
  }

  LOG.info('Sync SAP démarrée — mode=%s jobId=%s', mode, jobId);

  try {
    await ensurePostgresSyncSchema(db);

    // 1. Récupérer la date du dernier sync réussi (pour mode DELTA)
    const lastSyncDate = await _getLastSyncDate(db);

    // 2. Appeler l'API SAP avec pagination et retry
    const allEntities = await _fetchAllPagesFromSAP(mode, lastSyncDate);

    LOG.info('Sync SAP — %d commande(s) reçue(s) depuis SAP', allEntities.length);

    // 3. Traiter chaque commande
    for (const sapOrder of allEntities) {
      try {
        const result = await _processOneOrder(db, sapOrder);
        if (result.action === 'created') creees++;
        else if (result.action === 'updated') mises_a_jour++;
        details.push(result);
      } catch (err) {
        erreurs++;
        details.push({
          numero_sap: sapOrder.PurchaseOrder || 'INCONNU',
          action: 'error',
          error: err.message,
        });
        LOG.warn('Erreur sync commande %s : %s', sapOrder.PurchaseOrder, err.message);
      }
    }

    // 4. Mettre à jour le job de sync → SUCCES
    const endedAt = new Date();
    try {
      await db.run(
        `UPDATE smartorder_SyncJobs
         SET statut='SUCCES', commandes_creees=${p(1)}, commandes_maj=${p(2)},
             erreurs=${p(3)}, ended_at=${p(4)}, depuis=${p(5)}, duree_ms=${p(6)}
         WHERE ID=${p(7)}`,
        bind([creees, mises_a_jour, erreurs, endedAt.toISOString(),
          lastSyncDate || startedAt.toISOString(), endedAt - startedAt, jobId])
      );
    } catch (err) {
      LOG.warn('Impossible de mettre à jour le job sync : %s', err.message);
    }

    // 5. Émettre WebSocket → ADMIN
    if (io && (creees > 0 || mises_a_jour > 0)) {
      io.to('ADMIN').emit('SYNC_AUTO_COMPLETE', {
        jobId,
        mode,
        creees,
        mises_a_jour,
        erreurs,
        duree_ms: endedAt - startedAt,
        timestamp: endedAt.toISOString(),
      });
    }

  } catch (err) {
    // Mettre à jour le job de sync → ECHEC
    try {
      await db.run(
        `UPDATE smartorder_SyncJobs
         SET statut='ECHEC', error_message=${p(1)}, ended_at=${p(2)}, erreurs=${p(3)}
         WHERE ID=${p(4)}`,
        bind([err.message, new Date().toISOString(), erreurs + 1, jobId])
      );
    } catch (dbErr) {
      LOG.warn('Impossible de mettre à jour le job sync (échec) : %s', dbErr.message);
    }

    LOG.error('Erreur sync SAP globale : %s', err.message);
    throw err;
  }

  LOG.info('Sync SAP terminée — créées=%d maj=%d erreurs=%d (jobId=%s)',
    creees, mises_a_jour, erreurs, jobId);
  return { creees, mises_a_jour, erreurs, details, jobId };
}

async function ensurePostgresSyncSchema(db) {
  if (!isPostgres()) return;

  const statements = [
    'ALTER TABLE smartorder_LignesCommande ALTER COLUMN unite TYPE varchar(6)',
    'ALTER TABLE smartorder_LignesCommande ALTER COLUMN categorie_article TYPE varchar(20)',
    'ALTER TABLE smartorder_LignesCommande ALTER COLUMN designation_produit TYPE varchar(80)',
    'ALTER TABLE smartorder_SyncJobs ADD COLUMN IF NOT EXISTS duree_ms integer',
    'ALTER TABLE smartorder_SyncJobs ADD COLUMN IF NOT EXISTS error_message text',
  ];

  for (const statement of statements) {
    try {
      await db.run(statement);
    } catch (err) {
      LOG.debug('Migration sync ignoree (%s) : %s', statement, err.message);
    }
  }
}

// ===========================================================================
// FETCH — API SAP avec pagination et retry
// ===========================================================================

/**
 * Récupère TOUTES les pages de résultats SAP en suivant @odata.nextLink.
 * Applique un retry avec backoff exponentiel sur chaque appel HTTP.
 *
 * @param {string} mode - 'DELTA' ou 'FULL'
 * @param {string|null} lastSyncDate - Date ISO du dernier sync réussi
 * @returns {Object[]} Toutes les entités SAP récupérées
 */
async function _fetchAllPagesFromSAP(mode, lastSyncDate) {
  // USE_MOCK_SAP=true → données simulées (BAS dev, tests, démo)
  // USE_MOCK_SAP=false ou absent → appel réel SAP S/4HANA Cloud
  if (process.env.USE_MOCK_SAP === 'true') {
    LOG.info('USE_MOCK_SAP=true — utilisation des données simulées SAP');
    return parseODataResponse(_getMockSAPData()).entities;
  }

  // Construire l'URL initiale — OData v4.
  // _SupplierAddress : Composition of one confirmée par CE_PURCHASEORDER_0001.cds.
  // URLSearchParams encode le $filter pour éviter les dates JS invalides dans l'URL SAP.
  const pageSize = mode === 'FULL' ? 500 : 100;
  let url = buildPurchaseOrderUrl({ mode, lastSyncDate, pageSize });

  const allEntities = [];
  let pageCount = 0;
  const MAX_PAGES = 50; // Sécurité : max 50 pages (25 000 commandes)

  while (url && pageCount < MAX_PAGES) {
    pageCount++;
    LOG.debug('Sync SAP — fetch page %d : %s', pageCount, url.substring(0, 120));

    // Appeler SAP avec retry
    const response = await _withRetry(
      () => _callSAPDestination(url),
      `SAP page ${pageCount}`
    );

    // Parser la réponse
    const { entities, errors } = parseODataResponse(response);
    if (errors.length > 0) {
      LOG.warn('Erreurs parsing page %d : %s', pageCount, errors.join('; '));
    }

    allEntities.push(...entities);

    // Vérifier s'il y a une page suivante
    url = normalizeSapRelativeUrl(_getNextLink(response));
    if (url) {
      LOG.debug('Sync SAP — @odata.nextLink trouvé, page suivante…');
    }
  }

  if (pageCount >= MAX_PAGES) {
    LOG.warn('Sync SAP — plafond de %d pages atteint. Certaines données n\'ont peut-être pas été récupérées.', MAX_PAGES);
  }

  LOG.info('Sync SAP — %d page(s) chargée(s), %d entité(s) au total', pageCount, allEntities.length);
  return allEntities;
}


/**
 * Appelle le SAP Destination Service pour une URL donnée.
 * Séparé pour faciliter le retry.
 */
async function _callSAPDestination(url) {
  const relativeUrl = normalizeSapRelativeUrl(url);
  try {
    const dest = await cds.connect.to('SAP_ERP');
    return await dest.get(relativeUrl);
  } catch (err) {
    const status = getHttpStatus(err);
    const message = status === 401 || status === 403
      ? `Authentification SAP refusee (${status}). Verifie la destination SAP_ERP, ses credentials et les autorisations du communication user.`
      : `Connexion SAP echouee : ${err.message}`;
    LOG.error('Erreur appel SAP : %s (url=%s)', message, relativeUrl.substring(0, 160));
    const wrapped = new Error(message);
    wrapped.statusCode = status;
    wrapped.correlationId = err?.reason?.correlationId || err?.correlationId;
    wrapped.cause = err;
    throw wrapped;
  }
}

/**
 * Extrait le lien @odata.nextLink pour la pagination.
 * Supporte OData v4 et v2.
 *
 * @param {Object} response - Réponse OData brute
 * @returns {string|null} URL de la page suivante, ou null
 */
function _getNextLink(response) {
  if (!response || typeof response !== 'object') return null;

  // OData v4 : @odata.nextLink
  if (response['@odata.nextLink']) {
    return response['@odata.nextLink'];
  }

  // OData v2 : __next dans d
  if (response.d?.__next) {
    return response.d.__next;
  }

  // OData v4 variante : @nextLink
  if (response['@nextLink']) {
    return response['@nextLink'];
  }

  return null;
}

/**
 * Traite une commande SAP individuelle (UPSERT).
 */
async function _processOneOrder(db, sapOrder) {
  // 1. Mapper SAP → CDS
  const { order, supplier, errors, warnings } = mapSAPOrderToCDS(sapOrder);

  if (errors.length > 0) {
    throw new Error(`Validation échouée : ${errors.join('; ')}`);
  }

  if (warnings.length > 0) {
    LOG.debug('Sync %s — avertissements : %s', order.numero_sap, warnings.join('; '));
  }

  const sapItems = sapOrder._PurchaseOrderItem
    || sapOrder.to_PurchaseOrderItem?.results
    || sapOrder.to_PurchaseOrderItem
    || [];

  if ((!order.montant_total || order.montant_total === 0) && sapItems.length > 0) {
    order.montant_total = computeOrderAmountFromItems(sapItems);
  }

  // 2. UPSERT fournisseur
  let fournisseur_ID = null;
  if (supplier.code_sap) {
    const existing = await db.run(
      `SELECT ID FROM smartorder_Fournisseurs WHERE code_sap = ${p(1)}`,
      bind([supplier.code_sap])
    );

    if (existing.length > 0) {
      fournisseur_ID = existing[0].ID;
      await db.run(
        `UPDATE smartorder_Fournisseurs
         SET nom=${p(1)}, pays=${p(2)}, email=${p(3)}, telephone=${p(4)},
             actif=${p(5)}, derniere_sync=${p(6)}, updatedAt=${p(7)}
         WHERE ID=${p(8)}`,
        bind([
          supplier.nom,
          normalizeCountryCode(supplier.pays),
          supplier.email,
          supplier.telephone,
          true,
          new Date().toISOString(),
          new Date().toISOString(),
          fournisseur_ID,
        ])
      );
    } else {
      fournisseur_ID = uuid();
      await db.run(
        `INSERT INTO smartorder_Fournisseurs
         (ID, code_sap, nom, pays, email, telephone, actif, derniere_sync, createdAt, updatedAt)
         VALUES (${p(1)},${p(2)},${p(3)},${p(4)},${p(5)},${p(6)},${p(7)},${p(8)},${p(9)},${p(10)})`,
        bind([
          fournisseur_ID,
          supplier.code_sap,
          supplier.nom,
          normalizeCountryCode(supplier.pays),
          supplier.email,
          supplier.telephone,
          true,
          new Date().toISOString(),
          new Date().toISOString(),
          new Date().toISOString(),
        ])
      );
    }
  }

  // 3. UPSERT commande
  const existingOrder = await db.run(
    `SELECT ID FROM smartorder_Orders WHERE numero_sap = ${p(1)}`,
    bind([order.numero_sap])
  );

  let action;
  let orderId;

  if (existingOrder.length > 0) {
    // UPDATE
    orderId = existingOrder[0].ID;
    await db.run(
      `UPDATE smartorder_Orders
       SET statut=${p(1)}, montant_total=${p(2)}, date_modification=${p(3)}, date_previsionnelle=${p(4)},
           date_livraison_reelle=${p(5)}, updatedAt=${p(6)}, fournisseur_ID=${p(7)},
           company_code=${p(8)}, purchasing_org=${p(9)}, purchasing_group=${p(10)},
           marqueur_suppression=${p(11)}, statut_approbation=${p(12)},
           date_commande=${p(13)}, postes_en_retard=${p(14)}
       WHERE ID=${p(15)}`,
      bind([order.statut, order.montant_total, order.date_modification,
      order.date_previsionnelle, order.date_livraison_reelle,
      new Date().toISOString(), fournisseur_ID,
      order.company_code, order.purchasing_org, order.purchasing_group,
      order.marqueur_suppression, order.statut_approbation,
      order.date_commande, order.postes_en_retard, orderId])
    );
    action = 'updated';
  } else {
    // INSERT
    orderId = uuid();
    await db.run(
      `INSERT INTO smartorder_Orders
       (ID, numero_sap, type, statut, urgence,
        date_creation, date_previsionnelle, date_livraison_reelle,
        date_modification, montant_total, devise, score_priorite,
        company_code, purchasing_org, purchasing_group, marqueur_suppression,
        statut_approbation, date_commande, postes_en_retard,
        fournisseur_ID, createdAt, updatedAt)
       VALUES (${p(1)},${p(2)},${p(3)},${p(4)},${p(5)},${p(6)},${p(7)},${p(8)},${p(9)},${p(10)},${p(11)},${p(12)},${p(13)},${p(14)},${p(15)},${p(16)},${p(17)},${p(18)},${p(19)},${p(20)},${p(21)},${p(22)})`,
      bind([orderId, order.numero_sap, order.type, order.statut, order.urgence,
        order.date_creation, order.date_previsionnelle,
        order.date_livraison_reelle, order.date_modification, order.montant_total,
        order.devise, order.score_priorite,
        order.company_code, order.purchasing_org, order.purchasing_group,
        order.marqueur_suppression,
        order.statut_approbation, order.date_commande, order.postes_en_retard,
        fournisseur_ID, order.createdAt, order.updatedAt])
    );
    action = 'created';
  }

  // 4. Traiter les lignes de commande (si présentes) — OData v4
  if (sapItems.length > 0) {
    const { lignes } = mapSAPItemsToCDS(sapItems);
    await db.run(
      `DELETE FROM smartorder_LignesCommande WHERE commande_ID = ${p(1)}`,
      bind([orderId])
    );
    for (const ligne of lignes) {
      ligne.commande_ID = orderId;
      try {
        await db.run(
          `INSERT INTO smartorder_LignesCommande
           (ID, commande_ID, numero_poste, code_produit, designation_produit,
            quantite_commandee, quantite_livree, prix_unitaire, unite, poids_total,
            categorie_article, plant)
           VALUES (${p(1)},${p(2)},${p(3)},${p(4)},${p(5)},${p(6)},${p(7)},${p(8)},${p(9)},${p(10)},${p(11)},${p(12)})`,
          bind([ligne.ID, ligne.commande_ID, ligne.numero_poste, ligne.code_produit,
          ligne.designation_produit, ligne.quantite_commandee, ligne.quantite_livree,
          ligne.prix_unitaire, ligne.unite, ligne.poids_total,
          ligne.categorie_article, ligne.plant])
        );
      } catch (e) {
        LOG.warn('Ligne SAP ignoree (commande=%s poste=%s) : %s', order.numero_sap, ligne.numero_poste, e.message);
      }
    }
  }

  // 5. Calculer les postes en retard
  const today = new Date().toISOString().split('T')[0];
  const postesEnRetard = sapItems.length > 0
    ? sapItems.filter(item => {
        const datePrev = order.date_previsionnelle;
        const qteCommandee = parseDecimal(item.OrderQuantity || item.QuantityOrdered || 0, 'qty').value;
        const qteLivree = parseDecimal(item.DeliveredQuantity || 0, 'qty').value;
        return datePrev && datePrev < today && qteLivree < qteCommandee;
      }).length
    : 0;

  if (postesEnRetard > 0) {
    await db.run(
      `UPDATE smartorder_Orders SET postes_en_retard=${p(1)} WHERE ID=${p(2)}`,
      bind([postesEnRetard, orderId])
    );
  }

  if (fournisseur_ID) {
    await recalculateSupplierMetrics(db, fournisseur_ID);
  }

  return { numero_sap: order.numero_sap, action, warnings };
}

// ===========================================================================
// HELPERS
// ===========================================================================

/**
 * Récupère la date du dernier sync réussi depuis la table SyncJobs.
 * Utilisé pour le mode DELTA ($filter LastChangeDateTime gt ...).
 *
 * @param {Object} db - Connexion CDS DB
 * @returns {string|null} Date ISO du dernier sync, ou null
 */
async function _getLastSyncDate(db) {
  try {
    const rows = await db.run(
      `SELECT ended_at FROM smartorder_SyncJobs
       WHERE statut = 'SUCCES'
       ORDER BY ended_at DESC
       LIMIT 1`
    );
    if (rows.length > 0 && rows[0].ended_at) {
      const lastSync = toODataDateTimeOffset(rows[0].ended_at);
      LOG.debug('Dernier sync réussi : %s', lastSync);
      return lastSync;
    }
  } catch (err) {
    LOG.warn('Impossible de lire la dernière date de sync : %s', err.message);
  }

  // Fallback : 24h en arrière
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString();
}

/**
 * Données simulées SAP pour le mode développement.
 * Permet de tester le parsing et le mapping sans connexion SAP réelle.
 */
function _getMockSAPData() {
  return {
    value: [
      {
        PurchaseOrder: '4500000099',
        PurchaseOrderType: 'NB',
        PurchasingProcessingStatus: '03',
        Supplier: 'SUP-001',
        SupplierName: 'Fournisseur Test Casablanca',
        SupplierCountry: 'MA',
        DocumentCurrency: 'MAD',
        TotalNetAmount: '125000.00',
        CompanyCode: '1000',
        PurchasingOrganization: '1000',
        PurchasingGroup: '001',
        PurOrderIsMarkedForDeletion: false,
        ReleaseStatus: 'X',
        CreationDate: new Date().toISOString(),
        PurchaseOrderDate: new Date().toISOString(),
        RequestedDeliveryDate: new Date(Date.now() + 14 * 86400000).toISOString(),
        LastChangeDateTime: new Date().toISOString(),
        _PurchaseOrderItem: [
          {
            PurchaseOrderItem: '00010',
            Material: 'MAT-A001',
            PurchaseOrderItemText: 'Composant électronique A1',
            OrderQuantity: '100',
            NetPriceAmount: '850.00',
            OrderPriceUnit: 'PC',
            ArticleCategory: 'ELEC',
            Plant: '1000',
          },
          {
            PurchaseOrderItem: '00020',
            Material: 'MAT-B002',
            PurchaseOrderItemText: 'Câble fibre optique 10m',
            OrderQuantity: '50',
            NetPriceAmount: '400.00',
            OrderPriceUnit: 'PC',
            ArticleCategory: 'ELEC',
            Plant: '1000',
          },
        ],
      },
      {
        PurchaseOrder: '4500000100',
        PurchaseOrderType: 'UB',
        PurchasingProcessingStatus: '05',
        Supplier: 'SUP-002',
        SupplierName: 'YAAS Logistics Rabat',
        SupplierCountry: 'MA',
        DocumentCurrency: 'EUR',
        TotalNetAmount: '340000.00',
        CreationDate: new Date(Date.now() - 7 * 86400000).toISOString(),
        RequestedDeliveryDate: new Date(Date.now() - 2 * 86400000).toISOString(),
        LastChangeDateTime: new Date().toISOString(),
        _PurchaseOrderItem: [],
      },
    ],
  };
}

// ===========================================================================
// EXPORTS
// ===========================================================================
module.exports = {
  syncDelta,
  parseODataResponse,
  mapSAPOrderToCDS,
  mapSAPItemsToCDS,
  computeOrderAmountFromItems,
  parseDate,
  parseDecimal,
  ensurePostgresSyncSchema,
  toODataDateTimeOffset,
  buildPurchaseOrderUrl,
  normalizeSapRelativeUrl,
  // Constantes (pour tests)
  SAP_STATUS_MAP,
  SAP_TYPE_LABELS,
  VALID_SAP_TYPES,
  REQUIRED_SAP_FIELDS,
};
