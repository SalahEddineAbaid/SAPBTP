'use strict';

const express = require('express');
const cds = require('@sap/cds');
const { uuid } = cds.utils;
const mlService = require('../../services/mlService');
const {
  csvFallbackEnabled,
  isRecoverableDbError,
  readMlModelsFallback,
} = require('../../utils/csvFallback');

const router = express.Router();
const LOG = cds.log('admin-ml');

function isPostgres() {
  try {
    const db = cds.env.requires?.db;
    const kind = db?.kind || db?.[process.env.NODE_ENV]?.kind || 'sqlite';
    return kind === 'postgres' || kind === 'postgresql';
  } catch { return false; }
}

function requireAdmin(req, res, next) {
  if (req.userRole === 'ADMIN' || req.user?.is?.('ADMIN') || req.user?.roles?.includes('ADMIN')) {
    return next();
  }
  const scopes = [
    ...(Array.isArray(req.user?.scopes) ? req.user.scopes : []),
    ...(Array.isArray(req.user?.scope) ? req.user.scope : []),
  ];
  if (scopes.some((scope) => scope === 'ADMIN' || scope.endsWith('.ADMIN') || scope.endsWith('.admin.ml'))) {
    return next();
  }
  return res.status(403).json({ error: 'Accès réservé aux administrateurs.' });
}
router.use(requireAdmin);

router.get('/status', async (req, res) => {
  try {
    const mlHealth = await mlService.healthCheck();
    res.json({
      status: mlHealth?.status || 'operational',
      version: mlHealth?.version || 'v1.0.0',
      last_prediction: mlHealth?.last_prediction,
    });
  } catch (err) {
    LOG.warn('Statut ML indisponible : %s', err.message);
    res.json({ status: 'degraded', version: 'v1.0.0' });
  }
});

// GET /api/admin/ml/models — Liste des modèles ML
router.get('/models', async (req, res, next) => {
  try {
    const db = await cds.connect.to('db');
    const models = await db.run(`
      SELECT * FROM smartorder_MlModels
      ORDER BY trained_at DESC
    `);
    const mlHealth = await mlService.healthCheck();
    res.json({ models, mlService: mlHealth });
  } catch (err) {
    if (csvFallbackEnabled() && isRecoverableDbError(err)) {
      const models = readMlModelsFallback().value;
      const mlHealth = await mlService.healthCheck().catch(() => ({ status: 'degraded', version: 'v1.0.0' }));
      res.set('x-smartorder-data-source', 'csv-fallback');
      return res.json({ models, mlService: mlHealth });
    }
    next(err);
  }
});

// POST /api/admin/ml/retrain — Déclencher réentraînement (UC16)
router.post('/retrain', async (req, res) => {
  const { force = false } = req.body;
  const jobId = uuid();
  const now = new Date().toISOString();

  res.status(202).json({
    jobId,
    message: 'Réentraînement ML démarré. Résultat via WebSocket ML_RETRAIN_COMPLETE.',
    started_at: now,
  });

  // Exécuter en arrière-plan
  _executerRetrain(jobId, force).catch(err =>
    LOG.error('Retrain ML erreur : %s', err.message)
  );
});

async function _executerRetrain(jobId, force) {
  const db = await cds.connect.to('db');
  const io = global._socketIO;
  const startedAt = new Date();

  try {
    // Extraire le dataset depuis PostgreSQL
    const records = await db.run(`
      SELECT
        o.type, o.montant_total, o.urgence,
        (SELECT lc.categorie_article FROM smartorder_LignesCommande lc
         WHERE lc.commande_ID = o.ID ORDER BY lc.numero_poste LIMIT 1) AS categorie_article,
        o.date_creation, o.date_previsionnelle, o.date_livraison_reelle,
        f.code_sap AS fournisseur_code_sap,
        f.taux_retard_moyen, f.delai_moyen_jours,
        p.duree_reelle_jours,
        CASE WHEN o.date_livraison_reelle > o.date_previsionnelle THEN 1 ELSE 0 END AS is_retard
      FROM smartorder_Orders o
      JOIN smartorder_Fournisseurs f ON f.ID = o.fournisseur_ID
      LEFT JOIN smartorder_Predictions p ON p.commande_ID = o.ID
      WHERE o.statut IN ('LIVRE','ANNULE')
      LIMIT 5000
    `);

    LOG.info('Dataset ML extrait : %d enregistrements', records.length);

    if (records.length < 50) {
      throw new Error(`Dataset insuffisant : ${records.length} enregistrements (min 50)`);
    }

    // Appel FastAPI /retrain
    const result = await mlService.triggerRetrain(records, force);
    const endedAt = new Date();
    const dureeS = (endedAt - startedAt) / 1000;

    // Sauvegarder les métriques en BDD
    if (result.success !== false) {
      const pg = isPostgres();
      if (pg) {
        await db.run(`
          INSERT INTO smartorder_MlModels
            (ID, type, version, accuracy, f1_score, mae, r2, dataset_size, trained_at, actif)
          VALUES ($1,'classification',$2,$3,$4,NULL,NULL,$5,$6,true)
        `, [
          uuid(), result.version || 'v2.0.0',
          result.classification_metrics?.accuracy,
          result.classification_metrics?.f1_score,
          records.length,
          endedAt.toISOString(),
        ]);
      } else {
        await db.run(`
          INSERT INTO smartorder_MlModels
            (ID, type, version, accuracy, f1_score, mae, r2, dataset_size, trained_at, actif)
          VALUES (?,'classification',?,?,?,NULL,NULL,?,?,1)
        `, [
          uuid(), result.version || 'v2.0.0',
          result.classification_metrics?.accuracy,
          result.classification_metrics?.f1_score,
          records.length,
          endedAt.toISOString(),
        ]);
      }
    }

    // Notifier via WebSocket
    if (io) {
      io.to('ADMIN').emit('ML_RETRAIN_COMPLETE', {
        jobId,
        version: result.version,
        accuracy: result.classification_metrics?.accuracy,
        f1_score: result.classification_metrics?.f1_score,
        mae: result.regression_metrics?.mae,
        r2: result.regression_metrics?.r2,
        dataset_size: records.length,
        duree_s: dureeS,
      });
    }

    LOG.info('Réentraînement ML terminé — version=%s en %.1fs', result.version, dureeS);
  } catch (err) {
    LOG.error('Réentraînement ML échoué : %s', err.message);
    if (io) io.to('ADMIN').emit('ML_RETRAIN_ERROR', { jobId, error: err.message });
  }
}

module.exports = router;
