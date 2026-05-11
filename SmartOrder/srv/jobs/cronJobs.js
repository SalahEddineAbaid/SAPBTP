'use strict';
/**
 * SmartOrder — Cron Jobs (CAP version)
 * - Sync SAP automatique toutes les 15min
 * - Détection alertes toutes les 5min
 */
const cron = require('node-cron');
const cds  = require('@sap/cds');
const LOG  = cds.log('cron-jobs');

const SYNC_INTERVAL  = process.env.SYNC_CRON_INTERVAL  || '*/15 * * * *';
const ALERT_INTERVAL = process.env.ALERT_CRON_INTERVAL || '*/5 * * * *';

let syncTask  = null;
let alertTask = null;

function startCronJobs() {
  if (process.env.NODE_ENV === 'test') {
    LOG.info('Mode test — cron jobs désactivés');
    return;
  }

  const isProduction = process.env.NODE_ENV === 'production';

  // ------------------------------------------------------------------
  // Job 1 — Synchronisation SAP (15min) — actif uniquement en production
  // ------------------------------------------------------------------
  if (isProduction) {
    syncTask = cron.schedule(SYNC_INTERVAL, async () => {
      LOG.info('⏰ Cron Sync SAP démarré');
      try {
        const syncSAPService = require('../services/syncSAPService');
        const result = await syncSAPService.syncDelta('DELTA');
        LOG.info('Cron Sync OK — créées=%d maj=%d', result.creees, result.mises_a_jour);

        const io = global._socketIO;
        if (io && (result.creees > 0 || result.mises_a_jour > 0)) {
          io.to('ADMIN').emit('SYNC_AUTO_COMPLETE', {
            ...result,
            timestamp: new Date().toISOString(),
          });
        }
      } catch (err) {
        LOG.error('Cron Sync SAP erreur : %s', err.message);
      }
    }, { timezone: 'Europe/Paris' });

    LOG.info('Cron Sync SAP planifié : %s', SYNC_INTERVAL);
  } else {
    LOG.info('Mode développement — Cron Sync SAP désactivé (actif en production uniquement)');
  }

  // ------------------------------------------------------------------
  // Job 2 — Détection alertes (5min) — actif en dev + prod
  // ------------------------------------------------------------------
  alertTask = cron.schedule(ALERT_INTERVAL, async () => {
    LOG.debug('⏰ Cron alertes démarré');
    try {
      const { detecterAlertes } = require('../services/alerteService');
      const count = await detecterAlertes();
      if (count > 0) {
        LOG.info('Cron alertes — %d alerte(s) générée(s)', count);
      }
    } catch (err) {
      LOG.error('Cron alertes erreur : %s', err.message);
    }
  }, { timezone: 'Europe/Paris' });

  LOG.info('Cron alertes planifié : %s', ALERT_INTERVAL);
}

function stopCronJobs() {
  syncTask?.stop();
  alertTask?.stop();
  LOG.info('Cron jobs arrêtés');
}

module.exports = { startCronJobs, stopCronJobs };
