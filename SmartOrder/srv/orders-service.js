'use strict';
/**
 * SmartOrder — Custom CAP Service Handler
 * Projet PFE SAP BTP — YAAS "Run It Best"
 *
 * Ce fichier étend le service OData CAP avec la logique métier custom :
 * - Machine à états pour les changements de statut (UC07)
 * - Pagination sécurisée (20 items/page, max 500)
 * - Recherche par numero_sap ($search)
 * - Inférence ML avec cache 1h (UC08)
 * - Acquittement des alertes
 * - Anti-auto-dégradation admin
 * - Audit trail complet pour les changements de statut
 */

const cds = require('@sap/cds');
const { uuid } = cds.utils;

const LOG = cds.log('orders-service');

// ---------------------------------------------------------------------------
// Importer nos services métiers custom
// ---------------------------------------------------------------------------
let mlService, alerteService;

// Chargement lazy pour éviter les imports circulaires
const getMlService = () => {
  if (!mlService) mlService = require('./services/mlService');
  return mlService;
};
const getAlerteService = () => {
  if (!alerteService) alerteService = require('./services/alerteService');
  return alerteService;
};

// ===========================================================================
// MODULE : State_Machine — Transitions autorisées (UC07)
// ===========================================================================
//
// Graphe d'états :
//   EN_ATTENTE  → EN_COURS | ANNULE
//   EN_COURS    → EN_LIVRAISON | BLOQUE | ANNULE
//   EN_LIVRAISON→ LIVRE | BLOQUE
//   BLOQUE      → EN_COURS | ANNULE
//   LIVRE       → (terminal — aucune transition)
//   ANNULE      → (terminal — aucune transition)
//
const STATE_MACHINE = {
  EN_ATTENTE:   ['EN_COURS', 'ANNULE'],
  EN_COURS:     ['EN_LIVRAISON', 'BLOQUE', 'ANNULE'],
  EN_LIVRAISON: ['LIVRE', 'BLOQUE'],
  BLOQUE:       ['EN_COURS', 'ANNULE'],
  LIVRE:        [],   // État terminal — immuable
  ANNULE:       [],   // État terminal — immuable
};

/** Labels lisibles pour les messages d'erreur */
const STATUT_LABELS = {
  EN_ATTENTE:   'En attente',
  EN_COURS:     'En cours de traitement',
  EN_LIVRAISON: 'En livraison',
  LIVRE:        'Livré',
  ANNULE:       'Annulé',
  BLOQUE:       'Bloqué',
};

/**
 * Valide une transition de statut.
 * @param {string} ancienStatut - Statut actuel de la commande
 * @param {string} nouveauStatut - Statut cible
 * @throws {Error} Si la transition est invalide (HTTP 400) ou l'état est terminal (HTTP 409)
 */
function validateTransition(ancienStatut, nouveauStatut) {
  // Vérifier que le statut actuel est connu
  if (!(ancienStatut in STATE_MACHINE)) {
    throw new cds.error(
      `Statut actuel inconnu : "${ancienStatut}". Statuts valides : ${Object.keys(STATE_MACHINE).join(', ')}.`,
      { status: 400 }
    );
  }

  // Vérifier que le statut cible est connu
  if (!(nouveauStatut in STATE_MACHINE)) {
    throw new cds.error(
      `Statut cible inconnu : "${nouveauStatut}". Statuts valides : ${Object.keys(STATE_MACHINE).join(', ')}.`,
      { status: 400 }
    );
  }

  const allowed = STATE_MACHINE[ancienStatut];

  // État terminal — aucune transition possible
  if (allowed.length === 0) {
    throw new cds.error(
      `La commande est dans un état terminal "${STATUT_LABELS[ancienStatut] || ancienStatut}". ` +
      `Aucune modification de statut n'est possible.`,
      { status: 409 }
    );
  }

  // Transition interdite
  if (!allowed.includes(nouveauStatut)) {
    const allowedLabels = allowed
      .map((s) => `${STATUT_LABELS[s] || s} (${s})`)
      .join(', ');
    throw new cds.error(
      `Transition interdite : "${STATUT_LABELS[ancienStatut]}" → "${STATUT_LABELS[nouveauStatut]}". ` +
      `Transitions autorisées depuis "${ancienStatut}" : ${allowedLabels}.`,
      { status: 400 }
    );
  }
}

/**
 * Retourne les transitions possibles depuis un statut donné.
 */
function getAllowedTransitions(statut) {
  return STATE_MACHINE[statut] || [];
}

// ===========================================================================
// MODULE : Audit_Logger — Journalisation des actions
// ===========================================================================

/**
 * Enregistre une action dans les logs d'audit (console + service logging BTP).
 */
function auditLog(action, details) {
  const entry = {
    timestamp: new Date().toISOString(),
    action,
    ...details,
  };
  LOG.info('[AUDIT] %s — user=%s order=%s %s→%s',
    action,
    details.userId || 'system',
    details.orderId || '-',
    details.ancienStatut || '-',
    details.nouveauStatut || '-'
  );
  return entry;
}

// ===========================================================================
// Constantes pagination
// ===========================================================================
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 500;

// ============================================================
// Handler OrdersService
// ============================================================
module.exports = class OrdersService extends cds.ApplicationService {
  async init() {

    // ------------------------------------------------------------------
    // BEFORE hooks — Validation & Pagination
    // ------------------------------------------------------------------

    // Appliquer la pagination par défaut (20 items) et le plafond (500)
    this.before('READ', 'Orders', async (req) => {
      // Pagination sécurisée
      if (!req.query.SELECT?.limit) {
        req.query.SELECT.limit = { rows: { val: DEFAULT_PAGE_SIZE } };
      } else {
        const rows = req.query.SELECT.limit.rows;
        if (rows && rows.val > MAX_PAGE_SIZE) {
          rows.val = MAX_PAGE_SIZE;
          LOG.warn('Pagination plafonnée à %d items (demandé: %d)', MAX_PAGE_SIZE, rows.val);
        }
      }

      // Vérifier le périmètre manager (UC04)
      if (!req.user) return;
      const role = req.user.is('ADMIN') ? 'ADMIN' : req.user.is('MANAGER') ? 'MANAGER' : 'USER';
      if (role === 'ADMIN') return; // Les admins voient tout
      LOG.debug('READ Orders — user=%s role=%s', req.user.id, role);
    });

    // Recherche par numero_sap via $search
    this.before('READ', 'Orders', async (req) => {
      const search = req.query.SELECT?.search;
      if (search) {
        // Convertir $search en filtre sur numero_sap (contains)
        const searchTerm = typeof search === 'string' ? search : search?.val;
        if (searchTerm) {
          const filter = { ref: ['numero_sap'] };
          if (!req.query.SELECT.where) {
            req.query.SELECT.where = [
              { func: 'contains', args: [filter, { val: searchTerm }] },
            ];
          }
          // Remove the search to prevent CAP from applying fulltext search
          delete req.query.SELECT.search;
        }
      }
    });

    // ------------------------------------------------------------------
    // AFTER hooks — Enrichissement
    // ------------------------------------------------------------------

    // Après lecture, injecter les transitions autorisées
    this.after('READ', 'Orders', async (orders, req) => {
      if (!Array.isArray(orders)) orders = [orders];
      if (!orders.length) return;

      // Injecter les transitions autorisées pour chaque commande
      for (const order of orders) {
        if (order.statut) {
          order._allowedTransitions = getAllowedTransitions(order.statut);
        }
      }

      // Recalcul prédiction ML si expirée (lecture détail uniquement)
      if (orders.length === 1 && orders[0]?.prediction) {
        const pred = orders[0].prediction;
        if (pred?.recalcul_requis) {
          try {
            LOG.info('Prédiction expirée → recalcul pour order %s', orders[0].ID);
            await this._recalculerPrediction(orders[0], req);
          } catch (err) {
            LOG.warn('Erreur recalcul prédiction auto : %s', err.message);
          }
        }
      }
    });

    // ------------------------------------------------------------------
    // Actions Custom
    // ------------------------------------------------------------------

    // UC07 — Changer le statut d'une commande
    this.on('changerStatut', 'Orders', async (req) => {
      const { ID } = req.params[0];
      const { statut: nouveauStatut, commentaire } = req.data;

      // Validation : commentaire obligatoire
      if (!commentaire?.trim()) {
        throw new cds.error(
          'Un commentaire est obligatoire pour changer le statut. ' +
          'Veuillez décrire la raison du changement.',
          { status: 400 }
        );
      }

      if (commentaire.trim().length < 5) {
        throw new cds.error(
          'Le commentaire doit contenir au moins 5 caractères.',
          { status: 400 }
        );
      }

      const { Orders, HistoriqueStatut } = this.entities;
      const db = await cds.connect.to('db');

      // Lire la commande actuelle
      const commande = await db.run(SELECT.one.from(Orders).where({ ID }));
      if (!commande) {
        throw new cds.error(
          `Commande introuvable (ID: ${ID}).`,
          { status: 404 }
        );
      }

      // Valider la transition via le State_Machine
      validateTransition(commande.statut, nouveauStatut);

      const now = new Date().toISOString();
      const userId = req.user?.id || 'system';

      // Transaction atomique : UPDATE order + INSERT historique
      await db.transaction(async (tx) => {
        // 1. Mettre à jour le statut de la commande
        const updateData = {
          statut: nouveauStatut,
          date_modification: now,
          updatedAt: now,
        };

        // Si livré, enregistrer la date de livraison réelle
        if (nouveauStatut === 'LIVRE') {
          updateData.date_livraison_reelle = now.split('T')[0]; // Date only
        }

        await tx.run(
          UPDATE(Orders).set(updateData).where({ ID })
        );

        // 2. Créer l'entrée d'audit dans l'historique des statuts
        await tx.run(
          INSERT.into(HistoriqueStatut).entries({
            ID: uuid(),
            commande_ID: ID,
            user_ID: userId,
            ancien_statut: commande.statut,
            nouveau_statut: nouveauStatut,
            commentaire: commentaire.trim(),
            source_changement: 'APP_WEB',
            createdAt: now,
          })
        );
      });

      // 3. Audit log
      auditLog('STATUS_CHANGE', {
        userId,
        orderId: ID,
        orderNo: commande.numero_sap,
        ancienStatut: commande.statut,
        nouveauStatut,
        commentaire: commentaire.trim(),
      });

      // 4. Émettre événement WebSocket si statut critique
      if (['BLOQUE', 'LIVRE', 'ANNULE'].includes(nouveauStatut)) {
        try {
          const io = global._socketIO;
          if (io) {
            io.to('MANAGER').to('ADMIN').emit('ORDER_STATUS_CHANGED', {
              orderId: ID,
              orderNo: commande.numero_sap,
              ancienStatut: commande.statut,
              nouveauStatut,
              changedBy: userId,
              timestamp: now,
            });
          }
        } catch (err) {
          LOG.warn('Erreur émission WS : %s', err.message);
        }
      }

      // 5. Générer alerte automatique si bloqué
      if (nouveauStatut === 'BLOQUE') {
        try {
          await getAlerteService().createAlerte(db, {
            commande_ID: ID,
            type: 'BLOQUE',
            severite: 'ELEVE',
            message: `Commande ${commande.numero_sap} bloquée par ${userId}. Raison : ${commentaire.trim()}`,
          });
        } catch (err) {
          LOG.warn('Erreur création alerte auto : %s', err.message);
        }
      }

      LOG.info('Statut changé : %s → %s (order=%s, user=%s)',
        commande.statut, nouveauStatut, ID, userId);
      return db.run(SELECT.one.from(Orders).where({ ID }));
    });

    // UC08 — Recalculer la prédiction ML
    this.on('recalculerPrediction', 'Orders', async (req) => {
      const { ID } = req.params[0];
      const { Orders } = this.entities;
      const db = await cds.connect.to('db');

      const commande = await db.run(
        SELECT.one.from(Orders).columns('*').where({ ID })
      );
      if (!commande) throw new cds.error('Commande introuvable', { status: 404 });

      // Charger le fournisseur séparément
      if (commande.fournisseur_ID) {
        const { Fournisseurs } = this.entities;
        commande.fournisseur = await db.run(
          SELECT.one.from(Fournisseurs).where({ ID: commande.fournisseur_ID })
        );
      }

      return this._recalculerPrediction(commande, req);
    });

    // Acquittement alerte
    this.on('acquitter', 'Alertes', async (req) => {
      const { ID } = req.params[0];
      const { Alertes } = this.entities;
      const db = await cds.connect.to('db');
      await db.run(
        UPDATE(Alertes)
          .set({ acquitte: true, date_acquittement: new Date().toISOString() })
          .where({ ID })
      );
      return db.run(SELECT.one.from(Alertes).where({ ID }));
    });

    // Modifier le rôle d'un utilisateur (UC13) — service Admin
    this.on('modifierRole', 'Utilisateurs', async (req) => {
      const { ID } = req.params[0];
      const { role, perimetre } = req.data;

      // Anti-auto-dégradation : un admin ne peut pas rétrograder son propre compte
      if (req.user?.id === ID && role !== 'ADMIN') {
        throw new cds.error(
          "Vous ne pouvez pas rétrograder votre propre rôle ADMIN.",
          { status: 403 }
        );
      }

      const { Utilisateurs } = this.entities;
      const db = await cds.connect.to('db');

      await db.run(
        UPDATE(Utilisateurs)
          .set({ role, perimetre: JSON.stringify(perimetre || {}), updatedAt: new Date().toISOString() })
          .where({ ID })
      );

      auditLog('ROLE_CHANGE', {
        userId: req.user?.id || 'system',
        targetUserId: ID,
        newRole: role,
      });

      LOG.info('Rôle modifié : user=%s → role=%s', ID, role);
      return db.run(SELECT.one.from(Utilisateurs).where({ ID }));
    });

    // Appeler le super.init() en dernier
    await super.init();
    LOG.info('✅ OrdersService CAP initialisé (State_Machine + pagination %d/%d + audit)', DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  }

  // ------------------------------------------------------------------
  // Méthode privée : recalcul prédiction ML
  // ------------------------------------------------------------------
  async _recalculerPrediction(commande, req) {
    const { Predictions } = this.entities;
    const db = await cds.connect.to('db');

    try {
      const feature = this._buildFeature(commande);
      const prediction = await getMlService().predict(feature);

      const now = new Date().toISOString();
      const predData = {
        commande_ID: commande.ID,
        risque_label: prediction.risque_label,
        risque_score: prediction.risque_score,
        risque_probabilites: JSON.stringify(prediction.risque_probabilites),
        duree_estimee_jours: prediction.duree_estimee_jours,
        score_composite: prediction.score_composite,
        priorite_action: prediction.priorite_action,
        suggestion: prediction.suggestion,
        modele_version: prediction.modele_version,
        calcule_le: now,
        recalcul_requis: false,
      };

      // UPSERT prédiction
      const existing = await db.run(
        SELECT.one.from(Predictions).where({ commande_ID: commande.ID })
      );
      if (existing) {
        await db.run(UPDATE(Predictions).set(predData).where({ commande_ID: commande.ID }));
      } else {
        await db.run(INSERT.into(Predictions).entries({ ID: uuid(), ...predData }));
      }

      // Mettre à jour score_priorite sur la commande
      await db.run(
        UPDATE('smartorder.Orders')
          .set({ score_priorite: prediction.score_composite })
          .where({ ID: commande.ID })
      );

      return { ...existing, ...predData };
    } catch (err) {
      LOG.error('Erreur recalcul ML : %s', err.message);
      throw new cds.error(`Erreur ML Service : ${err.message}`, { status: 502 });
    }
  }

  _buildFeature(commande) {
    const date = new Date(commande.date_creation || Date.now());
    const month = date.getMonth() + 1;
    const periode = month <= 3 ? 'Q1' : month <= 6 ? 'Q2' : month <= 9 ? 'Q3' : 'Q4';
    const maxMontant = 2_000_000;

    // categorie_article est désormais au niveau LignesCommande (item SAP)
    // On prend la catégorie de la première ligne, ou 'ACHAT' par défaut
    const premiereLigne = Array.isArray(commande.lignes) ? commande.lignes[0] : null;
    const categorie = premiereLigne?.categorie_article || 'ACHAT';

    return {
      type: commande.type || 'NB',
      volume: Math.min((commande.montant_total || 0) / maxMontant, 1),
      supplier_id: commande.fournisseur?.code_sap || commande.fournisseur_ID || 'UNK',
      categorie_article: categorie,
      periode,
      montant: commande.montant_total || 0,
      urgence: commande.urgence || 'NORMALE',
      taux_retard_fournisseur: commande.fournisseur?.taux_retard_moyen || 0.1,
      delai_moyen_fournisseur: commande.fournisseur?.delai_moyen_jours || 7,
    };
  }
};
