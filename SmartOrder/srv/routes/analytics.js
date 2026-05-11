'use strict';
/**
 * Route /api/analytics — KPIs + Anomalies
 * UC06 : Dashboard KPIs
 * UC11 : Détection anomalies
 */
const express = require('express');
const cds = require('@sap/cds');
const { getKPIs, getAnomalies } = require('../services/analyticsService');

const router = express.Router();
const LOG = cds.log('analytics-route');

// Middleware auth basique (délègue à CAP)
function requireRole(...roles) {
  return (req, res, next) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Non authentifié' });
    const hasRole = roles.some(r => user.is?.(r) || user.roles?.includes(r));
    if (!hasRole) return res.status(403).json({ error: `Rôle requis : ${roles.join(' ou ')}` });
    next();
  };
}

// GET /api/analytics/kpis — UC06 Dashboard
router.get('/kpis', requireRole('MANAGER', 'ADMIN'), async (req, res, next) => {
  try {
    LOG.info('GET /api/analytics/kpis — user=%s', req.user?.id);
    const kpis = await getKPIs();
    res.json(kpis);
  } catch (err) {
    LOG.error('Erreur KPIs : %s', err.message);
    next(err);
  }
});

// GET /api/analytics/anomalies — UC11 Anomalies
router.get('/anomalies', requireRole('MANAGER', 'ADMIN'), async (req, res, next) => {
  try {
    LOG.info('GET /api/analytics/anomalies — user=%s', req.user?.id);
    const anomalies = await getAnomalies();
    res.json(anomalies);
  } catch (err) {
    LOG.error('Erreur anomalies : %s', err.message);
    next(err);
  }
});

module.exports = router;
