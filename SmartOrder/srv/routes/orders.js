'use strict';
/**
 * Routes Express CRUD — Commandes (Orders)
 * Projet PFE SAP BTP — YAAS "Run It Best"
 *
 * Ces routes Express fournissent une API REST complémentaire au service OData CAP.
 * Elles permettent aux rôles MANAGER et ADMIN de créer, modifier et supprimer
 * des commandes avec synchronisation automatique vers SAP S/4HANA.
 *
 * Endpoints :
 *   POST   /api/orders           → Créer une commande (MANAGER, ADMIN)
 *   PATCH  /api/orders/:id       → Modifier une commande (MANAGER, ADMIN)
 *   DELETE /api/orders/:id       → Supprimer une commande ANNULÉE (ADMIN)
 *   GET    /api/orders/:id/sync  → Relancer la synchronisation SAP manuellement (ADMIN)
 */

const express = require('express');
const cds     = require('@sap/cds');
const { uuid } = cds.utils;
const crypto  = require('crypto');
const { hasMinimumRole } = require('../utils/authz');

const router = express.Router();
const LOG    = cds.log('orders-route');

// ===========================================================================
// HELPERS — Middleware auth
// ===========================================================================

function isPostgres() {
  const db   = cds.env.requires?.db || {};
  const kind = db.kind || db[process.env.NODE_ENV]?.kind || 'sqlite';
  return kind === 'postgres' || kind === 'postgresql';
}

function p(index) { return isPostgres() ? `$${index}` : '?'; }

/** Vérifie que l'utilisateur a au moins le rôle MANAGER */
function requireManager(req, res, next) {
  const user = req.user;
  if (!hasMinimumRole(user, 'MANAGER')) {
    return res.status(403).json({
      error: 'Accès refusé. Cette opération nécessite le rôle MANAGER ou ADMIN.',
    });
  }
  next();
}

/** Vérifie que l'utilisateur a le rôle ADMIN */
function requireAdmin(req, res, next) {
  const user = req.user;
  if (!hasMinimumRole(user, 'ADMIN')) {
    return res.status(403).json({
      error: 'Accès refusé. Cette opération est réservée aux administrateurs.',
    });
  }
  next();
}

// ===========================================================================
// POST /api/orders — Créer une commande avec sync SAP
// ===========================================================================

/**
 * POST /api/orders
 * Crée une commande dans SmartOrder et la synchronise vers SAP S/4HANA.
 *
 * Body (JSON) :
 *   type             : String(4)   — Type de commande SAP (NB, UB, etc.) — défaut: 'NB'
 *   fournisseur_ID   : UUID        — ID du fournisseur SmartOrder (obligatoire)
 *   company_code     : String(4)   — Code société SAP (obligatoire)
 *   purchasing_org   : String(4)   — Organisation d'achat SAP (obligatoire)
 *   purchasing_group : String(3)   — Groupe d'achat SAP (optionnel)
 *   devise           : String(5)   — Devise (défaut: 'EUR')
 *   urgence          : UrgenceEnum — NORMALE | HAUTE | CRITIQUE (défaut: NORMALE)
 *   date_previsionnelle : Date     — Date de livraison prévue (obligatoire)
 *   date_commande    : Date        — Date métier de la commande (optionnel)
 *   lignes           : Array       — Lignes de commande (optionnel)
 *     code_produit        : String(40)    — Code matière SAP
 *     designation_produit : String(40)    — Désignation
 *     quantite_commandee  : Decimal(15,3) — Quantité
 *     prix_unitaire       : Decimal(15,2) — Prix unitaire
 *     unite               : String(6)     — Unité (défaut: 'PC')
 *     plant               : String(4)     — Site SAP
 *
 * Réponse 201 :
 *   { order: Order, sap: { numero_sap, success, mock } }
 */
router.post('/', requireManager, async (req, res, next) => {
  try {
    const {
      type = 'NB',
      fournisseur_ID,
      company_code,
      purchasing_org,
      purchasing_group,
      devise = 'EUR',
      urgence = 'NORMALE',
      date_previsionnelle,
      date_commande,
      lignes = [],
    } = req.body;

    // Validation des champs obligatoires
    if (!fournisseur_ID)
      return res.status(400).json({ error: 'Le champ fournisseur_ID est obligatoire.' });
    if (!company_code)
      return res.status(400).json({ error: 'Le champ company_code est obligatoire.' });
    if (!purchasing_org)
      return res.status(400).json({ error: 'Le champ purchasing_org est obligatoire.' });
    if (!date_previsionnelle)
      return res.status(400).json({ error: 'La date prévisionnelle de livraison est obligatoire.' });

    const db     = await cds.connect.to('db');
    const userId = req.user?.id || 'system';
    const now    = new Date().toISOString();

    // Charger le fournisseur
    const fournisseur = await db.run(
      `SELECT ID, code_sap, nom FROM smartorder_Fournisseurs WHERE ID = ${p(1)}`,
      [fournisseur_ID]
    );
    if (!fournisseur.length) {
      return res.status(404).json({ error: `Fournisseur introuvable (ID: ${fournisseur_ID}).` });
    }
    const fourni = fournisseur[0];

    // Numéro provisoire
    const draftNum     = `DRAFT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const orderId      = uuid();
    const montant_total = lignes.reduce(
      (sum, l) => sum + ((l.prix_unitaire || 0) * (l.quantite_commandee || 0)), 0
    );

    // 1. Insérer la commande en BDD
    await db.run(
      `INSERT INTO smartorder_Orders
       (ID, numero_sap, type, statut, urgence, date_creation, date_modification,
        date_previsionnelle, date_commande, montant_total, devise, score_priorite,
        company_code, purchasing_org, purchasing_group, marqueur_suppression,
        statut_approbation, postes_en_retard, fournisseur_ID, createdAt, updatedAt)
       VALUES (${p(1)},${p(2)},${p(3)},${p(4)},${p(5)},${p(6)},${p(7)},
               ${p(8)},${p(9)},${p(10)},${p(11)},${p(12)},${p(13)},${p(14)},
               ${p(15)},${p(16)},${p(17)},${p(18)},${p(19)},${p(20)},${p(21)})`,
      [orderId, draftNum, type, 'EN_ATTENTE', urgence,
       now, now, date_previsionnelle,
       date_commande || now.split('T')[0],
       montant_total, devise, 0,
       company_code, purchasing_org, purchasing_group || null,
       false, '', 0, fournisseur_ID, now, now]
    );

    // 2. Insérer les lignes de commande
    for (let i = 0; i < lignes.length; i++) {
      const l = lignes[i];
      await db.run(
        `INSERT INTO smartorder_LignesCommande
         (ID, commande_ID, numero_poste, code_produit, designation_produit,
          quantite_commandee, quantite_livree, prix_unitaire, unite, plant)
         VALUES (${p(1)},${p(2)},${p(3)},${p(4)},${p(5)},${p(6)},${p(7)},${p(8)},${p(9)},${p(10)})`,
        [uuid(), orderId, (i + 1) * 10,
         l.code_produit || 'INCONNU',
         l.designation_produit || null,
         l.quantite_commandee || 1, 0,
         l.prix_unitaire || 0,
         l.unite || 'PC',
         l.plant || null]
      );
    }

    // 3. Historique de création
    await db.run(
      `INSERT INTO smartorder_HistoriqueStatut
       (ID, commande_ID, ancien_statut, nouveau_statut, commentaire, source_changement, createdAt)
       VALUES (${p(1)},${p(2)},${p(3)},${p(4)},${p(5)},${p(6)},${p(7)})`,
      [uuid(), orderId, 'EN_ATTENTE', 'EN_ATTENTE',
       `Commande créée par ${userId}.`, 'APP_WEB', now]
    );

    // 4. Répondre immédiatement (sync SAP en arrière-plan)
    const createdOrder = await db.run(
      `SELECT * FROM smartorder_Orders WHERE ID = ${p(1)}`, [orderId]
    );
    res.status(201).json({
      order: createdOrder[0],
      sap: { pending: true, numero_sap_provisoire: draftNum },
    });

    // 5. Sync SAP (asynchrone)
    _syncCreateToSAP(db, orderId, draftNum, {
      type, company_code, purchasing_org, purchasing_group,
      devise, date_commande: date_commande || now.split('T')[0],
    }, fourni, lignes, userId);

  } catch (err) {
    LOG.error('POST /api/orders erreur : %s', err.message);
    next(err);
  }
});

// ===========================================================================
// PATCH /api/orders/:id — Modifier une commande avec sync SAP
// ===========================================================================

/**
 * PATCH /api/orders/:id
 * Modifie une commande (champs autorisés) et propage vers SAP.
 *
 * Champs modifiables dans SmartOrder :
 *   urgence, date_previsionnelle, purchasing_group, devise
 *
 * Champs propagés vers SAP :
 *   purchasing_group, devise (via PATCH /A_PurchaseOrder)
 */
router.patch('/:id', requireManager, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { urgence, date_previsionnelle, purchasing_group, devise } = req.body;

    const db     = await cds.connect.to('db');
    const now    = new Date().toISOString();

    // Charger la commande actuelle
    const rows = await db.run(
      `SELECT * FROM smartorder_Orders WHERE ID = ${p(1)}`, [id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: `Commande introuvable (ID: ${id}).` });
    }
    const commande = rows[0];

    // Vérifier que la commande n'est pas dans un état terminal
    if (['LIVRE', 'ANNULE'].includes(commande.statut)) {
      return res.status(409).json({
        error: `La commande "${commande.numero_sap}" est dans un état terminal (${commande.statut}). Aucune modification n'est possible.`,
      });
    }

    // Construire les champs à mettre à jour
    const updates = { date_modification: now, updatedAt: now };
    if (urgence)             updates.urgence = urgence;
    if (date_previsionnelle) updates.date_previsionnelle = date_previsionnelle;
    if (purchasing_group)    updates.purchasing_group = purchasing_group;
    if (devise)              updates.devise = devise;

    if (Object.keys(updates).length <= 2) {
      return res.status(400).json({ error: 'Aucun champ modifiable fourni.' });
    }

    // UPDATE en BDD
    const setClauses = Object.keys(updates).map((k, i) => `${k}=${p(i + 1)}`).join(', ');
    await db.run(
      `UPDATE smartorder_Orders SET ${setClauses} WHERE ID = ${p(Object.keys(updates).length + 1)}`,
      [...Object.values(updates), id]
    );

    // Répondre
    const updated = await db.run(`SELECT * FROM smartorder_Orders WHERE ID = ${p(1)}`, [id]);
    res.json({ order: updated[0], sap: { syncing: true } });

    // Sync SAP (asynchrone)
    setImmediate(async () => {
      try {
        const sapWriteService = require('../services/sapWriteService');
        await sapWriteService.updateOrderInSAP(commande.numero_sap, updates);
        LOG.info('PATCH /api/orders/%s — synchronisé vers SAP (%s)', id, commande.numero_sap);
      } catch (err) {
        LOG.warn('PATCH /api/orders/%s — erreur sync SAP : %s', id, err.message);
      }
    });

    // WebSocket
    const io = global._socketIO;
    if (io) {
      io.to('MANAGER').to('ADMIN').emit('ORDER_UPDATED', {
        orderId: id,
        numero_sap: commande.numero_sap,
        timestamp: now,
      });
    }

  } catch (err) {
    LOG.error('PATCH /api/orders/%s erreur : %s', req.params.id, err.message);
    next(err);
  }
});

// ===========================================================================
// DELETE /api/orders/:id — Supprimer une commande ANNULÉE
// ===========================================================================

/**
 * DELETE /api/orders/:id
 * Supprime physiquement une commande SmartOrder (statut ANNULE obligatoire).
 * Marque la commande pour suppression dans SAP avant de supprimer localement.
 */
router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = await cds.connect.to('db');

    // Charger la commande
    const rows = await db.run(
      `SELECT * FROM smartorder_Orders WHERE ID = ${p(1)}`, [id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: `Commande introuvable (ID: ${id}).` });
    }
    const commande = rows[0];

    // Vérifier le statut ANNULE
    if (commande.statut !== 'ANNULE') {
      return res.status(409).json({
        error: `La suppression n'est autorisée que pour les commandes en statut ANNULE. ` +
               `Statut actuel : "${commande.statut}" (commande: ${commande.numero_sap}).`,
      });
    }

    // 1. Marquer pour suppression dans SAP
    let sapResult = { success: true, logicalDelete: true };
    try {
      const sapWriteService = require('../services/sapWriteService');
      sapResult = await sapWriteService.deleteOrderInSAP(commande.numero_sap);
    } catch (sapErr) {
      LOG.warn('DELETE /api/orders/%s — erreur marquage SAP : %s', id, sapErr.message);
      // Non bloquant — on supprime quand même localement
    }

    // 2. Supprimer les entités enfants
    await db.run(`DELETE FROM smartorder_LignesCommande   WHERE commande_ID = ${p(1)}`, [id]);
    await db.run(`DELETE FROM smartorder_Predictions      WHERE commande_ID = ${p(1)}`, [id]);
    await db.run(`DELETE FROM smartorder_Alertes          WHERE commande_ID = ${p(1)}`, [id]);
    await db.run(`DELETE FROM smartorder_HistoriqueStatut WHERE commande_ID = ${p(1)}`, [id]);

    // 3. Supprimer la commande
    await db.run(`DELETE FROM smartorder_Orders WHERE ID = ${p(1)}`, [id]);

    LOG.info('Commande supprimée : ID=%s numero_sap=%s (SAP: logicalDelete=%s)',
      id, commande.numero_sap, sapResult.logicalDelete);

    // 4. WebSocket
    const io = global._socketIO;
    if (io) {
      io.to('MANAGER').to('ADMIN').emit('ORDER_DELETED', {
        orderId: id,
        numero_sap: commande.numero_sap,
        deletedBy: req.user?.id || 'system',
        timestamp: new Date().toISOString(),
      });
    }

    res.json({
      message: `Commande ${commande.numero_sap} supprimée avec succès.`,
      sap: sapResult,
    });

  } catch (err) {
    LOG.error('DELETE /api/orders/%s erreur : %s', req.params.id, err.message);
    next(err);
  }
});

// ===========================================================================
// GET /api/orders/:id/sync — Relancer la sync SAP manuellement
// ===========================================================================

/**
 * GET /api/orders/:id/sync
 * Relit la commande depuis SAP et met à jour la BDD locale.
 * Utile après un conflit ou une désynchronisation.
 */
router.get('/:id/sync', requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = await cds.connect.to('db');

    const rows = await db.run(
      `SELECT numero_sap FROM smartorder_Orders WHERE ID = ${p(1)}`, [id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: `Commande introuvable (ID: ${id}).` });
    }

    const { numero_sap } = rows[0];
    if (!numero_sap || numero_sap.startsWith('DRAFT-')) {
      return res.status(400).json({
        error: 'Cette commande n\'a pas encore de numéro SAP confirmé. Attendez la synchronisation initiale.',
      });
    }

    // Déclencher un sync DELTA ciblé sur cette commande
    const { syncDelta } = require('../services/syncSAPService');
    const result = await syncDelta('DELTA', {});

    res.json({
      message: `Synchronisation SAP relancée pour la commande ${numero_sap}.`,
      result,
    });

  } catch (err) {
    LOG.error('GET /api/orders/%s/sync erreur : %s', req.params.id, err.message);
    next(err);
  }
});

// ===========================================================================
// HELPER PRIVÉ — Sync CREATE vers SAP en arrière-plan
// ===========================================================================

async function _syncCreateToSAP(db, orderId, draftNum, orderData, fournisseur, lignes, userId) {
  try {
    const sapWriteService = require('../services/sapWriteService');
    const lignesBDD = await db.run(
      `SELECT * FROM smartorder_LignesCommande WHERE commande_ID = ${p(1)}`, [orderId]
    );

    const sapResult = await sapWriteService.createOrderInSAP(orderData, fournisseur, lignesBDD);

    // Mettre à jour le numéro SAP confirmé
    if (sapResult.numero_sap && draftNum.startsWith('DRAFT-')) {
      await db.run(
        `UPDATE smartorder_Orders SET numero_sap = ${p(1)}, updatedAt = ${p(2)} WHERE ID = ${p(3)}`,
        [sapResult.numero_sap, new Date().toISOString(), orderId]
      );
      LOG.info('POST /api/orders — numéro SAP confirmé : %s → %s', draftNum, sapResult.numero_sap);
    }

    // WebSocket
    const io = global._socketIO;
    if (io) {
      io.to('MANAGER').to('ADMIN').emit('ORDER_CREATED', {
        orderId,
        numero_sap: sapResult.numero_sap || draftNum,
        mock: sapResult.mock,
        timestamp: new Date().toISOString(),
      });
    }

    LOG.info('POST /api/orders — sync SAP terminée (orderId=%s, numerosap=%s)',
      orderId, sapResult.numero_sap || draftNum);

  } catch (err) {
    LOG.error('POST /api/orders — erreur sync SAP asynchrone : %s', err.message);
  }
}

module.exports = router;
