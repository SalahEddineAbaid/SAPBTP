'use strict';

const express = require('express');
const cds = require('@sap/cds');
const {
  listSuppliers,
  recalculateSupplierMetrics,
} = require('../services/supplierService');
const {
  csvFallbackEnabled,
  readSuppliersFallback,
} = require('../utils/csvFallback');

const router = express.Router();
const LOG = cds.log('suppliers-route');

function getReadTimeoutMs() {
  const configured = Number(process.env.SMARTORDER_READ_TIMEOUT_MS || 3500);
  return Number.isFinite(configured) && configured > 0 ? configured : 3500;
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

router.get('/', async (req, res, next) => {
  try {
    const result = await withReadTimeout(
      listSuppliers({
        top: req.query.top,
        skip: req.query.skip,
        search: req.query.search || req.query.q,
      }),
      '/api/suppliers PostgreSQL read'
    );

    res.json(result);
  } catch (err) {
    LOG.error('GET /api/suppliers erreur : %s', err.message);
    if (csvFallbackEnabled()) {
      const result = readSuppliersFallback({
        top: req.query.top,
        skip: req.query.skip,
        search: req.query.search || req.query.q,
      });
      res.set('x-smartorder-data-source', 'csv-fallback');
      res.set('x-smartorder-fallback-reason', String(err?.message || err).slice(0, 180));
      return res.json(result);
    }
    next(err);
  }
});

router.post('/:id/recalculate', async (req, res, next) => {
  try {
    const db = await cds.connect.to('db');
    const metrics = await recalculateSupplierMetrics(db, req.params.id);
    if (!metrics) return res.status(404).json({ error: 'Fournisseur introuvable.' });
    res.json({ ID: req.params.id, metrics });
  } catch (err) {
    LOG.error('POST /api/suppliers/%s/recalculate erreur : %s', req.params.id, err.message);
    next(err);
  }
});

module.exports = router;
