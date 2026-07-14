'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'db', 'data');
const cache = new Map();

function csvFallbackEnabled() {
  return process.env.SMARTORDER_CSV_FALLBACK !== 'false';
}

function isRecoverableDbError(err) {
  const code = String(err?.code || '').toUpperCase();
  const status = Number(err?.statusCode || err?.status || 0);
  const message = String(err?.message || err?.cause?.message || '');
  const transientCodes = new Set([
    '42P01', // relation does not exist
    '42703', // column does not exist
    '53300', // too many connections
    '57P01', // admin shutdown
    '57P02', // crash shutdown
    '57P03', // cannot connect now
    '08000',
    '08003',
    '08006',
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EPIPE',
    'ENOTFOUND',
    'SMARTORDER_READ_TIMEOUT',
  ]);

  return transientCodes.has(code)
    || status === 502
    || status === 503
    || status === 504
    || /relation .* does not exist/i.test(message)
    || /column .* does not exist/i.test(message)
    || /timeout|ResourceRequest|ECONN|ETIMEDOUT|ENOTFOUND|EPIPE|socket hang up/i.test(message)
    || /SASL|password authentication/i.test(message)
    || /service unavailable|upstream connect error|disconnect\/reset before headers/i.test(message)
    || /connection termination|connection terminated|terminating connection/i.test(message)
    || /client has encountered a connection error|remaining connection slots/i.test(message);
}

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === ',' && !quoted) {
      cells.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells;
}

function coerceValue(value) {
  if (value === '') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

let csvReadErrors = {};

function getCsvReadErrors() {
  return { ...csvReadErrors };
}

function readCsv(entityName) {
  if (cache.has(entityName)) return cache.get(entityName);

  const file = path.join(DATA_DIR, `smartorder-${entityName}.csv`);

  if (!fs.existsSync(file)) {
    const msg = `Fichier CSV introuvable: ${file}`;
    csvReadErrors[entityName] = msg;
    console.warn('[csvFallback] ' + msg);
    cache.set(entityName, []);
    return [];
  }

  try {
    const content = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim();
    if (!content) {
      csvReadErrors[entityName] = `Fichier CSV vide: ${file}`;
      cache.set(entityName, []);
      return [];
    }

    const [headerLine, ...lines] = content.split(/\r?\n/);
    const headers = parseCsvLine(headerLine);

    if (!headers.length) {
      csvReadErrors[entityName] = `Fichier CSV sans en-tete: ${file}`;
      cache.set(entityName, []);
      return [];
    }

    const rows = lines
      .filter(Boolean)
      .map((line) => {
        const values = parseCsvLine(line);
        return headers.reduce((row, header, index) => {
          row[header] = coerceValue(values[index] ?? '');
          return row;
        }, {});
      });

    cache.set(entityName, rows);
    delete csvReadErrors[entityName];
    return rows;
  } catch (err) {
    const msg = `Erreur lecture CSV ${file}: ${err.message}`;
    csvReadErrors[entityName] = msg;
    console.error('[csvFallback] ' + msg);
    cache.set(entityName, []);
    return [];
  }
}

function readOrdersFallback({ top = 20, skip = 0, filterStatus = null } = {}) {
  const fournisseursById = Object.fromEntries(readCsv('Fournisseurs').map((row) => [row.ID, row]));
  const predictionsByOrder = Object.fromEntries(readCsv('Predictions').map((row) => [row.commande_ID, row]));

  let rows = [...readCsv('Orders')];
  if (filterStatus) rows = rows.filter((row) => row.statut === filterStatus);
  rows.sort((a, b) => String(b.date_creation || '').localeCompare(String(a.date_creation || '')));

  const count = rows.length;
  const value = rows.slice(skip, skip + top).map((row) => ({
    ...row,
    montant_total: Number(row.montant_total || 0),
    score_priorite: Number(row.score_priorite || 0),
    postes_en_retard: Number(row.postes_en_retard || 0),
    marqueur_suppression: row.marqueur_suppression === true || row.marqueur_suppression === 'true',
    fournisseur: fournisseursById[row.fournisseur_ID] || null,
    prediction: predictionsByOrder[row.ID] || null,
  }));

  return { value, '@odata.count': count };
}

function readSuppliersFallback({ top = 100, skip = 0, search = '' } = {}) {
  const orders = readCsv('Orders');
  const normalizedSearch = String(search || '').trim().toLowerCase();

  let rows = [...readCsv('Fournisseurs')];
  if (normalizedSearch) {
    rows = rows.filter((row) => [row.code_sap, row.nom, row.pays, row.email]
      .some((value) => String(value || '').toLowerCase().includes(normalizedSearch)));
  }

  rows.sort((a, b) => String(a.nom || '').localeCompare(String(b.nom || '')));

  const count = rows.length;
  const items = rows.slice(skip, skip + top).map((row) => {
    const supplierOrders = orders.filter((order) => order.fournisseur_ID === row.ID);
    return {
      ...row,
      taux_retard_moyen: Number(row.taux_retard_moyen || 0),
      delai_moyen_jours: Number(row.delai_moyen_jours || 0),
      score_performance: Number(row.score_performance || 0),
      actif: row.actif === true || row.actif === 'true',
      nombre_commandes: supplierOrders.length,
      commandes_actives: supplierOrders.filter((order) => order.statut !== 'ANNULE').length,
      commandes_en_retard: supplierOrders.filter((order) => Number(order.postes_en_retard || 0) > 0).length,
    };
  });

  return { items, count, top, skip };
}

function parseJsonField(value, fallback = null) {
  if (!value || typeof value !== 'string') return value || fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function findUserFallback(userId) {
  const localUsername = typeof userId === 'string' && userId.includes('@')
    ? userId.split('@')[0]
    : userId;

  return readCsv('Utilisateurs').find((user) => (
    user.xsuaa_user_id === userId
    || user.username === userId
    || user.email === userId
    || user.username === localUsername
  )) || null;
}

function normalizeUserFallback(user) {
  if (!user) return user;
  return {
    ...user,
    actif: user.actif === true || user.actif === 'true',
    perimetre: parseJsonField(user.perimetre, { company_codes: [], purchasing_orgs: [] }),
    preferences: parseJsonField(user.preferences, {}),
  };
}

function readUsersFallback({ top = 200, skip = 0 } = {}) {
  const rows = [...readCsv('Utilisateurs')]
    .sort((a, b) => `${a.role || ''}:${a.username || ''}`.localeCompare(`${b.role || ''}:${b.username || ''}`));
  const items = rows.slice(skip, skip + top).map(normalizeUserFallback);
  return { items, total: rows.length };
}

function readAlertsFallback({ top = 20 } = {}) {
  const ordersById = Object.fromEntries(readCsv('Orders').map((row) => [row.ID, row]));
  const value = [...readCsv('Alertes')]
    .sort((a, b) => String(b.date_creation || '').localeCompare(String(a.date_creation || '')))
    .slice(0, top)
    .map((row) => {
      const order = ordersById[row.commande_ID];
      return {
        ...row,
        lu: row.lu === true || row.lu === 'true',
        acquitte: row.acquitte === true || row.acquitte === 'true',
        details: parseJsonField(row.details, null),
        destinataires_roles: parseJsonField(row.destinataires_roles, []),
        commande: order ? {
          ID: order.ID,
          numero_sap: order.numero_sap,
        } : null,
      };
    });
  return { value };
}

function readHistoryFallback({ top = 100 } = {}) {
  const usersById = Object.fromEntries(readCsv('Utilisateurs').map((row) => [row.ID, row]));
  const ordersById = Object.fromEntries(readCsv('Orders').map((row) => [row.ID, row]));
  const value = [...readCsv('HistoriqueStatut')]
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, top)
    .map((row) => {
      const user = usersById[row.user_ID];
      const order = ordersById[row.commande_ID];
      return {
        ...row,
        user: user ? {
          ID: user.ID,
          username: user.username,
          email: user.email,
        } : null,
        commande: order ? {
          ID: order.ID,
          numero_sap: order.numero_sap,
        } : null,
      };
    });
  return { value };
}

function readSyncJobsFallback({ top = 20 } = {}) {
  const value = [...readCsv('SyncJobs')]
    .sort((a, b) => String(b.started_at || b.createdAt || '').localeCompare(String(a.started_at || a.createdAt || '')))
    .slice(0, top)
    .map((row) => ({
      ...row,
      commandes_creees: Number(row.commandes_creees || 0),
      commandes_maj: Number(row.commandes_maj || 0),
      erreurs: Number(row.erreurs || 0),
    }));
  return { value };
}

function readMlModelsFallback() {
  const value = [...readCsv('MlModels')]
    .sort((a, b) => String(b.trained_at || '').localeCompare(String(a.trained_at || '')))
    .map((row) => ({
      ...row,
      accuracy: row.accuracy === null ? null : Number(row.accuracy),
      f1_score: row.f1_score === null ? null : Number(row.f1_score),
      mae: row.mae === null ? null : Number(row.mae),
      r2: row.r2 === null ? null : Number(row.r2),
      dataset_size: Number(row.dataset_size || 0),
      actif: row.actif === true || row.actif === 'true',
    }));
  return { value };
}

module.exports = {
  csvFallbackEnabled,
  isRecoverableDbError,
  readOrdersFallback,
  readSuppliersFallback,
  findUserFallback,
  readUsersFallback,
  readAlertsFallback,
  readHistoryFallback,
  readSyncJobsFallback,
  readMlModelsFallback,
  getCsvReadErrors,
};
