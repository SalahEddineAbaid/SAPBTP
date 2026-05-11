'use strict';
/**
 * Routes Admin — Synchronisation SAP manuelle (UC15)
 * POST /api/admin/sync → 202 Async (tâche background)
 * GET  /api/admin/sync/:jobId → Statut du job
 *
 * Compatibilité : SQLite (dev) + PostgreSQL (production)
 */
const express = require('express');
const cds = require('@sap/cds');
const { uuid } = cds.utils;

const router = express.Router();
const LOG = cds.log('admin-sync');

function isPostgres() {
  try {
    const db = cds.env.requires?.db;
    const kind = db?.kind || db?.[process.env.NODE_ENV]?.kind || 'sqlite';
    return kind === 'postgres' || kind === 'postgresql';
  } catch { return false; }
}

function requireAdmin(req, res, next) {
  if (!req.user?.is?.('ADMIN') && !req.user?.roles?.includes('ADMIN')) {
    return res.status(403).json({ error: 'Accès réservé aux administrateurs.' });
  }
  next();
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
    res.json({ items: [], total: 0 });
  }
});

// POST /api/admin/sync — Déclencher sync SAP (UC15)
router.post('/', async (req, res) => {
  const { mode = 'DELTA' } = req.body;
  const jobId = uuid();
  const now = new Date().toISOString();
  const pg = isPostgres();

  // Enregistrer le job en BDD
  try {
    const db = await cds.connect.to('db');
    if (pg) {
      await db.run(`
        INSERT INTO smartorder_SyncJobs (ID, mode, statut, createdAt)
        VALUES ($1, $2, 'EN_COURS', $3)
      `, [jobId, mode, now]);
    } else {
      await db.run(`
        INSERT INTO smartorder_SyncJobs (ID, mode, statut, createdAt)
        VALUES (?, ?, 'EN_COURS', ?)
      `, [jobId, mode, now]);
    }
  } catch (err) {
    LOG.warn('Impossible d\'enregistrer le job en BDD : %s', err.message);
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
  const pg = isPostgres();
  try {
    const db = await cds.connect.to('db');
    const rows = await db.run(
      pg
        ? `SELECT * FROM smartorder_SyncJobs WHERE ID = $1`
        : `SELECT * FROM smartorder_SyncJobs WHERE ID = ?`,
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
  const pg = isPostgres();
  let creees = 0, mises_a_jour = 0, erreurs = 0;
  const startedAt = new Date();

  try {
    const syncSAPService = require('../../services/syncSAPService');
    const result = await syncSAPService.syncDelta(mode);
    creees      = result.creees      || 0;
    mises_a_jour = result.mises_a_jour || 0;
    erreurs     = result.erreurs     || 0;
  } catch (err) {
    erreurs = 1;
    LOG.error('Sync SAP échouée : %s', err.message);
    if (pg) {
      await db.run(`
        UPDATE smartorder_SyncJobs
        SET statut='ECHEC', error_message=$1, ended_at=$2
        WHERE ID = $3
      `, [err.message, new Date().toISOString(), jobId]);
    } else {
      await db.run(`
        UPDATE smartorder_SyncJobs
        SET statut='ECHEC', error_message=?, ended_at=?
        WHERE ID = ?
      `, [err.message, new Date().toISOString(), jobId]);
    }
    activeJobs.set(jobId, { statut: 'ECHEC', error: err.message });
    return;
  }

  const endedAt = new Date();
  const dureeMs = endedAt - startedAt;

  if (pg) {
    await db.run(`
      UPDATE smartorder_SyncJobs
      SET statut='SUCCES', commandes_creees=$1, commandes_maj=$2,
          erreurs=$3, started_at=$4, ended_at=$5
      WHERE ID = $6
    `, [creees, mises_a_jour, erreurs, startedAt.toISOString(), endedAt.toISOString(), jobId]);
  } else {
    await db.run(`
      UPDATE smartorder_SyncJobs
      SET statut='SUCCES', commandes_creees=?, commandes_maj=?,
          erreurs=?, started_at=?, ended_at=?
      WHERE ID = ?
    `, [creees, mises_a_jour, erreurs, startedAt.toISOString(), endedAt.toISOString(), jobId]);
  }

  activeJobs.set(jobId, { statut: 'SUCCES', creees, mises_a_jour, erreurs });

  // Notifier les admins via WebSocket
  if (io) {
    io.to('ADMIN').emit('SYNC_COMPLETE', {
      jobId, creees, mises_a_jour, erreurs, duree_ms: dureeMs,
    });
  }
  LOG.info('Sync SAP terminée — créées=%d maj=%d erreurs=%d', creees, mises_a_jour, erreurs);
}

module.exports = router;
