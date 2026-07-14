'use strict';

const cds = require('@sap/cds');
const LOG = cds.log('jobs');

let alertTask = null; // node-cron task (BAS uniquement)

// ===========================================================================
// MODE BAS — node-cron (USE_MOCK_SAP=true)
// ===========================================================================

/**
 * Démarre les jobs in-process via node-cron.
 * Utilisé uniquement en BAS (USE_MOCK_SAP=true).
 *
 * - Sync SAP    : DÉSACTIVÉE (USE_MOCK_SAP → pas d'appel SAP réel nécessaire)
 * - Alertes     : toutes les 5 min pour tester la détection
 */
function _startCronMode() {
  const cron = require('node-cron');
  const ALERT_INTERVAL = process.env.ALERT_CRON_INTERVAL || '*/5 * * * *';

  LOG.info(`Jobs — mode BAS (node-cron) : sync SAP désactivée, alertes=${ALERT_INTERVAL}`);

  alertTask = cron.schedule(ALERT_INTERVAL, async () => {
    LOG.debug('⏰ [cron] Détection alertes démarrée');
    try {
      const { detecterAlertes } = require('../services/alerteService');
      const count = await detecterAlertes();
      if (count > 0) LOG.info('[cron] %d alerte(s) générée(s)', count);
    } catch (err) {
      LOG.error('[cron] Erreur détection alertes : %s', err.message);
    }
  }, { timezone: 'Europe/Paris' });
}

// ===========================================================================
// MODE PRODUCTION — SAP Job Scheduling Service (USE_MOCK_SAP=false)
// ===========================================================================

/**
 * Enregistre les jobs dans le SAP Job Scheduling Service.
 * Le Job Scheduler appellera les endpoints /api/jobs/* selon le planning.
 *
 * @param {string} appUrl - URL publique CF de l'application
 */
async function _startJobSchedulerMode(appUrl) {
  LOG.info('Jobs — mode Production (SAP Job Scheduling Service) : enregistrement…');
  try {
    const { registerJobs } = require('../services/jobSchedulerClient');
    await registerJobs(appUrl);
  } catch (err) {
    // Ne jamais bloquer le démarrage
    LOG.error('Jobs — échec enregistrement Job Scheduler : %s', err.message);
  }
}

// ===========================================================================
// EXPORT — API publique
// ===========================================================================

/**
 * Démarre les jobs selon l'environnement.
 *
 * @param {string} [appUrl] - URL publique de l'app (requis en production).
 *                            En CF, disponible via process.env.VCAP_APPLICATION.
 */
async function startJobs(appUrl) {
  if (process.env.NODE_ENV === 'test') {
    LOG.info('Jobs — mode test : désactivés');
    return;
  }

  if (process.env.USE_MOCK_SAP === 'true') {
    _startCronMode();
  } else {
    await _startJobSchedulerMode(appUrl);
  }
}

/**
 * Arrête les jobs node-cron (BAS uniquement).
 * Sans effet en production (le Job Scheduler est externe).
 */
function stopJobs() {
  alertTask?.stop();
  alertTask = null;
  LOG.info('Jobs — arrêtés (node-cron)');
}

module.exports = { startJobs, stopJobs };
