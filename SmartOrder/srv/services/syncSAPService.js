'use strict';

const cds = require('@sap/cds');
const { uuid } = cds.utils;
const LOG = cds.log('sap-sync');

// ---------------------------------------------------------------------------
// Helper : compatibilité SQLite (dev) / PostgreSQL (production)
// ---------------------------------------------------------------------------
function isPostgres() {
  try {
    const db = cds.env.requires?.db;
    const kind = db?.kind || db?.[process.env.NODE_ENV]?.kind || 'sqlite';
    return kind === 'postgres' || kind === 'postgresql';
  } catch { return false; }
}

/**
 * dbRun — Wrapper autour de db.run() qui convertit les placeholders $N → ?
 * pour SQLite, tout en gardant $N pour PostgreSQL en production.
 * Utilisation : await dbRun(db, `SELECT ... WHERE id = $1`, [id]);
 */
function dbRun(db, query, params = []) {
  if (!isPostgres()) {
    // Convertir $1,$2,... en ? pour SQLite
    query = query.replace(/\$\d+/g, '?');
    // Convertir TRUE/FALSE littéraux en 1/0
    query = query.replace(/\bTRUE\b/g, '1').replace(/\bFALSE\b/g, '0');
  }
  return db.run(query, params);
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
  const val = sapOrder[field];
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
  const sapStatus = String(sapOrder.PurchasingProcessingStatus).padStart(2, '0');
  const statut = SAP_STATUS_MAP[sapStatus];
  if (!statut) {
    warnings.push(`Statut SAP inconnu "${sapStatus}" — défaut: EN_ATTENTE.`);
  }

  // 3. Mapper le type de commande — stocke le code SAP brut
  const type = (sapOrder.PurchaseOrderType || 'NB').trim();
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

  // Date prévisionnelle : DeliveryDate ou ScheduleLineDeliveryDate
  const rawDatePrev = sapOrder.RequestedDeliveryDate
    || sapOrder.ScheduleLineDeliveryDate
    || sapOrder.DeliveryDate;
  const datePrevisionnelle = parseDate(rawDatePrev, 'RequestedDeliveryDate');
  if (!datePrevisionnelle.value) {
    // Si pas de date prévisionnelle, utiliser date création + 14 jours
    const fallback = dateCreation.value ? new Date(dateCreation.value) : new Date();
    fallback.setDate(fallback.getDate() + 14);
    datePrevisionnelle.value = fallback.toISOString().split('T')[0];
    warnings.push('RequestedDeliveryDate absente — défaut: date_creation + 14 jours.');
  }

  // 5. Parser le montant total
  const montant = parseDecimal(
    sapOrder.TotalNetAmount || sapOrder.NetAmount || sapOrder.PurchaseOrderNetAmount || 0,
    'TotalNetAmount'
  );
  if (montant.error) warnings.push(montant.error);

  // 6. Déterminer l'urgence basée sur le montant et la date
  let urgence = 'NORMALE';
  if (montant.value > 500000 || sapOrder.Priority === 'HIGH') {
    urgence = 'CRITIQUE';
  } else if (montant.value > 100000 || sapOrder.Priority === 'MEDIUM') {
    urgence = 'HAUTE';
  }

  // 7. Construire l'entité CDS Order
  const now = new Date().toISOString();
  const order = {
    numero_sap: String(sapOrder.PurchaseOrder).trim(),
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
    devise: (sapOrder.DocumentCurrency || 'EUR').trim().toUpperCase(),
    score_priorite: 0, // calculé par ML ensuite
    // Champs organisationnels SAP
    company_code: (sapOrder.CompanyCode || '').trim() || null,
    purchasing_org: (sapOrder.PurchasingOrganization || '').trim() || null,
    purchasing_group: (sapOrder.PurchasingGroup || '').trim() || null,
    marqueur_suppression: sapOrder.PurOrderIsMarkedForDeletion === true
      || sapOrder.PurchaseOrderDeletionCode === 'L',
    // Champs ajoutés depuis analyse S/4HANA Cloud YAAS
    statut_approbation: (sapOrder.ReleaseStatus || '').trim(),
    date_commande: (dateDocument.value || dateCreation.value || now).split('T')[0],
    postes_en_retard: 0, // calculé après import des lignes
    createdAt: now,
    updatedAt: now,
  };

  // 8. Extraire les infos fournisseur (pour UPSERT)
  const supplier = {
    code_sap: String(sapOrder.Supplier || sapOrder.SupplierCode || '').trim(),
    nom: sapOrder.SupplierName || sapOrder.Supplier || 'Fournisseur inconnu',
    pays: sapOrder.SupplierCountry || sapOrder.Country || 'MA',
    email: sapOrder.SupplierEmail || sapOrder.EmailAddress || null,
    telephone: sapOrder.SupplierPhone || sapOrder.PhoneNumber || null,
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

    if (qte.error) errors.push(qte.error);
    if (prix.error) errors.push(prix.error);

    lignes.push({
      ID: uuid(),
      numero_poste: parseInt(item.PurchaseOrderItem || item.PurchaseOrderItemNumber, 10),
      code_produit: String(item.Material || item.ProductCode || 'INCONNU').trim(),
      designation_produit: item.PurchaseOrderItemText || item.Description || null,
      quantite_commandee: qte.value,
      quantite_livree: parseDecimal(item.DeliveredQuantity || 0, 'DeliveredQuantity').value,
      prix_unitaire: prix.value,
      unite: item.OrderPriceUnit || item.Unit || 'PC',
      poids_total: parseDecimal(item.GrossWeight || 0, 'GrossWeight').value || null,
      // Champs SAP au niveau item — nouveaux
      categorie_article: (item.ArticleCategory || item.MaterialGroup || '').trim() || null,
      plant: (item.Plant || '').trim() || null,
    });
  }

  return { lignes, errors };
}

// ===========================================================================
// RETRY — Exponential Backoff
// ===========================================================================

/** Délais de retry en ms : 1s, 2s, 4s */
const RETRY_DELAYS = [1000, 2000, 4000];
const MAX_RETRIES = RETRY_DELAYS.length;

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
 * @returns {{ creees: number, mises_a_jour: number, erreurs: number, details: Object[] }}
 */
async function syncDelta(mode = 'DELTA') {
  const db = await cds.connect.to('db');
  const io = global._socketIO;
  let creees = 0, mises_a_jour = 0, erreurs = 0;
  const details = [];
  const startedAt = new Date();

  // Créer le job de sync en BDD
  const jobId = uuid();
  try {
    await dbRun(db,
      `INSERT INTO smartorder_SyncJobs (ID, mode, statut, started_at, createdAt)
       VALUES ($1, $2, 'EN_COURS', $3, $4)`,
      [jobId, mode, startedAt.toISOString(), startedAt.toISOString()]
    );
  } catch (err) {
    LOG.warn('Impossible d\'enregistrer le job sync : %s', err.message);
  }

  LOG.info('Sync SAP démarrée — mode=%s jobId=%s', mode, jobId);

  try {
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
      await dbRun(db,
        `UPDATE smartorder_SyncJobs
         SET statut='SUCCES', commandes_creees=$1, commandes_maj=$2,
             erreurs=$3, ended_at=$4, depuis=$5
         WHERE ID=$6`,
        [creees, mises_a_jour, erreurs, endedAt.toISOString(),
          lastSyncDate || startedAt.toISOString(), jobId]
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
      await dbRun(db,
        `UPDATE smartorder_SyncJobs
         SET statut='ECHEC', error_message=$1, ended_at=$2, erreurs=$3
         WHERE ID=$4`,
        [err.message, new Date().toISOString(), erreurs + 1, jobId]
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
  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev) {
    LOG.info('Mode développement — utilisation des données simulées SAP');
    const mock = _getMockSAPData();
    return parseODataResponse(mock).entities;
  }

  // Construire l'URL initiale — OData v4
  const baseUrl = '/sap/opu/odata4/sap/api_purchaseorder_2/srvd_a2x/sap/purchaseorder/0001/PurchaseOrder';
  const expand = '$expand=_PurchaseOrderItem';
  const pageSize = mode === 'FULL' ? 500 : 100;

  let url;
  if (mode === 'FULL') {
    url = `${baseUrl}?${expand}&$top=${pageSize}`;
  } else {
    // DELTA : filtrer sur LastChangeDateTime > dernier sync
    const filterDate = lastSyncDate || new Date(Date.now() - 86400000).toISOString();
    url = `${baseUrl}?${expand}&$top=${pageSize}&$filter=LastChangeDateTime gt ${filterDate}`;
  }

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
    url = _getNextLink(response);
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
  try {
    const dest = await cds.connect.to('SAP_ERP');
    return await dest.get(url);
  } catch (err) {
    LOG.error('Erreur appel SAP : %s (url=%s)', err.message, url.substring(0, 100));
    throw new Error(`Connexion SAP échouée : ${err.message}`);
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

  // 2. UPSERT fournisseur
  let fournisseur_ID = null;
  if (supplier.code_sap) {
    const existing = await dbRun(db,
      `SELECT ID FROM smartorder_Fournisseurs WHERE code_sap = $1`,
      [supplier.code_sap]
    );

    if (existing.length > 0) {
      fournisseur_ID = existing[0].ID;
      await dbRun(db,
        `UPDATE smartorder_Fournisseurs SET nom=$1, pays=$2, updatedAt=$3 WHERE ID=$4`,
        [supplier.nom, supplier.pays, new Date().toISOString(), fournisseur_ID]
      );
    } else {
      fournisseur_ID = uuid();
      await dbRun(db,
        `INSERT INTO smartorder_Fournisseurs (ID, code_sap, nom, pays, email, telephone, actif, createdAt, updatedAt)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [fournisseur_ID, supplier.code_sap, supplier.nom, supplier.pays,
          supplier.email, supplier.telephone, true,
          new Date().toISOString(), new Date().toISOString()]
      );
    }
  }

  // 3. UPSERT commande
  const existingOrder = await dbRun(db,
    `SELECT ID FROM smartorder_Orders WHERE numero_sap = $1`,
    [order.numero_sap]
  );

  let action;
  let orderId;

  if (existingOrder.length > 0) {
    // UPDATE
    orderId = existingOrder[0].ID;
    await dbRun(db,
      `UPDATE smartorder_Orders
       SET statut=$1, montant_total=$2, date_modification=$3, date_previsionnelle=$4,
           date_livraison_reelle=$5, updatedAt=$6, fournisseur_ID=$7,
           company_code=$8, purchasing_org=$9, purchasing_group=$10,
           marqueur_suppression=$11, statut_approbation=$12,
           date_commande=$13, postes_en_retard=$14
       WHERE ID=$15`,
      [order.statut, order.montant_total, order.date_modification,
      order.date_previsionnelle, order.date_livraison_reelle,
      new Date().toISOString(), fournisseur_ID,
      order.company_code, order.purchasing_org, order.purchasing_group,
      order.marqueur_suppression, order.statut_approbation,
      order.date_commande, order.postes_en_retard, orderId]
    );
    action = 'updated';
  } else {
    // INSERT
    orderId = uuid();
    await dbRun(db,
      `INSERT INTO smartorder_Orders
       (ID, numero_sap, type, statut, urgence,
        date_creation, date_previsionnelle, date_livraison_reelle,
        date_modification, montant_total, devise, score_priorite,
        company_code, purchasing_org, purchasing_group, marqueur_suppression,
        statut_approbation, date_commande, postes_en_retard,
        fournisseur_ID, createdAt, updatedAt)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
      [orderId, order.numero_sap, order.type, order.statut, order.urgence,
        order.date_creation, order.date_previsionnelle,
        order.date_livraison_reelle, order.date_modification, order.montant_total,
        order.devise, order.score_priorite,
        order.company_code, order.purchasing_org, order.purchasing_group,
        order.marqueur_suppression,
        order.statut_approbation, order.date_commande, order.postes_en_retard,
        fournisseur_ID, order.createdAt, order.updatedAt]
    );
    action = 'created';
  }

  // 4. Traiter les lignes de commande (si présentes) — OData v4
  const sapItems = sapOrder._PurchaseOrderItem
    || sapOrder.to_PurchaseOrderItem?.results
    || sapOrder.to_PurchaseOrderItem
    || [];
  if (sapItems.length > 0) {
    const { lignes } = mapSAPItemsToCDS(sapItems);
    for (const ligne of lignes) {
      ligne.commande_ID = orderId;
      // ON CONFLICT DO NOTHING n'est pas supporté par SQLite < 3.24 — on ignore les erreurs
      try {
        await dbRun(db,
          `INSERT INTO smartorder_LignesCommande
           (ID, commande_ID, numero_poste, code_produit, designation_produit,
            quantite_commandee, quantite_livree, prix_unitaire, unite, poids_total,
            categorie_article, plant)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [ligne.ID, ligne.commande_ID, ligne.numero_poste, ligne.code_produit,
          ligne.designation_produit, ligne.quantite_commandee, ligne.quantite_livree,
          ligne.prix_unitaire, ligne.unite, ligne.poids_total,
          ligne.categorie_article, ligne.plant]
        );
      } catch (e) { /* doublon ignoré */ }
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
    await dbRun(db,
      `UPDATE smartorder_Orders SET postes_en_retard=$1 WHERE ID=$2`,
      [postesEnRetard, orderId]
    );
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
      LOG.debug('Dernier sync réussi : %s', rows[0].ended_at);
      return rows[0].ended_at;
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
  parseDate,
  parseDecimal,
  // Constantes (pour tests)
  SAP_STATUS_MAP,
  SAP_TYPE_LABELS,
  VALID_SAP_TYPES,
  REQUIRED_SAP_FIELDS,
};
