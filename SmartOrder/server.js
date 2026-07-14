'use strict';
const path = require('path');
require('dotenv').config();
// NOTE: PgPool import removed — all database access now goes through the CDS pool
// to eliminate the double-pool antipattern that was exhausting Neon connections.

const cds = require('@sap/cds');
const LOG = cds.log('server');
const {
  normalizeArray,
  decodeJwtPayload,
  getIdentityFromPayload,
  getIdentityFromUser,
} = require('./srv/utils/identity');
const {
  readOrdersFallback,
  readSuppliersFallback,
  csvFallbackEnabled,
  findUserFallback,
  isRecoverableDbError,
  readUsersFallback,
  readAlertsFallback,
  readHistoryFallback,
  readSyncJobsFallback,
  readMlModelsFallback,
  getCsvReadErrors,
} = require('./srv/utils/csvFallback');

let postgresReady = false;
let postgresSchemaReady = false;
let postgresSchemaError = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getReadTimeoutMs() {
  const configured = Number(process.env.SMARTORDER_READ_TIMEOUT_MS || 30000);
  return Number.isFinite(configured) && configured > 0 ? Math.max(configured, 5000) : 30000;
}

function withReadTimeout(promise, label, timeoutMs = getReadTimeoutMs()) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`${label} timed out after ${timeoutMs}ms`);
        err.code = 'SMARTORDER_READ_TIMEOUT';
        err.statusCode = 503;
        reject(err);
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function isTransientPostgresDisconnect(err) {
  const message = String(err?.message || err || '').toLowerCase();
  const code = String(err?.code || '').toUpperCase();

  return [
    '57P01', '57P02', '57P03', '53300',
    '08006', '08001', '08003',
    'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED',
    'ETIMEDOUT', 'ENOTFOUND', 'ENETUNREACH', 'EPIPE',
    'SMARTORDER_READ_TIMEOUT',
  ].includes(code) || [
    'terminating connection due to administrator command',
    'connection terminated unexpectedly', 'connection terminated',
    'connection timeout', 'timeout exceeded', 'socket hang up',
  ].some((pattern) => message.includes(pattern));
}

let postgresRecoveryScheduled = false;

function markPostgresUnhealthy(err) {
  postgresReady = false;
  postgresSchemaReady = false;
  postgresSchemaError = err?.message || String(err || 'PostgreSQL connection lost');

  // Auto-recovery : relancer le warm-up après 5s si pas déjà planifié.
  // Remplace schedulePostgresRecovery() supprimé lors de la migration CDS pool.
  if (!postgresRecoveryScheduled) {
    postgresRecoveryScheduled = true;
    setTimeout(async () => {
      postgresRecoveryScheduled = false;
      try {
        await warmupDatabase({ attempts: 3, delayMs: 2000 });
      } catch { /* warmupDatabase loggue ses propres erreurs */ }
    }, 5000).unref?.();
  }
}

function configurePostgresRuntime() {
  const db = cds.env.requires?.db;
  if (!db || db.kind !== 'postgres') return;

  const existingPool = db.pool || {};
  const existingClient = db.client || {};

  const isNeonPooler = String(db.credentials?.host || '').includes('-pooler.');
  const poolMax = Number(process.env.SMARTORDER_PG_POOL_MAX || existingPool.max || (isNeonPooler ? 5 : 10));
  const acquireTimeout = Number(process.env.SMARTORDER_PG_ACQUIRE_TIMEOUT_MS || existingPool.acquireTimeoutMillis || 30000);
  const connectionTimeout = Number(process.env.SMARTORDER_PG_CONNECT_TIMEOUT_MS || existingClient.connectionTimeoutMillis || 25000);
  const channelBindingOverride = process.env.SMARTORDER_PG_CHANNEL_BINDING;

  db.pool = {
    ...existingPool,
    min: existingPool.min ?? 1,
    max: Math.max(Math.min(poolMax, 15), 2),
    acquireTimeoutMillis: Math.max(acquireTimeout, 15000),
    destroyTimeoutMillis: Math.max(Number(existingPool.destroyTimeoutMillis) || 0, 5000),
    idleTimeoutMillis: Math.max(Number(existingPool.idleTimeoutMillis) || 0, 30000),
  };

  db.client = {
    ...existingClient,
    connectionTimeoutMillis: Math.max(connectionTimeout, 15000),
    query_timeout: Number(existingClient.query_timeout || process.env.SMARTORDER_PG_QUERY_TIMEOUT_MS || 60000),
    statement_timeout: Number(existingClient.statement_timeout || process.env.SMARTORDER_PG_STATEMENT_TIMEOUT_MS || 120000),
    keepAlive: existingClient.keepAlive ?? true,
    keepAliveInitialDelayMillis: Number(existingClient.keepAliveInitialDelayMillis || 10000),
    enableChannelBinding: channelBindingOverride
      ? channelBindingOverride === 'true'
      : isNeonPooler,
    ssl: existingClient.ssl || { rejectUnauthorized: false },
  };

  if (db.credentials?.sslmode === 'require' && !db.credentials.ssl) {
    db.credentials.ssl = { rejectUnauthorized: false };
  }

  if (isNeonPooler && !db.credentials?.channel_binding) {
    db.credentials.channel_binding = 'require';
  }

  if (!isNeonPooler && db.credentials?.channel_binding) {
    delete db.credentials.channel_binding;
  }
}

async function warmupDatabase({ attempts = 10, delayMs = 3000 } = {}) {
  const dbKind = cds.env.requires?.db?.kind;
  if (dbKind !== 'postgres') {
    postgresReady = true;
    postgresSchemaReady = true;
    return;
  }

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const startedAt = Date.now();
      // Use CDS pool — no more direct PgPool
      const db = await cds.connect.to('db');
      const rows = await db.run(`
        SELECT
          1 AS ok,
          to_regclass('smartorder_orders') AS orders_table,
          to_regclass('smartorder_utilisateurs') AS users_table,
          to_regclass('ordersservice_orders') AS orders_service_relation
      `);

      const schema = rows?.[0] || {};
      postgresReady = true;
      postgresSchemaReady = Boolean(schema.orders_table && schema.users_table && schema.orders_service_relation);
      postgresSchemaError = postgresSchemaReady
        ? null
        : 'Schema PostgreSQL incomplet: tables/vues CAP attendues absentes. Lancez npm run neon:init.';
      if (postgresSchemaReady) {
        LOG.info(`PostgreSQL warm-up OK (attempt=${attempt}, duration=${Date.now() - startedAt}ms)`);
      } else {
        LOG.warn(`PostgreSQL joignable mais schema incomplet (orders=${schema.orders_table || '-'}, users=${schema.users_table || '-'}, ordersService=${schema.orders_service_relation || '-'}). Fallback CSV actif.`);
      }
      return;
    } catch (err) {
      postgresSchemaError = err.message;
      LOG.warn(`PostgreSQL warm-up tentative ${attempt}/${attempts} echouee : ${err.message}`);
      if (attempt < attempts) await sleep(Math.min(delayMs * attempt, 15000));
    }
  }

  LOG.warn('PostgreSQL warm-up non concluant. Le serveur continue, mais les premieres requetes peuvent expirer.');
}

// ---------------------------------------------------------------------------
// queryViaCds — Single pool database query using the CDS connection
// Replaces the former queryPostgresOneShot which maintained a separate PgPool.
// All queries now share the CAP-managed connection pool, eliminating the
// double-pool antipattern that was exhausting Neon's connection limit.
// ---------------------------------------------------------------------------
async function queryViaCds(sql, params = [], options = {}) {
  const timeoutMs = Number(options.timeoutMs || getReadTimeoutMs());
  let timer;

  try {
    const db = await cds.connect.to('db');
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`CDS query timed out after ${timeoutMs}ms`);
        err.code = 'SMARTORDER_READ_TIMEOUT';
        err.statusCode = 503;
        reject(err);
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
    });

    const result = await Promise.race([db.run(sql, params), timeout]);
    postgresReady = true;
    // CDS db.run returns rows directly (array), not { rows }
    return Array.isArray(result) ? result : (result?.rows || [result] || []);
  } catch (err) {
    if (err?.code === 'SMARTORDER_READ_TIMEOUT' || isTransientPostgresDisconnect(err) || isRecoverableDbError(err)) {
      markPostgresUnhealthy(err);
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Alias for backward compatibility — all callers of queryPostgresOneShot
// now go through the CDS pool instead of a separate PgPool.
const queryPostgresOneShot = queryViaCds;

// ---------------------------------------------------------------------------
// Helper functions used by inline Express routes
// ---------------------------------------------------------------------------

function isPostgresPending() {
  return cds.env.requires?.db?.kind === 'postgres' && (!postgresReady || !postgresSchemaReady);
}

function getReadSourceMode() {
  const mode = String(process.env.SMARTORDER_READ_SOURCE || 'auto').trim().toLowerCase();
  if (['postgres', 'db', 'neon'].includes(mode)) return 'postgres';
  if (['csv', 'fallback', 'csv-fallback', 'force-read'].includes(mode)) return 'csv';
  return 'auto';
}

function isCsvReadForced() {
  return (
    getReadSourceMode() === 'csv' ||
    String(process.env.SMARTORDER_CSV_FALLBACK_MODE || '').trim().toLowerCase() === 'force-read'
  );
}

function shouldUseCsvReadFallback() {
  if (!csvFallbackEnabled()) return false;
  if (isCsvReadForced()) return true;
  if (getReadSourceMode() === 'postgres') return false;
  return isPostgresPending();
}

function shouldTryPostgresRead() {
  return cds.env.requires?.db?.kind === 'postgres' && !shouldUseCsvReadFallback();
}

function sqlParam(index) {
  return cds.env.requires?.db?.kind === 'postgres' ? `$${index}` : '?';
}

function parseODataTopSkip(query, defaults = {}) {
  return {
    top: Math.min(Math.max(Number(query.$top || query.top || defaults.top || 20), 1), defaults.maxTop || 500),
    skip: Math.max(Number(query.$skip || query.skip || 0), 0),
  };
}

function parseODataOrderBy(orderBy) {
  const defaultOrder = 'o.date_creation DESC NULLS LAST, o.numero_sap DESC NULLS LAST';
  const raw = String(orderBy || '').trim();
  if (!raw) return defaultOrder;

  const sortableColumns = {
    ID: 'o.id',
    id: 'o.id',
    numero_sap: 'o.numero_sap',
    type: 'o.type',
    statut: 'o.statut',
    urgence: 'o.urgence',
    date_creation: 'o.date_creation',
    date_commande: 'o.date_commande',
    date_previsionnelle: 'o.date_previsionnelle',
    date_livraison_reelle: 'o.date_livraison_reelle',
    date_modification: 'o.date_modification',
    montant_total: 'o.montant_total',
    devise: 'o.devise',
    score_priorite: 'o.score_priorite',
    statut_approbation: 'o.statut_approbation',
    postes_en_retard: 'o.postes_en_retard',
    createdAt: 'o.createdat',
    updatedAt: 'o.updatedat',
  };

  const clauses = raw.split(',')
    .map((part) => {
      const [field, direction] = part.trim().split(/\s+/);
      const column = sortableColumns[field];
      if (!column) return null;
      const dir = String(direction || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
      return `${column} ${dir} NULLS LAST`;
    })
    .filter(Boolean);

  return clauses.length ? clauses.join(', ') : defaultOrder;
}

function buildOrdersWhere(query) {
  const params = [];
  const where = [];
  const filter = String(query.$filter || '');
  const statusMatch = filter.match(/statut\s+eq\s+'([^']+)'/i);
  const search = String(query.$search || query.search || '').replace(/^"|"$/g, '').trim();

  if (statusMatch?.[1]) {
    params.push(statusMatch[1]);
    where.push(`o.statut = ${sqlParam(params.length)}`);
  }

  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    where.push(`(
      LOWER(o.numero_sap) LIKE ${sqlParam(params.length)}
      OR LOWER(o.type) LIKE ${sqlParam(params.length)}
      OR LOWER(o.statut) LIKE ${sqlParam(params.length)}
      OR LOWER(COALESCE(f.nom, '')) LIKE ${sqlParam(params.length)}
      OR LOWER(COALESCE(f.code_sap, '')) LIKE ${sqlParam(params.length)}
    )`);
  }

  return {
    sql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params,
  };
}

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toBoolean(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function mapOrderDirectRow(row) {
  const fournisseurId = row.fournisseur_id || row.fournisseur_id_join;
  const predictionId = row.prediction_id;

  return {
    ID: row.id,
    numero_sap: row.numero_sap,
    type: row.type,
    type_commande: row.type,
    statut: row.statut,
    urgence: row.urgence,
    date_creation: row.date_creation,
    date_commande: row.date_commande,
    date_previsionnelle: row.date_previsionnelle,
    date_livraison_reelle: row.date_livraison_reelle,
    date_modification: row.date_modification,
    montant_total: toNumber(row.montant_total),
    devise: row.devise,
    score_priorite: toNumber(row.score_priorite),
    statut_approbation: row.statut_approbation,
    postes_en_retard: toNumber(row.postes_en_retard),
    company_code: row.company_code,
    purchasing_org: row.purchasing_org,
    purchasing_group: row.purchasing_group,
    marqueur_suppression: toBoolean(row.marqueur_suppression),
    fournisseur_ID: fournisseurId,
    manager_ID: row.manager_id,
    createdAt: row.createdat,
    updatedAt: row.updatedat,
    fournisseur: fournisseurId ? {
      ID: fournisseurId,
      code_sap: row.fournisseur_code_sap,
      nom: row.fournisseur_nom,
      pays: row.fournisseur_pays,
      email: row.fournisseur_email,
      telephone: row.fournisseur_telephone,
      score_performance: toNumber(row.fournisseur_score_performance),
      taux_retard_moyen: toNumber(row.fournisseur_taux_retard_moyen),
      delai_moyen_jours: toNumber(row.fournisseur_delai_moyen_jours),
      actif: row.fournisseur_actif === undefined ? true : toBoolean(row.fournisseur_actif),
    } : null,
    prediction: predictionId ? {
      ID: predictionId,
      commande_ID: row.id,
      risque_label: row.prediction_risque_label,
      risque_score: toNumber(row.prediction_risque_score),
      risque_probabilites: row.prediction_risque_probabilites,
      score_composite: toNumber(row.prediction_score_composite),
      priorite_action: row.prediction_priorite_action,
      duree_estimee_jours: row.prediction_duree_estimee_jours === null || row.prediction_duree_estimee_jours === undefined
        ? null
        : toNumber(row.prediction_duree_estimee_jours),
      duree_reelle_jours: row.prediction_duree_reelle_jours === null || row.prediction_duree_reelle_jours === undefined
        ? null
        : toNumber(row.prediction_duree_reelle_jours),
      suggestion: row.prediction_suggestion,
      features_snapshot: row.prediction_features_snapshot,
      modele_version: row.prediction_modele_version,
      calcule_le: row.prediction_calcule_le,
      recalcul_requis: toBoolean(row.prediction_recalcul_requis),
    } : null,
  };
}

function mapAlertDirectRow(row) {
  const commandeId = row.commande_id || row.commande_ID;
  return {
    ID: row.id || row.ID,
    type: row.type,
    severite: row.severite,
    message: row.message,
    lu: toBoolean(row.lu),
    acquitte: toBoolean(row.acquitte),
    date_creation: row.date_creation,
    date_acquittement: row.date_acquittement,
    commande_ID: commandeId,
    commande: commandeId ? {
      ID: commandeId,
      numero_sap: row.commande_numero_sap,
    } : null,
  };
}

function normalizeCountryCode(value) {
  const aliases = {
    MAR: 'MA',
    FRA: 'FR',
    ESP: 'ES',
    DZA: 'DZ',
    DEU: 'DE',
    ITA: 'IT',
    USA: 'US',
  };
  const raw = String(value || '').trim().toUpperCase();
  return aliases[raw] || raw || 'MA';
}

function mapSupplierDirectRow(row) {
  const score = toNumber(row.score_performance, 1);
  const lateRate = toNumber(row.taux_retard_moyen, 0);
  const ordersCount = toNumber(row.nombre_commandes, 0);
  const lateOrders = toNumber(row.commandes_en_retard, 0);
  const deliveredOrders = toNumber(row.commandes_livrees, 0);

  return {
    ID: row.id,
    code_sap: row.code_sap,
    nom: row.nom,
    pays: normalizeCountryCode(row.pays),
    email: row.email,
    telephone: row.telephone,
    taux_retard_moyen: lateRate,
    delai_moyen_jours: toNumber(row.delai_moyen_jours, 0),
    score_performance: score,
    actif: row.actif === undefined ? true : toBoolean(row.actif),
    derniere_sync: row.derniere_sync,
    createdAt: row.createdat,
    updatedAt: row.updatedat,
    nombre_commandes: ordersCount,
    commandes_actives: toNumber(row.commandes_actives, ordersCount),
    commandes_en_retard: lateOrders,
    commandes_livrees: deliveredOrders,
  };
}

async function readOrdersDirectFromPostgres(query) {
  const { top, skip } = parseODataTopSkip(query, { top: 20, maxTop: 500 });
  const { sql: whereSql, params } = buildOrdersWhere(query);
  const orderBySql = parseODataOrderBy(query.$orderby);

  const dataParams = [...params, top, skip];
  const rows = await queryPostgresOneShot(`
    SELECT
      COUNT(*) OVER()::int AS total_count,
      o.id,
      o.numero_sap,
      o.type,
      o.statut,
      o.urgence,
      o.date_creation,
      o.date_commande,
      o.date_previsionnelle,
      o.date_livraison_reelle,
      o.date_modification,
      o.montant_total,
      o.devise,
      o.score_priorite,
      o.statut_approbation,
      o.postes_en_retard,
      o.company_code,
      o.purchasing_org,
      o.purchasing_group,
      o.marqueur_suppression,
      o.fournisseur_id,
      o.manager_id,
      o.createdat,
      o.updatedat,
      f.id AS fournisseur_id_join,
      f.code_sap AS fournisseur_code_sap,
      f.nom AS fournisseur_nom,
      f.pays AS fournisseur_pays,
      f.email AS fournisseur_email,
      f.telephone AS fournisseur_telephone,
      f.score_performance AS fournisseur_score_performance,
      f.taux_retard_moyen AS fournisseur_taux_retard_moyen,
      f.delai_moyen_jours AS fournisseur_delai_moyen_jours,
      f.actif AS fournisseur_actif,
      p.id AS prediction_id,
      p.risque_label AS prediction_risque_label,
      p.risque_score AS prediction_risque_score,
      p.risque_probabilites AS prediction_risque_probabilites,
      p.score_composite AS prediction_score_composite,
      p.priorite_action AS prediction_priorite_action,
      p.duree_estimee_jours AS prediction_duree_estimee_jours,
      p.duree_reelle_jours AS prediction_duree_reelle_jours,
      p.suggestion AS prediction_suggestion,
      p.features_snapshot AS prediction_features_snapshot,
      p.modele_version AS prediction_modele_version,
      p.calcule_le AS prediction_calcule_le,
      p.recalcul_requis AS prediction_recalcul_requis
    FROM smartorder_orders o
    LEFT JOIN smartorder_fournisseurs f ON f.id = o.fournisseur_id
    LEFT JOIN smartorder_predictions p ON p.commande_id = o.id
    ${whereSql}
    ORDER BY ${orderBySql}
    LIMIT ${sqlParam(dataParams.length - 1)}
    OFFSET ${sqlParam(dataParams.length)}
  `, dataParams);

  return {
    value: rows.map(mapOrderDirectRow),
    '@odata.count': rows?.[0]?.total_count ?? rows.length,
  };
}

async function readSuppliersDirectFromPostgres(query) {
  const top = Math.min(Math.max(Number(query.top || query.$top || 200), 1), 500);
  const skip = Math.max(Number(query.skip || query.$skip || 0), 0);
  const search = String(query.search || query.q || '').trim().toLowerCase();
  const params = [];
  let whereSql = '';

  if (search) {
    params.push(`%${search}%`);
    whereSql = `WHERE (
      LOWER(COALESCE(f.code_sap, '')) LIKE ${sqlParam(params.length)}
      OR LOWER(COALESCE(f.nom, '')) LIKE ${sqlParam(params.length)}
      OR LOWER(COALESCE(f.pays, '')) LIKE ${sqlParam(params.length)}
      OR LOWER(COALESCE(f.email, '')) LIKE ${sqlParam(params.length)}
    )`;
  }

  const dataParams = [...params, top, skip];
  const rows = await queryPostgresOneShot(`
    SELECT
      COUNT(*) OVER()::int AS total_count,
      f.id,
      f.code_sap,
      f.nom,
      f.pays,
      f.email,
      f.telephone,
      f.taux_retard_moyen,
      f.delai_moyen_jours,
      f.score_performance,
      f.actif,
      f.derniere_sync,
      f.createdat,
      f.updatedat,
      COUNT(o.id)::int AS nombre_commandes,
      COUNT(o.id) FILTER (WHERE COALESCE(o.statut, '') <> 'ANNULE')::int AS commandes_actives,
      COUNT(o.id) FILTER (WHERE COALESCE(o.postes_en_retard, 0) > 0)::int AS commandes_en_retard,
      COUNT(o.id) FILTER (WHERE o.statut = 'LIVRE' OR o.date_livraison_reelle IS NOT NULL)::int AS commandes_livrees
    FROM smartorder_fournisseurs f
    LEFT JOIN smartorder_orders o ON o.fournisseur_id = f.id
    ${whereSql}
    GROUP BY
      f.id, f.code_sap, f.nom, f.pays, f.email, f.telephone,
      f.taux_retard_moyen, f.delai_moyen_jours, f.score_performance,
      f.actif, f.derniere_sync, f.createdat, f.updatedat
    ORDER BY f.nom ASC NULLS LAST, f.code_sap ASC NULLS LAST
    LIMIT ${sqlParam(dataParams.length - 1)}
    OFFSET ${sqlParam(dataParams.length)}
  `, dataParams);

  return {
    items: rows.map(mapSupplierDirectRow),
    count: rows?.[0]?.total_count ?? rows.length,
    top,
    skip,
  };
}

function buildProfileFallback(req) {
  const identity = getIdentityFromUser(req.user);
  const user = findUserFallback(req.user?.id || identity.email || identity.username);
  if (!user) return null;

  return {
    ...user,
    role: req.userRole || getUserRole(req) || user.role || 'USER',
    username: identity.username || user.username,
    email: identity.email || user.email,
    displayName: identity.displayName,
    prenom: identity.given_name || user.prenom,
    nom: identity.family_name || user.nom,
    identitySource: identity.name
      ? 'jwt.name'
      : (identity.given_name || identity.family_name ? 'jwt.given_name_family_name' : 'csv-fallback'),
  };
}

function parseJsonObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function mapUserDirectRow(row) {
  return {
    ID: row.id,
    id: row.id,
    xsuaa_user_id: row.xsuaa_user_id,
    username: row.username,
    email: row.email,
    prenom: row.prenom,
    nom: row.nom,
    role: row.role || 'USER',
    perimetre: parseJsonObject(row.perimetre, { company_codes: [], purchasing_orgs: [] }),
    actif: row.actif === undefined ? true : toBoolean(row.actif),
    derniere_connexion: row.derniere_connexion,
    telephone: row.telephone,
    departement: row.departement,
    avatar_url: row.avatar_url,
    preferences: parseJsonObject(row.preferences, {}),
    createdAt: row.createdat,
    updatedAt: row.updatedat,
  };
}

function getProfileCandidatesFromReq(req) {
  const identity = getIdentityFromUser(req.user);
  const values = [
    req.user?.id,
    identity.username,
    identity.email,
    identity.sub,
    identity.user_id,
    req.user?.attr?.username,
    req.user?.attr?.email,
    req.user?.attr?.sub,
    req.user?.attr?.user_id,
  ];
  if (identity.email && identity.email.includes('@')) values.push(identity.email.split('@')[0]);
  return Array.from(new Set(values.filter(Boolean).map((value) => String(value).toLowerCase())));
}

async function readProfileDirectFromPostgres(req) {
  const candidates = getProfileCandidatesFromReq(req);
  if (!candidates.length) return buildProfileFallback(req);

  const rows = await queryPostgresOneShot(`
    SELECT id, xsuaa_user_id, username, email, prenom, nom, role, perimetre,
           actif, derniere_connexion, telephone, departement, avatar_url,
           preferences, createdat, updatedat
    FROM smartorder_utilisateurs
    WHERE LOWER(COALESCE(email, '')) = ANY(${sqlParam(1)}::text[])
       OR LOWER(COALESCE(username, '')) = ANY(${sqlParam(1)}::text[])
       OR LOWER(COALESCE(xsuaa_user_id, '')) = ANY(${sqlParam(1)}::text[])
       OR LOWER(COALESCE(id::text, '')) = ANY(${sqlParam(1)}::text[])
    LIMIT 1
  `, [candidates]);

  const dbUser = rows[0] ? mapUserDirectRow(rows[0]) : buildProfileFallback(req);
  if (!dbUser) return null;

  const identity = getIdentityFromUser(req.user);
  return {
    ...dbUser,
    role: req.userRole || getUserRole(req) || dbUser.role || 'USER',
    username: identity.username || dbUser.username,
    email: identity.email || dbUser.email,
    displayName: identity.displayName || `${dbUser.prenom || ''} ${dbUser.nom || ''}`.trim() || dbUser.username,
    prenom: identity.given_name || dbUser.prenom,
    nom: identity.family_name || dbUser.nom,
    identitySource: identity.name
      ? 'jwt.name'
      : (identity.given_name || identity.family_name ? 'jwt.given_name_family_name' : 'postgres'),
  };
}

async function readUsersDirectFromPostgres(query) {
  const top = Math.min(Math.max(Number(query.top || query.$top || 200), 1), 500);
  const skip = Math.max(Number(query.skip || query.$skip || 0), 0);
  const rows = await queryPostgresOneShot(`
    SELECT COUNT(*) OVER()::int AS total_count,
           id, xsuaa_user_id, username, email, prenom, nom, role, perimetre,
           actif, derniere_connexion, telephone, departement, avatar_url,
           preferences, createdat, updatedat
    FROM smartorder_utilisateurs
    ORDER BY role ASC NULLS LAST, username ASC NULLS LAST
    LIMIT ${sqlParam(1)}
    OFFSET ${sqlParam(2)}
  `, [top, skip]);

  const items = rows.map(mapUserDirectRow);
  const total = rows?.[0]?.total_count ?? items.length;
  return { items, total, count: total, top, skip };
}

configurePostgresRuntime();
// NOTE: installPostgresDisconnectGuards() removed — CDS pool handles reconnection natively

// Force auth.kind = 'mocked' in hybrid development mode.
// This is necessary because `cds bind` stores XSUAA bindings in ~/.cds-services.json
// and those bindings override the [hybrid] profile config at runtime.
// Without this override, the server uses xsuaa auth even when the profile says mocked.
//
// Auth mode resolution:
//   1. USE_MOCK_AUTH=true           → mocked (legacy env var, still supported)
//   2. CDS profile = hybrid        → mocked (daily development)
//   3. CDS profile = hybrid-xsuaa  → xsuaa  (integration testing)
//   4. production (CF)             → xsuaa  (via VCAP_SERVICES)
if (cds.env?.requires?.auth) {
  const activeProfiles = cds.env.profiles || [];
  const isHybridMocked = activeProfiles.includes('hybrid') && !activeProfiles.includes('hybrid-xsuaa');

  if (process.env.USE_MOCK_AUTH === 'true' || isHybridMocked) {
    cds.env.requires.auth.kind = 'mocked';
    LOG.info(`Auth kind forcé à "mocked" (profile=${activeProfiles.join(',') || 'default'}, USE_MOCK_AUTH=${process.env.USE_MOCK_AUTH || 'unset'})`);
  }
}


// ---------------------------------------------------------------------------
// Middleware : Héritage de rôles  ADMIN → MANAGER → USER
// ---------------------------------------------------------------------------
const ROLE_HIERARCHY = { ADMIN: 3, MANAGER: 2, USER: 1 };
const ROLE_SCOPE_ALIASES = {
  ADMIN: ['ADMIN', 'admin.users', 'admin.roles', 'admin.logs', 'admin.sync', 'admin.ml'],
  MANAGER: ['MANAGER', 'analytics.read', 'dashboard.read', 'orders.write', 'export.csv'],
  USER: ['USER', 'orders.read', 'authenticated-user'],
};

/**
 * Enregistre une action dans les logs d'audit
 */
function auditLog(action, details) {
  const entry = {
    timestamp: new Date().toISOString(),
    action,
    ...details,
  };

  LOG.info(`[AUDIT] ${action} — user=${details.user || 'anonymous'} path=${details.path || '-'} role=${details.role || '-'}`);

  // TODO: Enregistrer dans une table d'audit en BDD
  // const db = await cds.connect.to('db');
  // await db.run(INSERT.into('AuditLogs').entries(entry));

  return entry;
}

function getTokenPayload(user) {
  if (typeof user?.tokenInfo?.getPayload === 'function') return user.tokenInfo.getPayload();
  return user?.jwt || user?._?.jwt || {};
}

function getConfiguredDevAdmins() {
  if (process.env.SMARTORDER_ENABLE_DEV_ADMIN !== 'true') return [];
  return normalizeArray((process.env.SMARTORDER_DEV_ADMINS || '').replace(/,/g, ' '))
    .map((value) => value.toLowerCase());
}

function isDevAdminOverride(user) {
  const devAdmins = getConfiguredDevAdmins();
  if (!devAdmins.length || !user) return false;

  const identity = getIdentityFromUser(user);
  const candidates = [
    user.id,
    identity.username,
    identity.email,
    identity.sub,
    identity.user_id,
  ].filter(Boolean).map((value) => String(value).toLowerCase());

  return candidates.some((candidate) => devAdmins.includes(candidate));
}

function getUserScopes(req) {
  const user = req.user;
  if (!user) return [];
  const payload = getTokenPayload(user);

  return [...new Set([
    ...normalizeArray(user.scopes),
    ...normalizeArray(user.scope),
    ...normalizeArray(user.attr?.scopes),
    ...normalizeArray(user.attr?.scope),
    ...normalizeArray(payload?.scope),
    ...(isDevAdminOverride(user) ? [
      'USER',
      'MANAGER',
      'ADMIN',
      'orders.read',
      'orders.write',
      'dashboard.read',
      'predictions.view',
      'analytics.read',
      'export.csv',
      'admin.users',
      'admin.roles',
      'admin.logs',
      'admin.sync',
      'admin.ml',
    ] : []),
  ])];
}

function scopeMatches(scope, expected) {
  return scope === expected || scope.endsWith(`.${expected}`);
}

function hasRoleOrScope(req, expected) {
  if (!req.user) return false;
  if (typeof req.user.is === 'function' && req.user.is(expected)) return true;
  return getUserScopes(req).some((scope) => scopeMatches(scope, expected));
}

function hasAnyRoleScope(req, role) {
  return (ROLE_SCOPE_ALIASES[role] || [role]).some((scope) => hasRoleOrScope(req, scope));
}

function getUserAttribute(req, names, fallback = '') {
  const user = req.user || {};
  const attrs = user.attr || {};
  const payload = getTokenPayload(user);

  for (const name of names) {
    const value = attrs[name] || payload?.[name] || user[name];
    if (value) return Array.isArray(value) ? value[0] : value;
  }
  return fallback;
}

function sanitizeJwtPayload(payload = {}) {
  const claimNames = [
    'iss',
    'aud',
    'zid',
    'origin',
    'sub',
    'user_id',
    'user_name',
    'preferred_username',
    'email',
    'mail',
    'name',
    'given_name',
    'family_name',
    'scope',
    'groups',
    'roles',
    'grant_type',
    'cid',
    'client_id',
    'xsappname',
    'iat',
    'exp',
  ];

  return claimNames.reduce((claims, claimName) => {
    if (payload[claimName] !== undefined) claims[claimName] = payload[claimName];
    return claims;
  }, {});
}

function buildRoleDiagnostics(scopes = [], groups = [], roles = []) {
  const hasScope = (expected) => scopes.some((scope) => scopeMatches(scope, expected));
  const expectedRoleCollections = {
    SmartOrder_User: hasScope('USER') || hasScope('orders.read'),
    SmartOrder_Manager: hasScope('MANAGER') || hasScope('analytics.read') || hasScope('orders.write'),
    SmartOrder_Admin: hasScope('ADMIN') || hasScope('admin.users'),
  };

  return {
    scopes,
    groups,
    roles,
    effectiveRole: expectedRoleCollections.SmartOrder_Admin
      ? 'ADMIN'
      : (expectedRoleCollections.SmartOrder_Manager ? 'MANAGER' : (expectedRoleCollections.SmartOrder_User ? 'USER' : null)),
    expectedRoleCollections,
    notes: {
      SmartOrder_User: expectedRoleCollections.SmartOrder_User
        ? 'OK - le JWT contient un scope USER/orders.read compatible avec SmartOrder_User.'
        : 'Manquant - le JWT ne contient pas de scope USER/orders.read. Verifier que SmartOrder_User contient le role template USER et que l utilisateur/groupe IdP y est assigne.',
      SmartOrder_Manager: expectedRoleCollections.SmartOrder_Manager
        ? 'OK - scopes manager detectes.'
        : 'Absent dans ce JWT.',
      SmartOrder_Admin: expectedRoleCollections.SmartOrder_Admin
        ? 'OK - scopes admin detectes.'
        : 'Absent dans ce JWT.',
    },
  };
}

/**
 * Extrait le rôle effectif depuis le contexte CAP req.user
 * Compatible mode mocked (dev) et XSUAA (production)
 */
function getUserRole(req) {
  if (!req.user) return null;
  if (isDevAdminOverride(req.user)) return 'ADMIN';
  if (hasAnyRoleScope(req, 'ADMIN')) return 'ADMIN';
  if (hasAnyRoleScope(req, 'MANAGER')) return 'MANAGER';
  if (hasAnyRoleScope(req, 'USER')) return 'USER';
  return null;
}


function resolveMockUserFromBasicAuth(req) {
  // Active en mode mocked (hybrid dev) OU si USE_MOCK_AUTH est forcé (legacy)
  const isMockedMode = (cds.env.requires?.auth?.kind === 'mocked') || (process.env.USE_MOCK_AUTH === 'true');
  if (req.user?.id || !isMockedMode) return;

  const header = req.headers.authorization || '';
  if (!header.toLowerCase().startsWith('basic ')) return;

  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex === -1) return;

    const username = decoded.slice(0, separatorIndex);
    const password = decoded.slice(separatorIndex + 1);
    const mockedUsers = cds.env.requires?.auth?.users || {};
    const mockUser = mockedUsers[username];

    if (!mockUser || mockUser.password !== password) return;

    const rawRoles = mockUser.roles || [];
    const roles = Array.isArray(rawRoles) ? rawRoles : Object.keys(rawRoles);
    const roleSet = new Set([...roles, 'authenticated-user']);

    const attrs = mockUser.attributes || {};

    req.user = {
      id: attrs.username || username,
      attr: attrs,
      roles,
      is: (role) => roleSet.has(role),
    };
  } catch (err) {
    LOG.warn(`Impossible de résoudre Basic Auth mock : ${err.message}`);
  }
}

function resolveXsuaaUserFromBearerToken(req) {
  // Ne pas traiter les tokens Bearer en mode mocked — ils viennent d'un ancien login XSUAA
  const isMockedMode = (cds.env.requires?.auth?.kind === 'mocked') || (process.env.USE_MOCK_AUTH === 'true');
  if (isMockedMode) return;

  const header = req.headers.authorization
    || req.headers['x-approuter-authorization']
    || req.headers['x-forwarded-authorization']
    || '';
  if (!header.toLowerCase().startsWith('bearer ')) return;

  const token = header.slice(7).trim();
  const payload = decodeJwtPayload(token);
  if (!payload || !Object.keys(payload).length) return;

  const identity = getIdentityFromPayload(payload);
  const scopes = identity.scopes;
  const existingUser = req.user || {};
  const existingAttr = existingUser.attr || {};
  const existingIs = typeof existingUser.is === 'function'
    ? existingUser.is.bind(existingUser)
    : null;

  const mergedScopes = [...new Set([
    ...normalizeArray(existingUser.scopes),
    ...normalizeArray(existingUser.scope),
    ...normalizeArray(existingAttr.scopes),
    ...normalizeArray(existingAttr.scope),
    ...scopes,
  ])];

  req.user = {
    ...existingUser,
    id: existingUser.id || identity.username,
    attr: {
      ...existingAttr,
      username: existingAttr.username || identity.username,
      email: existingAttr.email || identity.email,
      name: existingAttr.name || identity.name,
      displayName: existingAttr.displayName || identity.displayName,
      given_name: existingAttr.given_name || identity.given_name,
      family_name: existingAttr.family_name || identity.family_name,
      sub: existingAttr.sub || identity.sub,
      user_id: existingAttr.user_id || identity.user_id,
    },
    scopes: mergedScopes,
    scope: mergedScopes,
    jwt: payload,
    is: (scope) => (existingIs && existingIs(scope))
      || mergedScopes.some((candidate) => scopeMatches(candidate, scope)),
  };
}

/**
 * Middleware Express : vérifie que l'utilisateur possède au moins le rôle requis.
 * Grâce à l'héritage, un ADMIN accède aux routes MANAGER et USER.
 * Renvoie HTTP 401 si non authentifié, 403 si rôle insuffisant.
 */
function requireRole(...requiredRoles) {
  return (req, res, next) => {
    resolveMockUserFromBasicAuth(req);
    resolveXsuaaUserFromBearerToken(req);

    const userRole = getUserRole(req);

    // Non authentifié
    if (!userRole) {
      // En mode development (CSV fallback actif), on utilise un utilisateur par defaut
      // pour permettre l'affichage des donnees meme si l'AppRouter ne forwarde pas le JWT.
      if (csvFallbackEnabled()) {
        LOG.warn(`AUTH_FALLBACK (requireRole): utilisation utilisateur par defaut pour chemin=${req.path}`);
        req.user = {
          id: 'dev-user',
          attr: { username: 'dev-user', email: 'dev@yaas.ma' },
          roles: ['ADMIN', 'MANAGER', 'USER'],
          scopes: ['ADMIN', 'MANAGER', 'USER', 'orders.read', 'orders.write', 'analytics.read', 'dashboard.read',
            'admin.users', 'admin.roles', 'admin.logs', 'admin.sync', 'admin.ml'],
          is: () => true,
        };
        req.userRole = 'ADMIN';
        return next();
      }

      auditLog('ACCESS_DENIED', {
        reason: 'NOT_AUTHENTICATED',
        path: req.path,
        method: req.method,
        ip: req.ip,
      });

      return res.status(401).json({
        error: 'Non authentifié',
        message: 'Vous devez être connecté pour accéder à cette ressource.',
      });
    }

    // Vérifier l'héritage : le rôle de l'utilisateur doit être ≥ au rôle minimum requis
    const userLevel = ROLE_HIERARCHY[userRole] || 0;
    const hasAccess = requiredRoles.some(
      (role) => userLevel >= (ROLE_HIERARCHY[role] || 0)
    );

    if (!hasAccess) {
      auditLog('ACCESS_DENIED', {
        reason: 'INSUFFICIENT_ROLE',
        user: req.user.id,
        role: userRole,
        required: requiredRoles,
        path: req.path,
        method: req.method,
        ip: req.ip,
      });

      return res.status(403).json({
        error: 'Accès interdit',
        message: `Rôle requis : ${requiredRoles.join(' ou ')}. Votre rôle : ${userRole}.`,
        requiredRoles,
        currentRole: userRole,
      });
    }

    // Log des accès autorisés (optionnel, peut être verbeux)
    if (process.env.AUDIT_LOG_SUCCESS === 'true') {
      auditLog('ACCESS_GRANTED', {
        user: req.user.id,
        role: userRole,
        path: req.path,
        method: req.method,
      });
    }

    // Injecter le rôle résolu dans la requête pour usage ultérieur
    req.userRole = userRole;
    next();
  };
}

function requireAuthenticated(req, res, next) {
  resolveMockUserFromBasicAuth(req);
  resolveXsuaaUserFromBearerToken(req);

  if (!req.user?.id) {
    // Diagnostics pour identifier la cause racine du 503
    const authHeader = req.headers.authorization
      ? `${req.headers.authorization.slice(0, 30)}... (${req.headers.authorization.length} chars)`
      : 'ABSENT';
    const appRouterAuth = req.headers['x-approuter-authorization']
      ? `present (${req.headers['x-approuter-authorization'].length} chars)`
      : 'absent';
    const fwdAuth = req.headers['x-forwarded-authorization']
      ? `present (${req.headers['x-forwarded-authorization'].length} chars)`
      : 'absent';

    LOG.warn(`AUTH_FAIL path=${req.path} method=${req.method} Authorization=${authHeader} x-approuter-auth=${appRouterAuth} x-fwd-auth=${fwdAuth}`);

    // En mode development (CSV fallback actif), on utilise un utilisateur par defaut
    // pour permettre l'affichage des donnees meme si l'AppRouter ne forwarde pas le JWT.
    // Ceci est intentionnel pour le developpement hybride BAS.
    // La variable SMARTORDER_ALLOW_UNAUTH_CSV n'est plus requise — le CSV fallback
    // implique deja le mode dev et le contournement d'auth est automatique.
    if (csvFallbackEnabled()) {
      LOG.warn(`AUTH_FALLBACK: utilisation utilisateur par defaut pour chemin=${req.path}`);
      req.user = {
        id: 'dev-user',
        attr: { username: 'dev-user', email: 'dev@yaas.ma' },
        roles: ['ADMIN', 'MANAGER', 'USER'],
        scopes: ['ADMIN', 'MANAGER', 'USER', 'orders.read', 'orders.write', 'analytics.read', 'dashboard.read',
          'admin.users', 'admin.roles', 'admin.logs', 'admin.sync', 'admin.ml'],
        is: () => true,
      };
      req.userRole = 'ADMIN';
      return next();
    }

    auditLog('ACCESS_DENIED', {
      reason: 'NOT_AUTHENTICATED',
      path: req.path,
      method: req.method,
      ip: req.ip,
    });

    return res.status(401).json({
      error: 'Non authentifié',
      message: 'Vous devez être connecté pour accéder à cette ressource.',
    });
  }

  req.userRole = getUserRole(req) || 'USER';
  next();
}

// ---------------------------------------------------------------------------
// Serveur CAP étendu
// ---------------------------------------------------------------------------
module.exports = async (options) => {
  if (!process.env.VCAP_APPLICATION) {
    // Utiliser 0.0.0.0 par défaut pour être joignable via 127.0.0.1 et ::1 (IPv6)
    // indispensable pour le fonctionnement avec AppRouter et proxy CRA en BAS.
    options.host = process.env.HOST || '0.0.0.0';
  }
  configurePostgresRuntime();

  // -----------------------------------------------------------------------
  // IMPORTANT: Définir les routes publiques AVANT cds.server()
  // pour éviter que le middleware d'authentification CAP ne les intercepte
  // -----------------------------------------------------------------------
  cds.on('bootstrap', (app) => {
    app.use((req, res, next) => {
      const origin = req.headers.origin;
      const configuredOrigins = String(process.env.SMARTORDER_CORS_ORIGINS || '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
      const isBasOrigin = typeof origin === 'string'
        && /^https:\/\/port\d+-[^/]+\.applicationstudio\.cloud\.sap$/i.test(origin);
      const isLocalDev = false; // Désactivé - tout doit passer par l'approuter
      if (origin && !isBasOrigin && !isLocalDev) {
        LOG.debug(`CORS no-match origin=${origin} path=${req.path} method=${req.method}`);
      }

      if (origin && (isBasOrigin || configuredOrigins.includes(origin))) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,X-Requested-With,Accept,Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
      }

      if (req.method === 'OPTIONS') return res.sendStatus(204);
      return next();
    });

    // Request logging middleware — trace ALL requests and their status
    app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - start;
        const authHeader = req.headers.authorization
          ? `${req.headers.authorization.slice(0, 20)}...`
          : 'none';
        const userInfo = req.user?.id ? req.user.id : (req.user ? 'set-but-no-id' : 'not-set');
        LOG.log(`REQUEST ${req.method} ${req.originalUrl} → ${res.statusCode} (${duration}ms) auth=${authHeader} user=${userInfo}`);
      });
      next();
    });

    // Parse JSON body
    app.use(require('express').json());

    // -----------------------------------------------------------------------
    // Garantir que l'utilisateur "dev-user" est présent dans la config auth
    // mockée de CAP, même hors profil [development] (ex: NODE_ENV=production
    // + --profile hybrid). Cet utilisateur est utilisé pour injecter un
    // header Authorization: Basic sur les routes OData v4 lorsque le CSV
    // fallback est actif, ce qui permet au basic-auth CAP de valider les
    // identifiants via Passport (req.login / req.isAuthenticated) et de
    // positionner correctement le CDS req.user.id = "dev-user" pour les
    // handlers CAP (profil, rôles, etc.).
    // -----------------------------------------------------------------------
    if (cds.env?.requires?.auth?.users && !cds.env.requires.auth.users['dev-user']) {
      cds.env.requires.auth.users['dev-user'] = {
        password: 'dev-pass',
        roles: ['ADMIN', 'MANAGER', 'USER', 'authenticated-user',
          'orders.read', 'orders.write', 'analytics.read',
          'dashboard.read', 'predictions.view', 'export.csv',
          'admin.users', 'admin.roles', 'admin.logs', 'admin.sync', 'admin.ml'],
        attributes: { username: 'dev-user', email: 'dev@yaas.ma' },
      };
      LOG.info('Utilisateur "dev-user" ajouté à la config auth CAP');
    }

    // -----------------------------------------------------------------------
    // Middleware d'authentification pour TOUTES les routes OData v4.
    // Exécute requireAuthenticated (résout le user depuis Bearer/JWT ou via
    // le fallback CSV dev-user), puis injecte un header Authorization: Basic
    // pour que le basic-auth de CAP (kind=mocked) valide les identifiants et
    // finalise l'authentification Passport (req.login / req.isAuthenticated).
    // Sans cela, les routes OData CAP sur des entités spécifiques
    // (ex: /odata/v4/orders/Orders(id)) retournent 401 car le basic-auth CAP
    // ne trouve ni header Basic ni req.isAuthenticated() à true.
    // -----------------------------------------------------------------------
    app.use('/odata/v4/', (req, res, next) => {
      requireAuthenticated(req, res, () => {
        if (cds.env?.requires?.auth?.kind === 'mocked' && csvFallbackEnabled() && req.user?.id && !req.headers.authorization) {
          req.headers.authorization = 'Basic ' + Buffer.from('dev-user:dev-pass').toString('base64');
        }
        next();
      });
    });

    // -----------------------------------------------------------------------
    // Routes publiques (AVANT l'authentification CAP)
    // -----------------------------------------------------------------------

    // Auth mode — utilisé par le frontend pour afficher le bon login
    app.get('/api/auth/mode', (req, res) => {
      res.json({ mode: process.env.USE_MOCK_AUTH === 'true' ? 'mock' : 'xsuaa' });
    });

    // Health check custom (public)
    app.get('/api/health', (req, res) => {
      const csvErrors = getCsvReadErrors();
      const hasCsvErrors = Object.keys(csvErrors).length > 0;
      res.json({
        status: 'ok',
        service: 'smartorder-backend',
        timestamp: new Date().toISOString(),
        env: process.env.NODE_ENV || 'development',
        database: {
          kind: cds.env.requires?.db?.kind || 'unknown',
          ready: postgresReady,
          schemaReady: postgresSchemaReady,
          schemaError: postgresSchemaError,
          csvFallback: csvFallbackEnabled(),
          csvErrors: hasCsvErrors ? csvErrors : undefined,
        },
      });
    });

    app.get('/api/orders/list', requireAuthenticated, async (req, res) => {
      const { top, skip } = parseODataTopSkip(req.query, { top: 20, maxTop: 500 });
      const filter = String(req.query.filter || req.query.$filter || '');
      const statusMatch = filter.match(/statut\s+eq\s+'([^']+)'/i);
      const sendCsvOrders = (reason) => {
        try {
          const fallback = readOrdersFallback({
            top,
            skip,
            filterStatus: statusMatch?.[1] || null,
          });
          res.set('x-smartorder-data-source', 'csv-fallback');
          if (reason) res.set('x-smartorder-fallback-reason', String(reason).slice(0, 180));
          return res.json({
            items: fallback.value || [],
            count: fallback['@odata.count'] || 0,
            top,
            skip,
          });
        } catch (fallbackErr) {
          LOG.error(`Erreur /api/orders/list fallback CSV : ${fallbackErr?.message || fallbackErr}`);
          return res.status(500).json({
            error: 'Commandes indisponibles',
            message: 'Fallback CSV indisponible. Verifiez les fichiers db/data/smartorder-*.csv.',
          });
        }
      };
      const query = {
        ...req.query,
        $top: top,
        $skip: skip,
        $orderby: req.query.orderby || req.query.$orderby || 'date_creation desc',
        $filter: filter,
      };

      try {
        if (shouldTryPostgresRead()) {
          const result = await withReadTimeout(
            readOrdersDirectFromPostgres(query),
            '/api/orders/list PostgreSQL read'
          );
          res.set('x-smartorder-data-source', 'postgres-direct');
          return res.json({
            items: result.value || [],
            count: result['@odata.count'] || 0,
            top,
            skip,
          });
        }
      } catch (err) {
        LOG.error(`Erreur /api/orders/list PostgreSQL : code=${err?.code || '-'} message=${err?.message || err}`);
        if (err?.code === 'SMARTORDER_READ_TIMEOUT' || isTransientPostgresDisconnect(err) || isRecoverableDbError(err)) {
          markPostgresUnhealthy(err);
        }
        LOG.warn('PostgreSQL recovery will be handled by CDS pool reconnection');
        return sendCsvOrders(err?.message || 'postgres-error');
      }

      return sendCsvOrders(postgresSchemaError || 'postgres-pending');
    });

    app.get('/odata/v4/orders/Orders', requireAuthenticated, async (req, res, next) => {
      const useDirectPostgresRead = shouldTryPostgresRead()
        && process.env.SMARTORDER_DIRECT_ORDERS_READ !== 'false';

      if (!shouldUseCsvReadFallback() && !useDirectPostgresRead) return next();

      const { top, skip } = parseODataTopSkip(req.query, { top: 20, maxTop: 500 });
      const filter = String(req.query.$filter || '');
      const statusMatch = filter.match(/statut\s+eq\s+'([^']+)'/i);
      const sendCsvOrders = (reason) => {
        try {
          const result = readOrdersFallback({
            top,
            skip,
            filterStatus: statusMatch?.[1] || null,
          });
          res.set('x-smartorder-data-source', 'csv-fallback');
          if (reason) res.set('x-smartorder-fallback-reason', String(reason).slice(0, 120));
          return res.json(result);
        } catch (fallbackErr) {
          LOG.error(`Erreur READ Orders fallback CSV : ${fallbackErr?.message || fallbackErr}`);
          return res.status(500).json({
            error: 'Erreur lecture commandes',
            message: 'Fallback CSV indisponible. Verifiez les fichiers db/data/smartorder-*.csv.',
          });
        }
      };

      if (!useDirectPostgresRead || shouldUseCsvReadFallback()) {
        return sendCsvOrders(postgresSchemaError || 'postgres-pending');
      }

      try {
        const result = await withReadTimeout(
          readOrdersDirectFromPostgres(req.query),
          '/odata/v4/orders/Orders PostgreSQL read'
        );
        res.set('x-smartorder-data-source', 'postgres-direct');
        return res.json(result);
      } catch (err) {
        LOG.error(`Erreur READ Orders direct PostgreSQL : code=${err?.code || '-'} status=${err?.statusCode || err?.status || '-'} message=${err?.message || err}`);

        if (csvFallbackEnabled()) {
          if (err?.code === 'SMARTORDER_READ_TIMEOUT' || isTransientPostgresDisconnect(err) || isRecoverableDbError(err)) {
            markPostgresUnhealthy(err);
          }
          LOG.warn('PostgreSQL recovery will be handled by CDS pool reconnection');
          return sendCsvOrders(err?.code || err?.message || 'postgres-error');
        }

        return sendCsvOrders(err?.code || err?.message || 'postgres-error');
      }
    });

    app.get('/api/suppliers', requireAuthenticated, async (req, res) => {
      const top = Math.min(Math.max(Number(req.query.top || 200), 1), 500);
      const skip = Math.max(Number(req.query.skip || 0), 0);
      const sendCsvSuppliers = (reason) => {
        try {
          const result = readSuppliersFallback({
            top,
            skip,
            search: req.query.search || req.query.q,
          });
          res.set('x-smartorder-data-source', 'csv-fallback');
          if (reason) res.set('x-smartorder-fallback-reason', String(reason).slice(0, 180));
          return res.json(result);
        } catch (fallbackErr) {
          LOG.error(`Erreur /api/suppliers fallback CSV : ${fallbackErr?.message || fallbackErr}`);
          return res.status(500).json({
            error: 'Fournisseurs indisponibles',
            message: 'Fallback CSV indisponible. Verifiez db/data/smartorder-Fournisseurs.csv.',
          });
        }
      };

      if (!shouldTryPostgresRead()) {
        return sendCsvSuppliers(postgresSchemaError || 'postgres-pending');
      }

      try {
        const result = await withReadTimeout(
          readSuppliersDirectFromPostgres(req.query),
          '/api/suppliers PostgreSQL read'
        );
        res.set('x-smartorder-data-source', 'postgres-direct');
        return res.json(result);
      } catch (err) {
        LOG.error(`Erreur /api/suppliers PostgreSQL : code=${err?.code || '-'} message=${err?.message || err}`);
        if (csvFallbackEnabled()) {
          if (err?.code === 'SMARTORDER_READ_TIMEOUT' || isTransientPostgresDisconnect(err) || isRecoverableDbError(err)) {
            markPostgresUnhealthy(err);
          }
          LOG.warn('PostgreSQL recovery will be handled by CDS pool reconnection');
          return sendCsvSuppliers(err?.message || 'postgres-error');
        }
        return res.status(503).json({ error: 'Erreur chargement fournisseurs' });
      }
    });

    app.get('/api/profile', requireAuthenticated, async (req, res) => {
      const sendFallbackProfile = (reason) => {
        const profile = buildProfileFallback(req);
        if (!profile) {
          const identity = getIdentityFromUser(req.user);
          return res.json({
            id: req.user?.id || identity.email || identity.username || 'dev-user',
            username: identity.username || req.user?.id || 'dev-user',
            email: identity.email || `${req.user?.id || 'dev-user'}@yaas.ma`,
            role: req.userRole || 'USER',
            prenom: identity.given_name || '',
            nom: identity.family_name || '',
            displayName: identity.displayName || identity.name || req.user?.id || 'dev-user',
            identitySource: 'auth-fallback-minimal',
          });
        }

        res.set('x-smartorder-data-source', 'csv-fallback');
        if (reason) res.set('x-smartorder-fallback-reason', String(reason).slice(0, 180));
        return res.json(profile);
      };

      if (!shouldTryPostgresRead()) {
        return sendFallbackProfile(postgresSchemaError || 'postgres-pending');
      }

      try {
        const profile = await withReadTimeout(
          readProfileDirectFromPostgres(req),
          '/api/profile PostgreSQL read'
        );
        if (!profile) return sendFallbackProfile('profile-not-found');
        res.set('x-smartorder-data-source', 'postgres-direct');
        return res.json(profile);
      } catch (err) {
        LOG.error(`Erreur /api/profile PostgreSQL : code=${err?.code || '-'} message=${err?.message || err}`);
        if (csvFallbackEnabled()) {
          // N'invalider le pool que pour des erreurs de connexion réelles
          if (err?.code === 'SMARTORDER_READ_TIMEOUT' || isTransientPostgresDisconnect(err) || isRecoverableDbError(err)) {
            markPostgresUnhealthy(err);
          }
          LOG.warn('PostgreSQL recovery will be handled by CDS pool reconnection');
          return sendFallbackProfile(err?.message || 'postgres-error');
        }
        return res.status(503).json({ error: 'Erreur chargement profil' });
      }
    });

    app.patch(['/api/profile', '/api/profile/preferences'], requireAuthenticated, (req, res, next) => {
      if (!shouldUseCsvReadFallback()) return next();
      return res.status(503).json({
        error: 'Base de donnees indisponible',
        message: 'Neon PostgreSQL est en cours de reveil. Les modifications seront disponibles des que la connexion sera retablie.',
      });
    });

    // Route /api/admin/users supprimée — gérée par srv/routes/admin/users.js

    app.get('/api/alerts', requireRole('MANAGER'), async (req, res) => {
      const top = Math.min(Math.max(Number(req.query.top || req.query.$top || 20), 1), 100);
      const sendCsvAlerts = (reason) => {
        try {
          const result = readAlertsFallback({ top });
          res.set('x-smartorder-data-source', 'csv-fallback');
          if (reason) res.set('x-smartorder-fallback-reason', String(reason).slice(0, 180));
          return res.json(result);
        } catch (fallbackErr) {
          LOG.error(`Erreur /api/alerts fallback CSV : ${fallbackErr?.message || fallbackErr}`);
          return res.status(500).json({
            error: 'Alertes indisponibles',
            message: 'Fallback CSV indisponible. Verifiez db/data/smartorder-Alertes.csv.',
          });
        }
      };

      if (!shouldTryPostgresRead()) {
        return sendCsvAlerts(postgresSchemaError || 'postgres-pending');
      }

      try {
        const rows = await withReadTimeout(queryPostgresOneShot(`
          SELECT a.id, a.type, a.severite, a.message, a.lu, a.acquitte,
                 a.date_creation, a.date_acquittement, a.commande_id,
                 o.numero_sap AS commande_numero_sap
          FROM smartorder_alertes a
          LEFT JOIN smartorder_orders o ON o.id = a.commande_id
          ORDER BY a.date_creation DESC NULLS LAST
          LIMIT ${sqlParam(1)}
        `, [top]), '/api/alerts PostgreSQL read');

        res.set('x-smartorder-data-source', 'postgres-direct');
        return res.json({ value: rows.map(mapAlertDirectRow) });
      } catch (err) {
        LOG.error(`Erreur /api/alerts PostgreSQL : code=${err?.code || '-'} message=${err?.message || err}`);
        if (csvFallbackEnabled()) {
          if (err?.code === 'SMARTORDER_READ_TIMEOUT' || isTransientPostgresDisconnect(err) || isRecoverableDbError(err)) {
            markPostgresUnhealthy(err);
          }
          LOG.warn('PostgreSQL recovery will be handled by CDS pool reconnection');
          return sendCsvAlerts(err?.message || 'postgres-error');
        }
        return res.status(503).json({ error: 'Erreur chargement alertes' });
      }
    });

    app.post('/api/alerts/:id/ack', requireRole('MANAGER'), async (req, res) => {
      if (shouldUseCsvReadFallback()) {
        return res.status(503).json({
          error: 'Base de donnees indisponible',
          message: 'Neon PostgreSQL est en cours de reveil. Impossible de modifier une alerte pour le moment.',
        });
      }

      try {
        const id = decodeURIComponent(req.params.id || '');
        const rows = await withReadTimeout(queryPostgresOneShot(`
          UPDATE smartorder_alertes
          SET acquitte = TRUE, date_acquittement = ${sqlParam(1)}
          WHERE id = ${sqlParam(2)}
          RETURNING id, type, severite, message, lu, acquitte, date_creation, date_acquittement, commande_id
        `, [new Date().toISOString(), id]), '/api/alerts ack PostgreSQL write');

        if (!rows[0]) return res.status(404).json({ error: 'Alerte introuvable' });
        return res.json(mapAlertDirectRow(rows[0]));
      } catch (err) {
        LOG.error(`Erreur /api/alerts/${req.params.id}/ack PostgreSQL : code=${err?.code || '-'} message=${err?.message || err}`);
        if (isRecoverableDbError(err)) {
          markPostgresUnhealthy(err);
          LOG.warn('PostgreSQL recovery will be handled by CDS pool reconnection');
        }
        return res.status(503).json({ error: 'Erreur acquittement alerte' });
      }
    });

    // Dev/hybrid fallback pour les notifications : CAP OData refuse les
    // Alertes si le JWT XSUAA ne contient pas encore les scopes BTP reels.
    // Cette route reste protegee par le role effectif SmartOrder.
    app.get('/odata/v4/orders/Alertes', requireRole('MANAGER'), async (req, res) => {
      try {
        if (!shouldTryPostgresRead()) {
          const top = Math.min(Math.max(Number(req.query.$top || 20), 1), 100);
          res.set('x-smartorder-data-source', 'csv-fallback');
          return res.json(readAlertsFallback({ top }));
        }

        const top = Math.min(Math.max(Number(req.query.$top || 20), 1), 100);
        const rows = await withReadTimeout(queryPostgresOneShot(`
          SELECT a.id, a.type, a.severite, a.message, a.lu, a.acquitte,
                 a.date_creation, a.date_acquittement, a.commande_id,
                 o.numero_sap AS commande_numero_sap
          FROM smartorder_alertes a
          LEFT JOIN smartorder_orders o ON o.id = a.commande_id
          ORDER BY a.date_creation DESC NULLS LAST
          LIMIT ${sqlParam(1)}
        `, [top]), '/odata/v4/orders/Alertes PostgreSQL read');

        res.set('x-smartorder-data-source', 'postgres-direct');
        res.json({ value: rows.map(mapAlertDirectRow) });
      } catch (err) {
        LOG.error(`Erreur fallback Alertes : ${err.message}`);
        if (csvFallbackEnabled()) {
          if (err?.code === 'SMARTORDER_READ_TIMEOUT' || isTransientPostgresDisconnect(err) || isRecoverableDbError(err)) {
            markPostgresUnhealthy(err);
          }
          LOG.warn('PostgreSQL recovery will be handled by CDS pool reconnection');
          const top = Math.min(Math.max(Number(req.query.$top || 20), 1), 100);
          res.set('x-smartorder-data-source', 'csv-fallback');
          return res.json(readAlertsFallback({ top }));
        }
        res.status(500).json({ error: 'Erreur chargement alertes' });
      }
    });

    app.post(/^\/odata\/v4\/orders\/Alertes\(([^)]+)\)\/OrdersService\.acquitter$/, requireRole('MANAGER'), async (req, res) => {
      try {
        if (shouldUseCsvReadFallback()) {
          return res.status(503).json({
            error: 'Base de donnees indisponible',
            message: 'Neon PostgreSQL est en cours de reveil. Impossible de modifier une alerte pour le moment.',
          });
        }

        const rawId = decodeURIComponent(req.params[0] || '')
          .replace(/^ID=/, '')
          .replace(/^guid'/, '')
          .replace(/^'/, '')
          .replace(/'$/, '');
        const rows = await withReadTimeout(queryPostgresOneShot(`
          UPDATE smartorder_alertes
          SET acquitte = TRUE, date_acquittement = ${sqlParam(1)}
          WHERE id = ${sqlParam(2)}
          RETURNING id, type, severite, message, lu, acquitte, date_creation, date_acquittement, commande_id
        `, [new Date().toISOString(), rawId]), '/odata/v4/orders/Alertes ack PostgreSQL write');
        if (!rows[0]) return res.status(404).json({ error: 'Alerte introuvable' });
        res.json(mapAlertDirectRow(rows[0]));
      } catch (err) {
        LOG.error(`Erreur acquittement fallback Alertes : ${err.message}`);
        if (isRecoverableDbError(err)) {
          markPostgresUnhealthy(err);
          LOG.warn('PostgreSQL recovery will be handled by CDS pool reconnection');
        }
        res.status(503).json({ error: 'Erreur acquittement alerte' });
      }
    });

    app.get('/odata/v4/admin/HistoriqueStatut', requireRole('ADMIN'), async (req, res) => {
      try {
        if (shouldUseCsvReadFallback()) {
          const top = Math.min(Math.max(Number(req.query.$top || 100), 1), 500);
          res.set('x-smartorder-data-source', 'csv-fallback');
          return res.json(readHistoryFallback({ top }));
        }

        const db = await cds.connect.to('db');
        const top = Math.min(Math.max(Number(req.query.$top || 100), 1), 500);
        const rows = await db.run(`
          SELECT hs.ID, hs.commande_ID, hs.user_ID, hs.ancien_statut,
                 hs.nouveau_statut, hs.commentaire, hs.source_changement,
                 hs.createdAt, u.username AS user_username, u.email AS user_email,
                 o.numero_sap AS commande_numero_sap
          FROM smartorder_HistoriqueStatut hs
          LEFT JOIN smartorder_Utilisateurs u ON u.ID = hs.user_ID
          LEFT JOIN smartorder_Orders o ON o.ID = hs.commande_ID
          ORDER BY hs.createdAt DESC
          LIMIT ${sqlParam(1)}
        `, [top]);

        res.json({
          value: rows.map((row) => ({
            ID: row.ID,
            commande_ID: row.commande_ID,
            user_ID: row.user_ID,
            ancien_statut: row.ancien_statut,
            nouveau_statut: row.nouveau_statut,
            commentaire: row.commentaire,
            source_changement: row.source_changement,
            createdAt: row.createdAt,
            user: row.user_ID ? {
              ID: row.user_ID,
              username: row.user_username,
              email: row.user_email,
            } : null,
            commande: row.commande_ID ? {
              ID: row.commande_ID,
              numero_sap: row.commande_numero_sap,
            } : null,
          })),
        });
      } catch (err) {
        LOG.error(`Erreur fallback HistoriqueStatut : ${err.message}`);
        if (csvFallbackEnabled()) {
          const top = Math.min(Math.max(Number(req.query.$top || 100), 1), 500);
          res.set('x-smartorder-data-source', 'csv-fallback');
          if (err?.message) res.set('x-smartorder-fallback-reason', String(err.message).slice(0, 180));
          return res.json(readHistoryFallback({ top }));
        }
        res.status(500).json({ error: 'Erreur chargement historique' });
      }
    });

    app.get('/odata/v4/admin/SyncJobs', requireRole('ADMIN'), async (req, res) => {
      try {
        if (shouldUseCsvReadFallback()) {
          const top = Math.min(Math.max(Number(req.query.$top || 20), 1), 100);
          res.set('x-smartorder-data-source', 'csv-fallback');
          return res.json(readSyncJobsFallback({ top }));
        }

        const db = await cds.connect.to('db');
        const top = Math.min(Math.max(Number(req.query.$top || 20), 1), 100);
        const rows = await db.run(`
          SELECT ID, mode, statut, commandes_creees, commandes_maj, erreurs,
                 depuis, started_at, ended_at, error_message, createdAt
          FROM smartorder_SyncJobs
          ORDER BY COALESCE(started_at, createdAt) DESC
          LIMIT ${sqlParam(1)}
        `, [top]);
        res.json({ value: rows });
      } catch (err) {
        LOG.error(`Erreur fallback SyncJobs : ${err.message}`);
        if (csvFallbackEnabled()) {
          const top = Math.min(Math.max(Number(req.query.$top || 20), 1), 100);
          res.set('x-smartorder-data-source', 'csv-fallback');
          if (err?.message) res.set('x-smartorder-fallback-reason', String(err.message).slice(0, 180));
          return res.json(readSyncJobsFallback({ top }));
        }
        res.status(500).json({ error: 'Erreur chargement jobs' });
      }
    });

    app.get('/odata/v4/admin/MlModels', requireRole('ADMIN'), async (req, res) => {
      try {
        if (shouldUseCsvReadFallback()) {
          res.set('x-smartorder-data-source', 'csv-fallback');
          return res.json(readMlModelsFallback());
        }

        const db = await cds.connect.to('db');
        const rows = await db.run(`
          SELECT ID, type, version, accuracy, f1_score, mae, r2,
                 dataset_size, trained_at, actif
          FROM smartorder_MlModels
          ORDER BY trained_at DESC
        `);
        res.json({
          value: rows.map((row) => ({
            ...row,
            actif: row.actif === true || row.actif === 1,
          })),
        });
      } catch (err) {
        LOG.error(`Erreur fallback MlModels : ${err.message}`);
        if (csvFallbackEnabled()) {
          res.set('x-smartorder-data-source', 'csv-fallback');
          if (err?.message) res.set('x-smartorder-fallback-reason', String(err.message).slice(0, 180));
          return res.json(readMlModelsFallback());
        }
        res.status(500).json({ error: 'Erreur chargement modeles ML' });
      }
    });

    // Status endpoint (public) — Pour les vérifications de santé
    app.get('/status', (req, res) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
      });
    });
  });

  // Démarrer le serveur CAP standard et récupérer le serveur HTTP
  const server = await cds.server(options);

  // Récupérer l'app Express depuis CAP
  const app = cds.app;
  void warmupDatabase().catch((err) => {
    LOG.warn(`PostgreSQL warm-up erreur non bloquante : ${err.message}`);
  });

  // -----------------------------------------------------------------------
  // 1. POST /api/login — Authentification
  //    auth.kind=mocked → Mock auth (dev local sans XSUAA, Basic auth)
  //    auth.kind=xsuaa  → XSUAA réel via password grant (ROPC)
  // -----------------------------------------------------------------------
  const authKind = cds.env.requires?.auth?.kind || 'mocked';
  const useMockLogin = authKind === 'mocked' || process.env.USE_MOCK_AUTH === 'true';

  if (useMockLogin) {
    app.post('/api/login', (req, res) => {
      const { username, password } = req.body || {};

      if (!username || !password) {
        return res.status(400).json({ error: 'Username et password requis' });
      }

      const mockedUsers = cds.env.requires?.auth?.users || {};
      const mockUser = mockedUsers[username];

      if (!mockUser || mockUser.password !== password) {
        LOG.warn(`Login échoué pour user=${username}`);
        return res.status(401).json({ error: 'Identifiants incorrects' });
      }

      const attrs = mockUser.attributes || {};
      const rawRoles = mockUser.roles || [];
      const roles = Array.isArray(rawRoles) ? rawRoles : Object.keys(rawRoles);
      let role = 'USER';
      if (roles.includes('ADMIN')) role = 'ADMIN';
      else if (roles.includes('MANAGER')) role = 'MANAGER';

      LOG.info(`Login réussi : user=${username} role=${role}`);

      return res.json({
        id: username,
        username: attrs.username || username,
        email: attrs.email || `${username}@yaas.ma`,
        role,
        prenom: attrs.prenom || '',
        nom: attrs.nom || '',
      });
    });
    LOG.info(`Route /api/login (mock auth) montée — auth.kind=${authKind}`);
  } else {
    // -----------------------------------------------------------------------
    // Helper : Construire le redirect_uri dynamiquement depuis la requête.
    //
    // En BAS (SAP Business Application Studio) :
    //   L'AppRouter sur port 5000 peut intercepter le ?code= du callback OAuth.
    //   Pour éviter ça, on redirige vers le port CDS (4004) directement.
    //   BAS expose chaque port via son propre sous-domaine :
    //     port5000-workspaces-ws-xxx.eu10.applicationstudio.cloud.sap
    //     → port4004-workspaces-ws-xxx.eu10.applicationstudio.cloud.sap
    //
    // En localhost :
    //   Pas de risque d'interception → on garde l'host d'origine.
    // -----------------------------------------------------------------------
    const CDS_PORT = process.env.PORT || '4004';
    const OAUTH_CALLBACK_PATH = process.env.SMARTORDER_OAUTH_CALLBACK_PATH || '/api/oauth/callback';
    const USE_DIRECT_BAS_OAUTH_CALLBACK = process.env.SMARTORDER_DIRECT_BAS_OAUTH_CALLBACK === 'true';

    function getOAuthCallbackUri(req) {
      const fwdProto = req.headers['x-forwarded-proto'];
      const fwdHost = req.headers['x-forwarded-host'];

      if (fwdHost) {
        const proto = fwdProto || 'https';
        // BAS : remplacer portXXXX par le port CDS pour bypasser l'AppRouter
        const isBAS = /^port\d+-/.test(fwdHost);
        if (isBAS && USE_DIRECT_BAS_OAUTH_CALLBACK) {
          const directHost = fwdHost.replace(/^port\d+-/, `port${CDS_PORT}-`);
          LOG.info(`OAuth callback BAS direct : ${fwdHost} -> ${directHost}`);
          return `${proto}://${directHost}${OAUTH_CALLBACK_PATH}`;
        }
        if (isBAS) LOG.info(`OAuth callback via AppRouter : ${fwdHost}`);
        return `${proto}://${fwdHost}${OAUTH_CALLBACK_PATH}`;
      }

      // Localhost : utiliser l'origin ou le host de la requête
      const referer = req.headers.referer || req.headers.origin || '';
      const match = referer.match(/^(https?:\/\/[^/]+)/);
      if (match) return `${match[1]}${OAUTH_CALLBACK_PATH}`;

      const host = req.get('host') || `localhost:${CDS_PORT}`;
      return `${req.protocol}://${host}${OAUTH_CALLBACK_PATH}`;
    }

    async function requestXsuaaToken(xsuaa, params, context) {
      const timeoutMs = Number(process.env.SMARTORDER_XSUAA_TIMEOUT_MS || 20000);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        LOG.info(`XSUAA token request demarree (${context})`);
        const response = await fetch(`${xsuaa.url}/oauth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
          signal: controller.signal,
        });

        const rawBody = await response.text().catch(() => '');
        if (!response.ok) {
          return {
            ok: false,
            status: response.status,
            body: rawBody,
          };
        }

        const data = rawBody ? JSON.parse(rawBody) : {};
        LOG.info(`XSUAA token request OK (${context})`);
        return { ok: true, data };
      } catch (err) {
        if (err?.name === 'AbortError') {
          throw new Error(`Timeout XSUAA /oauth/token apres ${timeoutMs}ms (${context})`);
        }
        throw err;
      } finally {
        clearTimeout(timeout);
      }
    }

    // XSUAA réel : échange username/password → JWT via password grant (ROPC)
    app.post('/api/login', async (req, res) => {
      const { username, password } = req.body || {};

      if (!username || !password) {
        return res.status(400).json({ error: 'Username et password requis' });
      }

      try {
        const xsenv = require('@sap/xsenv');
        const xsuaa = xsenv.getServices({ xsuaa: { tag: 'xsuaa' } }).xsuaa;

        const params = new URLSearchParams({
          grant_type: 'password',
          client_id: xsuaa.clientid,
          client_secret: xsuaa.clientsecret,
          username,
          password,
        });

        const tokenResult = await requestXsuaaToken(xsuaa, params, 'password_grant');

        if (!tokenResult.ok) {
          LOG.warn(`Login XSUAA échoué pour user=${username}: ${tokenResult.body}`);
          return res.status(401).json({ error: 'Identifiants incorrects XSUAA' });
        }

        const tokenData = tokenResult.data;
        const { access_token } = tokenData;

        // Décoder le payload JWT pour extraire les infos utilisateur
        const payload = JSON.parse(
          Buffer.from(access_token.split('.')[1], 'base64').toString('utf-8')
        );

        // Mapper les scopes XSUAA vers les rôles applicatifs
        const scopes = Array.isArray(payload.scope)
          ? payload.scope
          : (typeof payload.scope === 'string' ? payload.scope.split(' ') : []);
        let role = 'USER';
        if (scopes.some(s => s.endsWith('.ADMIN') || s.includes('.ADMIN'))) role = 'ADMIN';
        else if (scopes.some(s => s.endsWith('.MANAGER') || s.includes('.MANAGER'))) role = 'MANAGER';

        // Appliquer le bypass dev admin si configuré
        // (inline — isDevAdminOverride() utilise getIdentityFromUser qui n'est pas importée ici)
        if (role !== 'ADMIN' && process.env.SMARTORDER_ENABLE_DEV_ADMIN === 'true') {
          const devAdmins = (process.env.SMARTORDER_DEV_ADMINS || '')
            .replace(/,/g, ' ').split(/\s+/).filter(Boolean).map(s => s.toLowerCase());
          const userEmail = (payload.email || '').toLowerCase();
          const userName = (payload.user_name || username || '').toLowerCase();
          if (devAdmins.includes(userEmail) || devAdmins.includes(userName)) {
            role = 'ADMIN';
            LOG.info(`Dev admin override appliqué pour user=${payload.user_name || username}`);
          }
        }

        const identity = {
          sub: payload.sub,
          username: payload.user_name || username,
          email: payload.email || '',
          given_name: payload.given_name || '',
          family_name: payload.family_name || '',
        };

        LOG.info(`Login XSUAA réussi : user=${payload.user_name || username} role=${role}`);

        return res.json({
          access_token,
          username: payload.user_name || username,
          email: payload.email || '',
          role,
          prenom: payload.given_name || '',
          nom: payload.family_name || '',
        });
      } catch (err) {
        LOG.error(`Erreur login XSUAA: ${err.message}`);
        return res.status(500).json({ error: 'Erreur serveur lors de l\'authentification XSUAA' });
      }
    });
    LOG.info(`Route /api/login (XSUAA real auth) montée — auth.kind=${authKind}`);

    // -----------------------------------------------------------------------
    // 1b. GET /api/login/authorize — Redirect to XSUAA login (authorization_code)
    // -----------------------------------------------------------------------
    app.get('/api/login/authorize', async (req, res) => {
      try {
        const xsenv = require('@sap/xsenv');
        const xsuaa = xsenv.getServices({ xsuaa: { tag: 'xsuaa' } }).xsuaa;
        const redirectUri = getOAuthCallbackUri(req);
        LOG.info(`OAuth authorize — redirect_uri=${redirectUri}`);
        const authorizeUrl = `${xsuaa.url}/oauth/authorize?` +
          `response_type=code` +
          `&client_id=${encodeURIComponent(xsuaa.clientid)}` +
          `&redirect_uri=${encodeURIComponent(redirectUri)}`;
        res.redirect(authorizeUrl);
      } catch (err) {
        LOG.error(`Erreur authorize: ${err.message}`);
        res.status(500).json({ error: 'Erreur serveur' });
      }
    });

    // -----------------------------------------------------------------------
    // 1c. GET /api/oauth/callback — Handle XSUAA redirect, exchange code for JWT
    //     The previous /api/login/callback path conflicts with the SAP AppRouter
    //     reserved login callback route in some BAS/proxy setups. Keep it as a
    //     compatibility alias only; newly generated redirect_uri values use
    //     OAUTH_CALLBACK_PATH (/api/oauth/callback by default).
    // -----------------------------------------------------------------------
    async function handleOAuthCallback(req, res) {
      const { code, error } = req.query;
      const redirectUri = getOAuthCallbackUri(req);
      const sendOAuthHtml = (html) => {
        res.set('Cache-Control', 'no-store');
        res.set('Content-Type', 'text/html; charset=utf-8');
        // BAS/AppRouter hybrid can reuse a stale local upstream connection just
        // after the OAuth exchange. Closing this response makes the following
        // /api/me validation open a fresh backend connection.
        res.set('Connection', 'close');
        return res.send(html);
      };

      // Déduire l'URL frontend pour les fallbacks (quand popup est bloquée)
      // En BAS : le frontend est accessible via le port 5000 (AppRouter)
      const fwdHost = req.headers['x-forwarded-host'] || '';
      const fwdProto = req.headers['x-forwarded-proto'] || 'https';
      let frontendUrl;
      if (/^port\d+-/.test(fwdHost)) {
        // BAS : pointer vers le port AppRouter (5000) où le frontend est servi
        const uiHost = fwdHost.replace(/^port\d+-/, 'port5000-');
        frontendUrl = `${fwdProto}://${uiHost}`;
      } else if (fwdHost) {
        frontendUrl = `${fwdProto}://${fwdHost}`;
      } else {
        frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5000';
      }

      LOG.info(`OAuth callback reçu — redirect_uri=${redirectUri} frontendUrl=${frontendUrl} code=${code ? 'present' : 'missing'}`);

      if (error) {
        LOG.warn(`XSUAA login refused: ${error}`);
        return sendOAuthHtml(`
<!DOCTYPE html>
<html><body><script>
if (window.opener && !window.opener.closed) {
  window.opener.postMessage({type:'xsuaa-oauth',error:'access_denied'},'*');
  window.close();
} else {
  window.location.href = '${frontendUrl}/login?error=access_denied';
}
<\/script></body></html>
`);
      }

      if (!code) {
        return res.status(400).send('Missing authorization code');
      }

      try {
        const xsenv = require('@sap/xsenv');
        const xsuaa = xsenv.getServices({ xsuaa: { tag: 'xsuaa' } }).xsuaa;

        const params = new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: xsuaa.clientid,
          client_secret: xsuaa.clientsecret,
          code,
          redirect_uri: redirectUri,
        });

        const tokenResult = await requestXsuaaToken(xsuaa, params, 'authorization_code_callback');

        if (!tokenResult.ok) {
          LOG.error(`Erreur échange code XSUAA: status=${tokenResult.status} body=${tokenResult.body}`);
          return sendOAuthHtml(`
<!DOCTYPE html>
<html><body><script>
if (window.opener && !window.opener.closed) {
  window.opener.postMessage({type:'xsuaa-oauth',error:'token_exchange_failed'},'*');
  window.close();
} else {
  window.location.href = '${frontendUrl}/login?error=token_exchange_failed';
}
<\/script></body></html>
`);
        }

        const tokenData = tokenResult.data;
        const { access_token } = tokenData;
        const tokenReq = {
          headers: { authorization: `Bearer ${access_token}` },
          user: null,
        };
        resolveXsuaaUserFromBearerToken(tokenReq);
        const identity = getIdentityFromUser(tokenReq.user);

        const role = getUserRole(tokenReq) || 'USER';
        const scopes = getUserScopes(tokenReq);

        const browserSession = {
          access_token,
          username: identity.username,
          email: identity.email || '',
          displayName: identity.displayName,
          role,
          prenom: identity.given_name || '',
          nom: identity.family_name || '',
          scopes,
          groups: identity.groups,
          roles: identity.roles,
          authType: 'xsuaa',
          validatedAt: Date.now(),
        };

        // Popup OAuth : postMessage vers l'opener, puis fermeture
        // Fallback : ancien flux redirect (nouvel onglet)
        sendOAuthHtml(`
<!DOCTYPE html>
<html><body><script>
(function(){
  var token = ${JSON.stringify(access_token)};
  var session = ${JSON.stringify(browserSession)};
  if (window.opener && !window.opener.closed) {
    window.opener.postMessage({type:'xsuaa-oauth',access_token:token,session:session},'*');
    window.close();
  } else {
    try {
      window.sessionStorage.setItem('smartorder_user', JSON.stringify(session));
      window.location.replace('${frontendUrl}/');
    } catch (e) {
      window.location.href = '${frontendUrl}/oauth/callback#access_token=' + encodeURIComponent(token) + '&session=' + encodeURIComponent(JSON.stringify(session));
    }
  }
})();
<\/script></body></html>
`);
      } catch (err) {
        LOG.error(`Erreur callback XSUAA: ${err.message}`);

        sendOAuthHtml(`
<!DOCTYPE html>
<html><body><script>
if (window.opener && !window.opener.closed) {
  window.opener.postMessage({type:'xsuaa-oauth',error:'server_error'},'*');
  window.close();
} else {
  window.location.href = '${frontendUrl}/login?error=server_error';
}
<\/script></body></html>
`);
      }
    }

    app.get(OAUTH_CALLBACK_PATH, handleOAuthCallback);
    if (OAUTH_CALLBACK_PATH !== '/api/login/callback') {
      app.get('/api/login/callback', handleOAuthCallback);
    }

    // -----------------------------------------------------------------------
    // 1d. POST /api/login/exchange-code — Frontend OAuth callback échange le code
    // -----------------------------------------------------------------------
    app.post('/api/login/exchange-code', async (req, res) => {
      const { code } = req.body;

      if (!code) {
        return res.status(400).json({ error: 'Code manquant' });
      }

      try {
        const xsenv = require('@sap/xsenv');
        const xsuaa = xsenv.getServices({ xsuaa: { tag: 'xsuaa' } }).xsuaa;
        const redirectUri = getOAuthCallbackUri(req);

        const params = new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: xsuaa.clientid,
          client_secret: xsuaa.clientsecret,
          code,
          redirect_uri: redirectUri,
        });

        const tokenResult = await requestXsuaaToken(xsuaa, params, 'authorization_code_exchange_api');

        if (!tokenResult.ok) {
          LOG.error(`Erreur échange code XSUAA: status=${tokenResult.status} body=${tokenResult.body}`);
          return res.status(401).json({ error: 'Échange de code échoué' });
        }

        const tokenData = tokenResult.data;
        const { access_token } = tokenData;
        const tokenReq = {
          headers: { authorization: `Bearer ${access_token}` },
          user: null,
        };
        resolveXsuaaUserFromBearerToken(tokenReq);
        const identity = getIdentityFromUser(tokenReq.user);

        const role = getUserRole(tokenReq) || 'USER';
        const session = {
          access_token,
          username: identity.username,
          email: identity.email || '',
          displayName: identity.displayName,
          role,
          prenom: identity.given_name || '',
          nom: identity.family_name || '',
          scopes: getUserScopes(tokenReq),
          groups: identity.groups,
          roles: identity.roles,
          authType: 'xsuaa',
          validatedAt: Date.now(),
        };
        res.json({ access_token, session });
      } catch (err) {
        LOG.error(`Erreur exchange-code: ${err.message}`);
        res.status(500).json({ error: 'Erreur serveur' });
      }
    });

    LOG.info('Routes XSUAA OAuth (authorize + callback + exchange-code) montées');
  }

  // -----------------------------------------------------------------------
  // 2. GET /api/me — Info utilisateur (production XSUAA + fallback dev)
  // -----------------------------------------------------------------------
  app.get('/api/me', (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      resolveMockUserFromBasicAuth(req);
      resolveXsuaaUserFromBearerToken(req);

      // En production : req.user est rempli par XSUAA
      if (req.user && req.user.id) {
        const role = getUserRole(req);
        const scopes = getUserScopes(req);
        const identity = getIdentityFromUser(req.user);
        const hasNameClaim = Boolean(identity.name);
        const hasSplitNameClaims = Boolean(identity.given_name || identity.family_name);

        LOG.debug(`/api/me OK user=${identity.username || req.user.id} role=${role || 'USER'} auth=${authKind}`);

        return res.json({
          id: req.user.id,
          username: identity.username,
          email: identity.email || `${identity.username}@yaas.ma`,
          displayName: identity.displayName,
          sub: identity.sub,
          user_id: identity.user_id,
          role: role || 'USER',
          prenom: identity.given_name,
          nom: identity.family_name,
          scopes,
          groups: identity.groups,
          roles: identity.roles,
          identitySource: hasNameClaim ? 'jwt.name' : (hasSplitNameClaims ? 'jwt.given_name_family_name' : 'fallback'),
          authType: authKind,
        });
      }
      return res.status(401).json({ error: 'Non authentifié' });
    } catch (err) {
      LOG.error(`Erreur /api/me : ${err?.stack || err?.message || err}`);
      return res.status(500).json({
        error: 'Erreur serveur',
        message: 'Impossible de valider la session utilisateur.',
      });
    }
  });

  app.get('/api/auth/debug', requireAuthenticated, (req, res) => {
    const payload = getTokenPayload(req.user);
    const identity = getIdentityFromUser(req.user);
    const scopes = getUserScopes(req);

    return res.json({
      authType: process.env.USE_MOCK_AUTH === 'true' ? 'mock' : 'xsuaa',
      userId: req.user.id,
      identity,
      claims: sanitizeJwtPayload(payload),
      integrityChecks: {
        hasStableSubject: Boolean(identity.sub || identity.user_id),
        hasDisplayName: Boolean(identity.name || identity.displayName),
        displayNameSource: identity.name
          ? 'jwt.name'
          : ((identity.given_name || identity.family_name) ? 'jwt.given_name_family_name' : 'fallback'),
        hasEmail: Boolean(identity.email),
        hasScopes: scopes.length > 0,
        hasGroups: identity.groups.length > 0,
        hasRolesClaim: identity.roles.length > 0,
      },
      devAdminOverride: {
        active: isDevAdminOverride(req.user),
        configured: getConfiguredDevAdmins(),
        enabled: process.env.SMARTORDER_ENABLE_DEV_ADMIN === 'true',
      },
      roleResolution: buildRoleDiagnostics(scopes, identity.groups, identity.roles),
      guidance: {
        sourceOfTruth: 'XSUAA relaie les claims emis par l Identity Provider; les role collections BTP deviennent visibles dans le JWT principalement via les scopes.',
        missingSmartOrderUser: 'Si SmartOrder_User est vide dans le cockpit ou non assignee a l utilisateur/groupe IdP, les scopes smartorder.USER/orders.read ne seront pas presents dans ce JWT.',
      },
    });
  });
  LOG.info('Routes /api/login (POST) et /api/me (GET) montées');

  // -----------------------------------------------------------------------
  // 3. Socket.io — WebSocket avec auth XSUAA
  // -----------------------------------------------------------------------
  try {
    const { initSocket } = require('./srv/websocket/socketManager');
    const httpServer = app.server || cds.server;
    const io = initSocket(httpServer);
    global._socketIO = io;
    LOG.info('Socket.io initialisé (rooms: USER, MANAGER, ADMIN)');
  } catch (err) {
    LOG.warn('Socket.io non disponible :', err.message);
  }

  // -----------------------------------------------------------------------
  // 4. Routes custom REST (en plus des routes OData CAP)
  //    Chaque route est protégée par requireRole() avec héritage
  // -----------------------------------------------------------------------

  // Analytics KPIs + Anomalies (UC06, UC11) — MANAGER + ADMIN
  try {
    const analyticsRouter = require('./srv/routes/analytics');
    app.use('/api/analytics', requireRole('MANAGER'), analyticsRouter);
    LOG.info('Routes /api/analytics montées (MANAGER+)');
  } catch (err) {
    LOG.warn('Routes analytics non disponibles :', err.message);
  }

  // Export CSV (UC10) — MANAGER + ADMIN
  try {
    const exportRouter = require('./srv/routes/export');
    app.use('/api/orders/export', requireRole('MANAGER'), exportRouter);
    LOG.info('Route /api/orders/export montée (MANAGER+)');
  } catch (err) {
    LOG.warn('Route export non disponible :', err.message);
  }

  // CRUD Orders — Créer/Modifier/Supprimer des commandes avec sync SAP (MANAGER + ADMIN)
  try {
    const ordersRouter = require('./srv/routes/orders');
    app.use('/api/orders/crud', requireRole('MANAGER'), ordersRouter);
    LOG.info('Routes /api/orders/crud montées (MANAGER+) — CRUD + sync SAP bidirectionnel');
  } catch (err) {
    LOG.warn('Routes orders CRUD non disponibles :', err.message);
  }

  try {
    const suppliersRouter = require('./srv/routes/suppliers');
    app.use('/api/suppliers', requireAuthenticated, suppliersRouter);
    LOG.info('Routes /api/suppliers montées (tous les rôles authentifiés)');
  } catch (err) {
    LOG.warn('Routes suppliers non disponibles :', err.message);
  }

  // Admin — Users, Logs, Sync SAP, ML (UC12-UC16) — ADMIN seul
  try {
    const adminUsersRouter = require('./srv/routes/admin/users');
    const adminLogsRouter = require('./srv/routes/admin/logs');
    const adminSyncRouter = require('./srv/routes/admin/sync');
    const adminMlRouter = require('./srv/routes/admin/ml');
    app.use('/api/admin/users', requireRole('ADMIN'), adminUsersRouter);
    app.use('/api/admin/logs', requireRole('ADMIN'), adminLogsRouter);
    app.use('/api/admin/sync', requireRole('ADMIN'), adminSyncRouter);
    app.use('/api/admin/ml', requireRole('ADMIN'), adminMlRouter);
    LOG.info('Routes /api/admin/* montées (ADMIN)');
  } catch (err) {
    LOG.warn('Routes admin non disponibles :', err.message);
  }

  // Profile & Preferences — Tous les utilisateurs authentifiés
  try {
    const profileRouter = require('./srv/routes/profile');
    app.use('/api/profile', requireAuthenticated, profileRouter);
    LOG.info('Routes /api/profile montées (tous les rôles)');
  } catch (err) {
    LOG.warn('Routes profile non disponibles :', err.message);
  }

  // -----------------------------------------------------------------------
  // 5. Servir le frontend React (SPA)
  //
  //  MODE DÉVELOPPEMENT (BAS / local) :
  //    → build/index.html n'existe PAS
  //    → Cette section est ignorée automatiquement (pas d'erreur)
  //    → Le frontend est géré par "npm start" sur port 3001/3002
  //    → Le proxy CRA redirige /api et /odata vers ce serveur (:4004)
  //
  //  MODE PRODUCTION (après "npm run build" + cf deploy) :
  //    → build/index.html existe
  //    → Ce serveur sert directement les fichiers React buildés
  //    → Une seule URL publique pour tout (frontend + backend)
  // -----------------------------------------------------------------------
  const fs = require('fs');
  const express = require('express');
  const REACT_DIST = path.join(__dirname, 'app', 'orders-ui', 'build');

  if (fs.existsSync(path.join(REACT_DIST, 'index.html'))) {
    // ✅ MODE PRODUCTION — build/ trouvé → on sert les fichiers React
    app.use(express.static(REACT_DIST));

    // SPA fallback : toute URL inconnue → index.html (React Router gère)
    // Exemple : /orders/123 → renvoie index.html → React Router affiche la page
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/odata') || req.path.startsWith('/api')) {
        return next(); // Laisser CAP gérer les routes API
      }
      res.sendFile(path.join(REACT_DIST, 'index.html'));
    });
    LOG.info(`🚀 MODE PRODUCTION — Frontend React servi depuis ${REACT_DIST}`);
  } else {
    // ℹ️ MODE DÉVELOPPEMENT — build/ absent → page d'accueil backend
    LOG.info('🛠️  MODE DÉVELOPPEMENT — Frontend non buildé');
    LOG.info('👉  Lancez "npm start" dans app/orders-ui (port 3001 ou 3002)');

    // Page d'accueil pour le backend en mode développement
    app.get('/', (req, res) => {
      res.send(`
        <!DOCTYPE html>
        <html lang="fr">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>SmartOrder Backend - Mode Développement</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 900px; margin: 50px auto; padding: 20px; background: #f5f5f5; }
            .container { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
            h1 { color: #0070f3; margin-top: 0; }
            h2 { color: #333; border-bottom: 2px solid #0070f3; padding-bottom: 10px; margin-top: 30px; }
            .status { background: #d4edda; color: #155724; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #28a745; }
            .warning { background: #fff3cd; color: #856404; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #ffc107; }
            ul { line-height: 1.8; }
            a { color: #0070f3; text-decoration: none; }
            a:hover { text-decoration: underline; }
            code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-family: 'Courier New', monospace; }
            .endpoint { background: #f8f9fa; padding: 10px; margin: 5px 0; border-radius: 4px; border-left: 3px solid #0070f3; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>🚀 SmartOrder Backend API</h1>
            <div class="status">
              ✅ <strong>Serveur CAP actif</strong> — Mode Développement
            </div>
            
            <div class="warning">
              ⚠️ <strong>Frontend non buildé</strong><br>
              Pour accéder à l'interface utilisateur, lancez le frontend React :<br>
              <code>cd app/orders-ui && npm start</code><br>
              Puis ouvrez <a href="http://localhost:3002" target="_blank">http://localhost:3002</a>
            </div>

            <h2>📡 Services OData CAP</h2>
            <div class="endpoint">
              <strong>OrdersService</strong><br>
              <a href="/odata/v4/orders" target="_blank">/odata/v4/orders</a> — Gestion des commandes
            </div>
            <div class="endpoint">
              <strong>AnalyticsService</strong><br>
              <a href="/odata/v4/analytics" target="_blank">/odata/v4/analytics</a> — KPIs et statistiques (MANAGER+)
            </div>
            <div class="endpoint">
              <strong>AdminService</strong><br>
              <a href="/odata/v4/admin" target="_blank">/odata/v4/admin</a> — Administration (ADMIN)
            </div>
            <div class="endpoint">
              <strong>ProfileService</strong><br>
              <a href="/odata/v4/profile" target="_blank">/odata/v4/profile</a> — Profil utilisateur
            </div>

            <h2>🔌 Routes REST Custom</h2>
            <ul>
              <li><strong>POST</strong> <code>/api/login</code> — Authentification</li>
              <li><strong>GET</strong> <code>/api/me</code> — Info utilisateur</li>
              <li><strong>GET</strong> <code>/api/health</code> — Health check détaillé</li>
              <li><strong>GET</strong> <code>/status</code> — Health check simple</li>
              <li><strong>GET</strong> <code>/api/analytics/*</code> — Analytics (MANAGER+)</li>
              <li><strong>GET</strong> <code>/api/orders/export</code> — Export CSV (MANAGER+)</li>
              <li><strong>GET/POST</strong> <code>/api/admin/*</code> — Administration (ADMIN)</li>
              <li><strong>GET/PATCH</strong> <code>/api/profile/*</code> — Profil & Préférences</li>
            </ul>

            <h2>🔐 Authentification Mock (Développement)</h2>
            <p>Utilisateurs de test disponibles :</p>
            <ul>
              <li><strong>admin</strong> / admin — Rôle ADMIN (accès complet)</li>
              <li><strong>manager</strong> / manager — Rôle MANAGER (analytics + export)</li>
              <li><strong>user</strong> / user — Rôle USER (consultation)</li>
            </ul>

            <h2>📚 Documentation</h2>
            <ul>
              <li><a href="https://cap.cloud.sap/docs/" target="_blank">SAP Cloud Application Programming Model</a></li>
              <li><a href="/odata/v4/orders/$metadata" target="_blank">Métadonnées OData</a></li>
            </ul>

            <p style="margin-top: 40px; color: #666; font-size: 0.9em; text-align: center;">
              SmartOrder — Projet PFE SAP BTP — YAAS "Run It Best"
            </p>
          </div>
        </body>
        </html>
      `);
    });
  }

  // -----------------------------------------------------------------------
  // 6. Endpoints /api/jobs/* — callbacks du SAP Job Scheduling Service
  //    Ces endpoints sont appelés automatiquement par le Job Scheduler (prod)
  //    ou manuellement (tests / démo).
  //    Auth : le Job Scheduler envoie un token XSUAA validé par CAP.
  // -----------------------------------------------------------------------
  try {
    const syncSAPService = require('./srv/services/syncSAPService');
    const { detecterAlertes } = require('./srv/services/alerteService');

    // POST /api/jobs/sync-sap — déclenché par Job Scheduler (DELTA toutes les 6h)
    app.post('/api/jobs/sync-sap', async (req, res) => {
      LOG.info('Job /api/jobs/sync-sap déclenché');
      try {
        const result = await syncSAPService.syncDelta('DELTA');
        const io = global._socketIO;
        if (io && (result.creees > 0 || result.mises_a_jour > 0)) {
          io.to('ADMIN').emit('SYNC_AUTO_COMPLETE', {
            ...result,
            timestamp: new Date().toISOString(),
          });
        }
        res.status(200).json({ status: 'ok', ...result });
      } catch (err) {
        LOG.error(`Job sync-sap erreur : ${err.message}`);
        // HTTP 200 obligatoire pour éviter le retry infini du Job Scheduler
        res.status(200).json({ status: 'error', message: err.message });
      }
    });

    // POST /api/jobs/detect-alertes — déclenché par Job Scheduler (toutes les 5min)
    app.post('/api/jobs/detect-alertes', async (req, res) => {
      LOG.debug('Job /api/jobs/detect-alertes déclenché');
      try {
        const count = await detecterAlertes();
        res.status(200).json({ status: 'ok', alertes_creees: count });
      } catch (err) {
        LOG.error(`Job detect-alertes erreur : ${err.message}`);
        res.status(200).json({ status: 'error', message: err.message });
      }
    });

    LOG.info('Routes /api/jobs/* montées (Job Scheduling Service callbacks)');
  } catch (err) {
    LOG.warn(`Routes /api/jobs/* non disponibles : ${err.message}`);
  }

  // -----------------------------------------------------------------------
  // 7. Jobs planifiés (node-cron en BAS, SAP Job Scheduler en production)
  // -----------------------------------------------------------------------
  if (process.env.NODE_ENV !== 'test') {
    try {
      const { startJobs } = require('./srv/jobs/cronJobs');

      // Récupérer l'URL publique CF (disponible en production via VCAP_APPLICATION)
      let appUrl = null;
      try {
        const vcapApp = JSON.parse(process.env.VCAP_APPLICATION || '{}');
        const uris = vcapApp.application_uris || vcapApp.uris || [];
        if (uris.length > 0) appUrl = `https://${uris[0]}`;
      } catch { /* ignore */ }

      await startJobs(appUrl);
      LOG.info(`Jobs démarrés (appUrl=${appUrl || 'BAS/local'})`);
    } catch (err) {
      LOG.warn(`Jobs non démarrés : ${err.message}`);
    }
  }

  LOG.info('SmartOrder Server prêt');
  return server;
};
