'use strict';

const axios = require('axios');
const cds = require('@sap/cds');
const LOG = cds.log('ml-service-client');

const ML_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';
const TIMEOUT_MS = parseInt(process.env.ML_TIMEOUT_MS || '5000');
const CACHE_TTL = parseInt(process.env.PREDICTION_CACHE_TTL_MINUTES || '60') * 60 * 1000;

// ---------------------------------------------------------------------------
// Cache en mémoire (Map : orderId → { prediction, expiresAt })
// ---------------------------------------------------------------------------
const predictionCache = new Map();

function getCached(orderId) {
  const entry = predictionCache.get(orderId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    predictionCache.delete(orderId);
    return null;
  }
  return entry.prediction;
}

function setCache(orderId, prediction) {
  predictionCache.set(orderId, {
    prediction,
    expiresAt: Date.now() + CACHE_TTL,
  });
}

function invalidateCache(orderId) {
  predictionCache.delete(orderId);
}

// ---------------------------------------------------------------------------
// Client HTTP FastAPI
// ---------------------------------------------------------------------------
const mlClient = axios.create({
  baseURL: ML_URL,
  timeout: TIMEOUT_MS,
  headers: { 'Content-Type': 'application/json' },
});

/**
 * Prédiction unitaire (avec cache 1h)
 * @param {Object} feature - FeatureDTO
 * @param {string} [orderId] - ID commande (pour le cache)
 */
async function predict(feature, orderId = null) {
  if (orderId) {
    const cached = getCached(orderId);
    if (cached) {
      LOG.debug('Cache HIT — orderId=%s', orderId);
      return cached;
    }
  }

  try {
    const { data } = await mlClient.post('/predict', feature);
    LOG.info('ML predict → risque=%s score=%.3f', data.risque_label, data.score_composite);
    if (orderId) setCache(orderId, data);
    return data;
  } catch (err) {
    LOG.warn('ML Service indisponible (%s) — fallback heuristique', err.message);
    return _heuristicFallback(feature);
  }
}

/**
 * Prédiction batch (optimisé, sans cache individuel)
 * @param {Object[]} features - Liste de FeatureDTO
 */
async function predictBatch(features) {
  if (!features?.length) return [];
  try {
    const { data } = await mlClient.post('/predict/batch', { features });
    LOG.info('ML batch predict → %d prédictions', data.predictions?.length || 0);
    return data.predictions || [];
  } catch (err) {
    LOG.warn('ML batch indisponible — fallback pour %d features', features.length);
    return features.map(f => _heuristicFallback(f));
  }
}

/**
 * Déclencher le réentraînement des modèles ML (async 202)
 * @param {Object[]} records - Dataset extrait de PostgreSQL
 * @param {boolean} force - Forcer même si métriques insuffisantes
 */
async function triggerRetrain(records, force = false) {
  const { data } = await mlClient.post('/retrain', { records, force });
  return data;
}

/**
 * Santé du ML service
 */
async function healthCheck() {
  try {
    const { data } = await mlClient.get('/health');
    return { available: true, ...data };
  } catch {
    return { available: false, version: 'N/A' };
  }
}

// ---------------------------------------------------------------------------
// Fallback heuristique (si FastAPI est injoignable)
// ---------------------------------------------------------------------------
function _heuristicFallback(feature) {
  const taux = feature.taux_retard_fournisseur || 0;
  const urgenceMap = { NORMALE: 0.3, HAUTE: 0.7, CRITIQUE: 1.0 };
  const urgenceNorm = urgenceMap[feature.urgence] || 0.3;

  let risqueScore, risqueLabel;
  if (taux > 0.25) { risqueScore = 0.75; risqueLabel = 'ELEVE'; }
  else if (taux > 0.12) { risqueScore = 0.55; risqueLabel = 'MOYEN'; }
  else { risqueScore = 0.2; risqueLabel = 'FAIBLE'; }

  const maxMontant = 2_000_000;
  const valeurNorm = Math.min((feature.montant || 0) / maxMontant, 1);
  const scoreComposite = Math.round(
    (0.6 * risqueScore + 0.3 * urgenceNorm + 0.1 * valeurNorm) * 10000
  ) / 10000;

  const prioriteAction = scoreComposite >= 0.8
    ? 'TRAITER_EN_PRIORITE'
    : scoreComposite >= 0.5
      ? 'SURVEILLER'
      : 'ESCALADER';

  return {
    risque_label: risqueLabel,
    risque_score: risqueScore,
    risque_probabilites: {
      faible: risqueLabel === 'FAIBLE' ? risqueScore : 0.1,
      moyen: risqueLabel === 'MOYEN' ? risqueScore : 0.2,
      eleve: risqueLabel === 'ELEVE' ? risqueScore : 0.1,
    },
    duree_estimee_jours: feature.delai_moyen_fournisseur || 7,
    score_composite: scoreComposite,
    priorite_action: prioriteAction,
    suggestion: `[Fallback] Risque ${risqueLabel} basé sur taux retard fournisseur.`,
    modele_version: 'fallback-heuristic',
  };
}

module.exports = { predict, predictBatch, triggerRetrain, healthCheck, invalidateCache };
