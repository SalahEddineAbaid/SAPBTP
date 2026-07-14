'use strict';

const cds = require('@sap/cds');

const COUNTRY_ALIASES = {
  MAR: 'MA',
  FRA: 'FR',
  ESP: 'ES',
  DZA: 'DZ',
  DEU: 'DE',
  ITA: 'IT',
  USA: 'US',
};

function normalizeCountryCode(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return 'MA';
  return COUNTRY_ALIASES[raw] || raw;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toDateOnly(value) {
  if (!value) return null;
  const raw = String(value);
  return raw.includes('T') ? raw.split('T')[0] : raw.slice(0, 10);
}

function isCancelled(order) {
  return order.statut === 'ANNULE' || order.marqueur_suppression === true || order.marqueur_suppression === 1;
}

function isDelivered(order) {
  return order.statut === 'LIVRE' || Boolean(order.date_livraison_reelle);
}

function isLate(order, today = new Date().toISOString().slice(0, 10)) {
  if (isCancelled(order)) return false;
  const planned = toDateOnly(order.date_previsionnelle);
  const actual = toDateOnly(order.date_livraison_reelle);

  if (toNumber(order.postes_en_retard) > 0) return true;
  if (planned && actual) return actual > planned;
  if (planned && !isDelivered(order)) return planned < today;
  return false;
}

function dayDiff(start, end) {
  const a = Date.parse(toDateOnly(start) || '');
  const b = Date.parse(toDateOnly(end) || '');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / 86400000));
}

function buildSupplierMetrics(supplier, orders) {
  const activeOrders = orders.filter((order) => !isCancelled(order));
  const deliveredOrders = activeOrders.filter(isDelivered);
  const lateOrders = activeOrders.filter(isLate);

  const deliveryDurations = deliveredOrders
    .map((order) => dayDiff(order.date_commande || order.date_creation, order.date_livraison_reelle))
    .filter((value) => value !== null);

  const tauxRetard = activeOrders.length ? lateOrders.length / activeOrders.length : toNumber(supplier.taux_retard_moyen);
  const delaiMoyen = deliveryDurations.length
    ? deliveryDurations.reduce((sum, value) => sum + value, 0) / deliveryDurations.length
    : toNumber(supplier.delai_moyen_jours);
  const scorePerformance = Math.max(0, Math.min(1, 1 - tauxRetard));

  return {
    nombre_commandes: orders.length,
    commandes_actives: activeOrders.length,
    commandes_en_retard: lateOrders.length,
    commandes_livrees: deliveredOrders.length,
    taux_retard_moyen: Number(tauxRetard.toFixed(4)),
    delai_moyen_jours: Number(delaiMoyen.toFixed(2)),
    score_performance: Number(scorePerformance.toFixed(4)),
  };
}

async function getSupplierRows(db, { top = 100, skip = 0, search = '' } = {}) {
  const rows = await db.run(
    SELECT.from('smartorder.Fournisseurs')
      .columns(
        'ID',
        'code_sap',
        'nom',
        'pays',
        'email',
        'telephone',
        'taux_retard_moyen',
        'delai_moyen_jours',
        'score_performance',
        'actif',
        'derniere_sync',
        'createdAt',
        'updatedAt'
      )
      .orderBy('nom asc', 'code_sap asc')
  );

  const normalizedSearch = String(search || '').trim().toLowerCase();
  const filtered = normalizedSearch
    ? rows.filter((row) => [row.code_sap, row.nom, row.pays, row.email]
      .some((value) => String(value || '').toLowerCase().includes(normalizedSearch)))
    : rows;

  return {
    rows: filtered.slice(skip, skip + top),
    count: filtered.length,
  };
}

async function getOrdersBySupplier(db) {
  const rows = await db.run(
    SELECT.from('smartorder.Orders')
      .columns(
        'ID',
        'numero_sap',
        'statut',
        'marqueur_suppression',
        'date_creation',
        'date_commande',
        'date_previsionnelle',
        'date_livraison_reelle',
        'postes_en_retard',
        'fournisseur_ID',
        'montant_total',
        'devise'
      )
      .where('fournisseur_ID is not null')
  );

  return rows.reduce((acc, row) => {
    if (!acc[row.fournisseur_ID]) acc[row.fournisseur_ID] = [];
    acc[row.fournisseur_ID].push(row);
    return acc;
  }, {});
}

async function listSuppliers(options = {}) {
  const db = options.db || await cds.connect.to('db');
  const top = Math.min(Math.max(Number(options.top) || 100, 1), 500);
  const skip = Math.max(Number(options.skip) || 0, 0);

  const { rows, count } = await getSupplierRows(db, { top, skip, search: options.search });
  const ordersBySupplier = await getOrdersBySupplier(db);

  const items = rows.map((supplier) => {
    const metrics = buildSupplierMetrics(supplier, ordersBySupplier[supplier.ID] || []);
    return {
      ...supplier,
      pays: normalizeCountryCode(supplier.pays),
      actif: supplier.actif === true || supplier.actif === 1 || supplier.actif === 'true',
      ...metrics,
    };
  });

  return { items, count, top, skip };
}

async function recalculateSupplierMetrics(db, supplierId) {
  if (!supplierId) return null;

  const suppliers = await db.run(
    SELECT.from('smartorder.Fournisseurs').where({ ID: supplierId })
  );
  if (!suppliers.length) return null;

  const orders = await db.run(
    SELECT.from('smartorder.Orders')
      .columns(
        'ID',
        'statut',
        'marqueur_suppression',
        'date_creation',
        'date_commande',
        'date_previsionnelle',
        'date_livraison_reelle',
        'postes_en_retard'
      )
      .where({ fournisseur_ID: supplierId })
  );

  const metrics = buildSupplierMetrics(suppliers[0], orders);
  await db.run(
    UPDATE('smartorder.Fournisseurs')
      .set({
        taux_retard_moyen: metrics.taux_retard_moyen,
        delai_moyen_jours: metrics.delai_moyen_jours,
        score_performance: metrics.score_performance,
        updatedAt: new Date().toISOString(),
      })
      .where({ ID: supplierId })
  );

  return metrics;
}

module.exports = {
  normalizeCountryCode,
  buildSupplierMetrics,
  listSuppliers,
  recalculateSupplierMetrics,
};
