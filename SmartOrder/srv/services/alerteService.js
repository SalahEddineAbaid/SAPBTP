'use strict';
/**
 * SmartOrder — Alerte Service
 * Détecte les commandes en retard et bloquées → INSERT alertes + WebSocket
 *
 * Base de données : PostgreSQL (SAP BTP — postgresql-db)
 * En développement BAS (USE_MOCK_SAP=true) : la détection automatique est désactivée.
 * Les alertes manuelles (createAlerte) restent disponibles via l'API.
 */

const cds = require('@sap/cds');
const { uuid } = cds.utils;
const LOG = cds.log('alerte-service');

/**
 * Détecte automatiquement les alertes (appelé par le Job Scheduler toutes les 5 min).
 * - Retards : date_previsionnelle dépassée, statut actif
 *   Sévérité :  >7j = CRITIQUE, 3-7j = ELEVE, <3j = MOYEN
 * - Bloquées : statut BLOQUE depuis >3 jours, sévérité ELEVE
 * - Anti-duplicata : pas d'alerte du même type pour la même commande dans les 24h
 */
async function detecterAlertes() {
  // En mode BAS/mock, ne pas exécuter les requêtes SQL complexes
  // (pas de connexion PostgreSQL disponible en développement local)
  if (process.env.USE_MOCK_SAP === 'true') {
    LOG.debug('USE_MOCK_SAP=true — détection alertes ignorée en mode BAS');
    return 0;
  }

  const db = await cds.connect.to('db');
  const io = global._socketIO;

  let alertesCreees = 0;

  try {
    // ── 1. Commandes en retard ────────────────────────────────────────────────
    const retards = await db.run(`
        SELECT o.ID, o.numero_sap, o.urgence, o.fournisseur_ID,
               f.nom AS fournisseur_nom,
               ROUND(
                 EXTRACT(EPOCH FROM (NOW() - o.date_previsionnelle::timestamp)) / 86400
               , 1) AS jours_retard,
               p.risque_label, p.suggestion
        FROM smartorder_Orders o
        JOIN smartorder_Fournisseurs f ON f.ID = o.fournisseur_ID
        LEFT JOIN smartorder_Predictions p ON p.commande_ID = o.ID
        WHERE o.statut NOT IN ('LIVRE','ANNULE','BLOQUE')
          AND o.date_previsionnelle < CURRENT_DATE
          AND NOT EXISTS (
            SELECT 1 FROM smartorder_Alertes a
            WHERE a.commande_ID = o.ID
              AND a.type = 'RETARD'
              AND a.date_creation > NOW() - INTERVAL '24 hours'
          )
        LIMIT 50
      `);

    for (const cmd of retards) {
      const jours = parseFloat(cmd.jours_retard) || 0;
      const severite = jours > 7 ? 'CRITIQUE' : jours > 3 ? 'ELEVE' : 'MOYEN';
      const now = new Date().toISOString();

      await db.run(`
        INSERT INTO smartorder_Alertes
          (ID, commande_ID, type, severite, message, details, lu, acquitte,
           destinataires_roles, date_creation)
        VALUES ($1,$2,'RETARD',$3,$4,$5,false,false,$6,$7)
      `, [
        uuid(), cmd.ID, severite,
        `Commande ${cmd.numero_sap} en retard de ${jours} jour(s).`,
        JSON.stringify({ jours_retard: jours, fournisseur: cmd.fournisseur_nom }),
        JSON.stringify(['MANAGER', 'ADMIN']),
        now,
      ]);

      if (io) {
        io.to('MANAGER').to('ADMIN').emit('ORDER_DELAYED', {
          orderId:     cmd.ID,
          orderNo:     cmd.numero_sap,
          daysLate:    jours,
          severite,
          fournisseur: cmd.fournisseur_nom,
          suggestion:  cmd.suggestion || 'Contacter le fournisseur.',
          timestamp:   new Date().toISOString(),
        });
      }
      alertesCreees++;
    }

    // ── 2. Commandes bloquées depuis > 3 jours ────────────────────────────────
    const bloquees = await db.run(`
        SELECT o.ID, o.numero_sap,
               ROUND(
                 EXTRACT(EPOCH FROM (NOW() - o.date_modification::timestamp)) / 86400
               , 1) AS jours_bloques
        FROM smartorder_Orders o
        WHERE o.statut = 'BLOQUE'
          AND o.date_modification < NOW() - INTERVAL '3 days'
          AND NOT EXISTS (
            SELECT 1 FROM smartorder_Alertes a
            WHERE a.commande_ID = o.ID
              AND a.type = 'BLOQUE'
              AND a.date_creation > NOW() - INTERVAL '24 hours'
          )
        LIMIT 50
      `);

    for (const cmd of bloquees) {
      const jours = parseFloat(cmd.jours_bloques) || 0;
      const now = new Date().toISOString();

      await db.run(`
        INSERT INTO smartorder_Alertes
          (ID, commande_ID, type, severite, message, details, lu, acquitte,
           destinataires_roles, date_creation)
        VALUES ($1,$2,'BLOQUE','ELEVE',$3,$4,false,false,$5,$6)
      `, [
        uuid(), cmd.ID,
        `Commande ${cmd.numero_sap} bloquée depuis ${jours} jour(s).`,
        JSON.stringify({ jours_bloques: jours }),
        JSON.stringify(['MANAGER', 'ADMIN']),
        now,
      ]);

      if (io) {
        io.to('MANAGER').to('ADMIN').emit('ORDER_BLOCKED', {
          orderId:   cmd.ID,
          orderNo:   cmd.numero_sap,
          daysSince: jours,
          statut:    'BLOQUE',
          timestamp: new Date().toISOString(),
        });
      }
      alertesCreees++;
    }

    if (alertesCreees > 0) {
      LOG.info('%d alerte(s) créée(s) et émises via WebSocket', alertesCreees);
    }
  } catch (err) {
    LOG.error('Erreur détection alertes : %s', err.message);
  }

  return alertesCreees;
}

/**
 * Crée une alerte manuellement (appel programmatique).
 * Utilisé par orders-service.js lors d'un changement de statut vers BLOQUE, etc.
 *
 * @param {Object} db - Connexion CDS DB
 * @param {Object} params - { commande_ID, type, severite, message, details? }
 * @returns {string} ID de l'alerte créée
 */
async function createAlerte(db, params) {
  const { commande_ID, type, severite, message, details } = params;

  // Anti-duplicata : vérifier si une alerte identique existe dans la dernière heure
  const existing = await db.run(`
      SELECT 1 FROM smartorder_Alertes
      WHERE commande_ID = $1
        AND type = $2
        AND date_creation > NOW() - INTERVAL '1 hour'
      LIMIT 1
    `, [commande_ID, type]);

  if (existing.length > 0) {
    LOG.debug('Alerte dupliquée ignorée : type=%s commande=%s', type, commande_ID);
    return null;
  }

  const alerteId = uuid();
  const now = new Date().toISOString();

  await db.run(`
    INSERT INTO smartorder_Alertes
      (ID, commande_ID, type, severite, message, details, lu, acquitte,
       destinataires_roles, date_creation)
    VALUES ($1,$2,$3,$4,$5,$6,false,false,$7,$8)
  `, [
    alerteId, commande_ID, type, severite, message,
    JSON.stringify(details || {}),
    JSON.stringify(['MANAGER', 'ADMIN']),
    now,
  ]);

  const io = global._socketIO;
  if (io) {
    const eventName = type === 'RETARD' ? 'ORDER_DELAYED'
                    : type === 'BLOQUE' ? 'ORDER_BLOCKED'
                    : 'ALERT_CREATED';
    io.to('MANAGER').to('ADMIN').emit(eventName, {
      alerteId,
      commande_ID,
      type,
      severite,
      message,
      timestamp: new Date().toISOString(),
    });
  }

  LOG.info('Alerte créée : type=%s severite=%s commande=%s', type, severite, commande_ID);
  return alerteId;
}

module.exports = { detecterAlertes, createAlerte };
