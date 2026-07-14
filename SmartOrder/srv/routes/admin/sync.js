'use strict';
/**
 * Routes Admin — Synchronisation SAP manuelle (UC15)
 * POST /api/admin/sync → 202 Async (tâche background)
 * GET  /api/admin/sync/:jobId → Statut du job
 *
 * Base de données : SAP HANA Cloud (BTP)
 */
const express = require('express');
const cds = require('@sap/cds');
const { uuid } = cds.utils;
const {
  csvFallbackEnabled,
  isRecoverableDbError,
  readSyncJobsFallback,
} = require('../../utils/csvFallback');

const router = express.Router();
const LOG = cds.log('admin-sync');
const STALE_JOB_MINUTES = Number(process.env.SMARTORDER_SYNC_STALE_MINUTES || 30);

function isPostgres() {
  const db = cds.env.requires?.db || {};
  const kind = db.kind || db[process.env.NODE_ENV]?.kind || 'sqlite';
  return kind === 'postgres' || kind === 'postgresql';
}

function p(index) {
  return isPostgres() ? `$${index}` : '?';
}

function requireAdmin(req, res, next) {
  if (req.userRole === 'ADMIN' || req.user?.is?.('ADMIN') || req.user?.roles?.includes('ADMIN')) {
    return next();
  }
  const scopes = [
    ...(Array.isArray(req.user?.scopes) ? req.user.scopes : []),
    ...(Array.isArray(req.user?.scope) ? req.user.scope : []),
  ];
  if (scopes.some((scope) => scope === 'ADMIN' || scope.endsWith('.ADMIN') || scope.endsWith('.admin.sync'))) {
    return next();
  }
  return res.status(403).json({ error: 'Accès réservé aux administrateurs.' });
}
router.use(requireAdmin);

// Stockage en mémoire des jobs en cours (Redis en production)
const activeJobs = new Map();

// GET /api/admin/sync — Lister les derniers jobs
router.get('/', async (req, res, next) => {
  try {
    const db = await cds.connect.to('db');
    const jobs = await db.run(`
      SELECT * FROM smartorder_SyncJobs
      ORDER BY createdAt DESC
      LIMIT 20
    `);
    res.json({ items: jobs, total: jobs.length });
  } catch (err) {
    LOG.warn('Impossible de lire les jobs : %s', err.message);
    if (csvFallbackEnabled()) {
      const fallback = readSyncJobsFallback({ top: 20 }).value;
      res.set('x-smartorder-data-source', 'csv-fallback');
      return res.json({ items: fallback, total: fallback.length });
    }
    next(err);
  }
});

// POST /api/admin/sync — Déclencher sync SAP (UC15)
router.post('/', async (req, res) => {
  const requestedMode = String(req.body?.mode || 'DELTA').toUpperCase();
  const mode = requestedMode === 'FULL' ? 'FULL' : 'DELTA';
  const jobId = uuid();
  const now = new Date().toISOString();

  // Enregistrer le job en BDD
  try {
    const db = await cds.connect.to('db');
    await markStaleJobsAsFailed(db);

    const running = await db.run(`
      SELECT ID, mode, started_at, createdAt
      FROM smartorder_SyncJobs
      WHERE statut = 'EN_COURS'
      ORDER BY COALESCE(started_at, createdAt) DESC
      LIMIT 1
    `);

    if (running.length) {
      const active = running[0];
      return res.status(409).json({
        error: 'Synchronisation deja en cours',
        message: `Une synchronisation ${active.mode || ''} est deja en cours. Attendez sa fin avant de relancer.`,
        jobId: active.ID,
        statut: 'EN_COURS',
        started_at: active.started_at || active.createdAt,
      });
    }

    await db.run(`
      INSERT INTO smartorder_SyncJobs (ID, mode, statut, started_at, createdAt)
      VALUES (${p(1)}, ${p(2)}, 'EN_COURS', ${p(3)}, ${p(4)})
    `, [jobId, mode, now, now]);
  } catch (err) {
    LOG.warn('Impossible d\'enregistrer le job en BDD : %s', err.message);
    if (isRecoverableDbError(err)) {
      activeJobs.set(jobId, { statut: 'ECHEC', error: 'Base PostgreSQL indisponible', started_at: now });
      return res.status(503).json({
        error: 'Base de donnees indisponible',
        message: 'La synchronisation SAP necessite une connexion PostgreSQL active. Verifiez la connexion Neon puis relancez.',
        jobId,
        statut: 'ECHEC',
      });
    }
  }

  activeJobs.set(jobId, { statut: 'EN_COURS', started_at: now });

  // Répondre immédiatement 202
  res.status(202).json({
    jobId,
    statut: 'EN_COURS',
    message: `Synchronisation SAP (${mode}) démarrée.`,
    started_at: now,
  });

  // Exécuter en arrière-plan
  _executerSync(jobId, mode).catch(err =>
    LOG.error('Sync SAP erreur : %s', err.message)
  );
});

// GET /api/admin/sync/:jobId — Statut du job
router.get('/:jobId', async (req, res) => {
  const { jobId } = req.params;
  try {
    const db = await cds.connect.to('db');
    const rows = await db.run(
      `SELECT * FROM smartorder_SyncJobs WHERE ID = ${p(1)}`,
      [jobId]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Job introuvable.' });
    }
    res.json(rows[0]);
  } catch {
    // Fallback mémoire
    const job = activeJobs.get(jobId);
    if (!job) return res.status(404).json({ error: 'Job introuvable.' });
    res.json({ ID: jobId, ...job });
  }
});

// Exécution async de la synchronisation SAP
async function _executerSync(jobId, mode) {
  const db = await cds.connect.to('db');
  const io = global._socketIO;
  let creees = 0, mises_a_jour = 0, erreurs = 0;
  const startedAt = new Date();

  try {
    const syncSAPService = require('../../services/syncSAPService');
    const result = await syncSAPService.syncDelta(mode, { jobId, skipJobInsert: true });
    creees      = result.creees      || 0;
    mises_a_jour = result.mises_a_jour || 0;
    erreurs     = result.erreurs     || 0;
  } catch (err) {
    erreurs = 1;
    LOG.error('Sync SAP échouée : %s', err.message);
    await db.run(`
      UPDATE smartorder_SyncJobs
      SET statut='ECHEC', error_message=${p(1)}, ended_at=${p(2)}
      WHERE ID = ${p(3)}
    `, [err.message, new Date().toISOString(), jobId]);
    activeJobs.set(jobId, { statut: 'ECHEC', error: err.message });
    return;
  }

  const endedAt = new Date();
  const dureeMs = endedAt - startedAt;

  await db.run(`
    UPDATE smartorder_SyncJobs
    SET statut='SUCCES', commandes_creees=${p(1)}, commandes_maj=${p(2)},
        erreurs=${p(3)}, started_at=${p(4)}, ended_at=${p(5)}, duree_ms=${p(6)}
    WHERE ID = ${p(7)}
  `, [toSafeNumber(creees), toSafeNumber(mises_a_jour), toSafeNumber(erreurs), startedAt.toISOString(), endedAt.toISOString(), dureeMs, jobId]);

  activeJobs.set(jobId, { statut: 'SUCCES', creees, mises_a_jour, erreurs });

  // Notifier les admins via WebSocket
  if (io) {
    io.to('ADMIN').emit('SYNC_COMPLETE', {
      jobId, creees, mises_a_jour, erreurs, duree_ms: dureeMs,
    });
  }
  LOG.info('Sync SAP terminée — créées=%d maj=%d erreurs=%d', creees, mises_a_jour, erreurs);
}

function toSafeNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

async function markStaleJobsAsFailed(db) {
  const cutoff = new Date(Date.now() - STALE_JOB_MINUTES * 60 * 1000).toISOString();
  try {
    await db.run(
      `UPDATE smartorder_SyncJobs
       SET statut='ECHEC',
           erreurs=CASE WHEN erreurs IS NULL OR erreurs = 0 THEN 1 ELSE erreurs END,
           error_message=${p(1)},
           ended_at=${p(2)}
       WHERE statut='EN_COURS'
         AND COALESCE(started_at, createdAt) < ${p(3)}`,
      [
        `Job marque en echec automatiquement apres ${STALE_JOB_MINUTES} minutes sans fin.`,
        new Date().toISOString(),
        cutoff,
      ]
    );
  } catch (err) {
    LOG.warn('Impossible de nettoyer les anciens jobs EN_COURS : %s', err.message);
  }
}

module.exports = router;
