'use strict';

const axios = require('axios');
const cds = require('@sap/cds');
const LOG = cds.log('job-scheduler');

// ===========================================================================
// DÉFINITION DES JOBS
// ===========================================================================

/**
 * Retourne la liste des jobs à enregistrer.
 * @param {string} appUrl - URL publique de l'application (ex: https://smartorder.cfapps.eu10.hana.ondemand.com)
 */
function _buildJobDefinitions(appUrl) {
  return [
    {
      name: 'smartorder-sync-sap-delta',
      description: 'Synchronisation DELTA automatique SAP S/4HANA Cloud (toutes les 6h)',
      action: `${appUrl}/api/jobs/sync-sap`,
      active: true,
      httpMethod: 'POST',
      schedules: [
        {
          description: 'Toutes les 6 heures',
          // Syntaxe Job Scheduler : cron standard (minutes hours dom month dow)
          cron: '0 */6 * * *',
          active: true,
        },
      ],
    },
    {
      name: 'smartorder-detect-alertes',
      description: 'Détection automatique des alertes SmartOrder (toutes les 5min)',
      action: `${appUrl}/api/jobs/detect-alertes`,
      active: true,
      httpMethod: 'POST',
      schedules: [
        {
          description: 'Toutes les 5 minutes',
          cron: '*/5 * * * *',
          active: true,
        },
      ],
    },
  ];
}

// ===========================================================================
// CREDENTIALS — Lecture depuis VCAP_SERVICES
// ===========================================================================

/**
 * Lit les credentials du Job Scheduling Service depuis l'environnement BTP.
 * @returns {Object|null} credentials ou null si service non lié
 */
function _getCredentials() {
  try {
    // VCAP_SERVICES est automatiquement défini par Cloud Foundry
    const vcap = JSON.parse(process.env.VCAP_SERVICES || '{}');

    // Le service peut apparaître sous différentes clés selon le plan
    const bindings = vcap['jobscheduler'] || vcap['job-scheduling'] || [];
    if (!bindings.length) {
      LOG.warn('Job Scheduler : service non lié (VCAP_SERVICES vide pour jobscheduler)');
      return null;
    }

    return bindings[0].credentials;
  } catch (err) {
    LOG.error('Job Scheduler : erreur lecture VCAP_SERVICES — %s', err.message);
    return null;
  }
}

// ===========================================================================
// AUTH — Token OAuth2 (client_credentials)
// ===========================================================================

/**
 * Obtient un token OAuth2 via le flux client_credentials.
 * @param {Object} credentials - Credentials du binding Job Scheduler
 * @returns {string} access_token
 */
async function _getAccessToken(credentials) {
  const tokenUrl = `${credentials.uaa.url}/oauth/token`;

  const response = await axios.post(
    tokenUrl,
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: credentials.uaa.clientid,
      client_secret: credentials.uaa.clientsecret,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  return response.data.access_token;
}

// ===========================================================================
// REGISTER — Création / mise à jour des jobs
// ===========================================================================

/**
 * Crée ou met à jour un job dans le Job Scheduling Service.
 *
 * Stratégie :
 *   - PUT  /scheduler/jobs/{name} → si le job existe déjà (200 OK)
 *   - POST /scheduler/jobs        → si le job n'existe pas (404 → création)
 *
 * @param {string} schedulerUrl - URL de base du Job Scheduler
 * @param {string} token        - Access token OAuth2
 * @param {Object} job          - Définition du job
 */
async function _upsertJob(schedulerUrl, token, job) {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  try {
    // Tenter une mise à jour (le job existe déjà)
    await axios.put(`${schedulerUrl}/scheduler/jobs/${job.name}`, job, { headers });
    LOG.info('Job Scheduler ✓ mis à jour : %s', job.name);
  } catch (err) {
    if (err.response?.status === 404) {
      // Job inexistant → création
      await axios.post(`${schedulerUrl}/scheduler/jobs`, job, { headers });
      LOG.info('Job Scheduler ✓ créé : %s', job.name);
    } else {
      // Autre erreur → logguer sans bloquer le démarrage
      LOG.error('Job Scheduler ✗ erreur pour "%s" : %s (HTTP %d)',
        job.name,
        err.response?.data?.message || err.message,
        err.response?.status || 0
      );
    }
  }
}

// ===========================================================================
// EXPORT — Point d'entrée principal
// ===========================================================================

/**
 * Enregistre tous les jobs SmartOrder dans le SAP Job Scheduling Service.
 *
 * Appelé au démarrage du serveur (server.js) uniquement en production
 * (USE_MOCK_SAP !== 'true').
 *
 * @param {string} appUrl - URL publique de l'application Cloud Foundry
 *                          Exemple : https://smartorder-xyz.cfapps.eu10.hana.ondemand.com
 */
async function registerJobs(appUrl) {
  if (!appUrl) {
    LOG.warn('Job Scheduler : appUrl manquant — enregistrement des jobs ignoré.');
    return;
  }

  const credentials = _getCredentials();
  if (!credentials) {
    LOG.warn('Job Scheduler : service non lié — jobs non enregistrés.');
    return;
  }

  LOG.info('Job Scheduler : enregistrement des jobs (appUrl=%s)…', appUrl);

  try {
    const token = await _getAccessToken(credentials);
    const jobs = _buildJobDefinitions(appUrl);

    // Enregistrer chaque job séquentiellement (éviter les races conditions)
    for (const job of jobs) {
      await _upsertJob(credentials.url, token, job);
    }

    LOG.info('Job Scheduler : %d job(s) enregistré(s) avec succès.', jobs.length);
  } catch (err) {
    // Ne pas bloquer le démarrage si le Job Scheduler est inaccessible
    LOG.error('Job Scheduler : échec de l\'enregistrement — %s', err.message);
  }
}

module.exports = { registerJobs };
