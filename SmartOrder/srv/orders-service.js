'use strict';

const cds = require('@sap/cds');
const { uuid } = cds.utils;
const { getEffectiveRole, hasMinimumRole } = require('./utils/authz');
const { csvFallbackEnabled, isRecoverableDbError, readOrdersFallback } = require('./utils/csvFallback');

const LOG = cds.log('orders-service');

function getReadSourceMode() {
  const mode = String(process.env.SMARTORDER_READ_SOURCE || 'auto').trim().toLowerCase();
  if (['postgres', 'db', 'neon'].includes(mode)) return 'postgres';
  if (['csv', 'fallback', 'csv-fallback', 'force-read'].includes(mode)) return 'csv';
  return 'auto';
}

function isCsvReadForced() {
  return getReadSourceMode() === 'csv'
    || String(process.env.SMARTORDER_CSV_FALLBACK_MODE || '').trim().toLowerCase() === 'force-read';
}

// ---------------------------------------------------------------------------
// Importer nos services métiers custom
// ---------------------------------------------------------------------------
let mlService, alerteService, sapWriteService;

// Chargement lazy pour éviter les imports circulaires
const getMlService = () => {
  if (!mlService) mlService = require('./services/mlService');
  return mlService;
};
const getAlerteService = () => {
  if (!alerteService) alerteService = require('./services/alerteService');
  return alerteService;
};
const getSapWriteService = () => {
  if (!sapWriteService) sapWriteService = require('./services/sapWriteService');
  return sapWriteService;
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
  EN_ATTENTE: ['EN_COURS', 'ANNULE'],
  EN_COURS: ['EN_LIVRAISON', 'BLOQUE', 'ANNULE'],
  EN_LIVRAISON: ['LIVRE', 'BLOQUE'],
  BLOQUE: ['EN_COURS', 'ANNULE'],
  LIVRE: [],   // État terminal — immuable
  ANNULE: [],   // État terminal — immuable
};

/** Labels lisibles pour les messages d'erreur */
const STATUT_LABELS = {
  EN_ATTENTE: 'En attente',
  EN_COURS: 'En cours de traitement',
  EN_LIVRAISON: 'En livraison',
  LIVRE: 'Livré',
  ANNULE: 'Annulé',
  BLOQUE: 'Bloqué',
};

/**
 * Valide une transition de statut.
 * @param {string} ancienStatut - Statut actuel de la commande
 * @param {string} nouveauStatut - Statut cible
 * @throws {Error} Si la transition est invalide (HTTP 400) ou l'état est terminal (HTTP 409)
 */
function getBoundOrderId(req) {
  const fromParams = req.params?.[0]?.ID;
  if (fromParams) return fromParams;

  const fromData = req.data?.ID;
  if (fromData) return fromData;

  const url = req._?.req?.url || req.http?.req?.url || '';
  const match = url.match(/Orders\(([^)]+)\)/);
  if (!match) return undefined;

  return decodeURIComponent(match[1])
    .replace(/^ID=/, '')
    .replace(/^guid'/, '')
    .replace(/^'/, '')
    .replace(/'$/, '');
}

function getBoundEntityId(req, entityName) {
  const fromParams = req.params?.[0]?.ID;
  if (fromParams) return fromParams;

  const fromData = req.data?.ID;
  if (fromData) return fromData;

  const url = req._?.req?.url || req.http?.req?.url || '';
  const match = url.match(new RegExp(`${entityName}\\(([^)]+)\\)`));
  if (!match) return undefined;

  return decodeURIComponent(match[1])
    .replace(/^ID=/, '')
    .replace(/^guid'/, '')
    .replace(/^'/, '')
    .replace(/'$/, '');
}

function deriveApprovalStatus(currentApprovalStatus, nouveauStatut) {
  const current = currentApprovalStatus || '';

  if (nouveauStatut === 'EN_ATTENTE') return current === 'R' ? 'R' : '';
  if (nouveauStatut === 'ANNULE') return 'R';
  if (['EN_COURS', 'EN_LIVRAISON', 'LIVRE', 'BLOQUE'].includes(nouveauStatut)) return 'X';

  return current;
}

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

function getReadLimit(req) {
  const limit = req.query?.SELECT?.limit;
  return {
    top: Number(limit?.rows?.val || DEFAULT_PAGE_SIZE),
    skip: Number(limit?.offset?.val || 0),
  };
}

function getStatusFilter(req) {
  const where = req.query?.SELECT?.where || [];
  for (let i = 0; i < where.length - 2; i += 1) {
    const left = where[i];
    const operator = where[i + 1];
    const right = where[i + 2];
    if (left?.ref?.[0] === 'statut' && operator === '=' && right?.val) {
      return right.val;
    }
  }
  return null;
}

function getReadOrderId(req) {
  return req.params?.[0]?.ID || req.data?.ID;
}

function ordersFallbackResult(req) {
  const orderId = getReadOrderId(req);
  const { top, skip } = getReadLimit(req);
  const result = readOrdersFallback({
    top: orderId ? Number.MAX_SAFE_INTEGER : top,
    skip: orderId ? 0 : skip,
    filterStatus: getStatusFilter(req),
  });

  if (orderId) {
    return result.value.find((order) => order.ID === orderId) || null;
  }

  const rows = result.value;
  rows.$count = result['@odata.count'];
  return rows;
}

// ============================================================
// Handler OrdersService
// ============================================================
module.exports = class OrdersService extends cds.ApplicationService {
  async init() {

    if (this.name === 'AdminService') {
      this.before('*', async (req) => {
        if (!hasMinimumRole(req.user, 'ADMIN')) {
          return req.error(403, 'Acces reserve aux administrateurs.');
        }
      });
    }

    if (this.name === 'OrdersService') {
      this.before('READ', ['Orders', 'Fournisseurs'], async (req) => {
        if (!getEffectiveRole(req.user)) {
          return req.error(403, 'Acces refuse. Un role SmartOrder USER, MANAGER ou ADMIN est requis.');
        }
      });

      this.before('READ', ['Predictions', 'HistoriqueStatut', 'Utilisateurs'], async (req) => {
        if (!hasMinimumRole(req.user, 'MANAGER')) {
          return req.error(403, 'Acces reserve aux managers et administrateurs.');
        }
      });
    }

    // ------------------------------------------------------------------
    // BEFORE hooks — Validation CREATE/UPDATE/DELETE + Pagination
    // ------------------------------------------------------------------

    // BEFORE CREATE — Validation des champs obligatoires
    this.before('CREATE', 'Orders', async (req) => {
      const { fournisseur_ID, company_code, purchasing_org, date_previsionnelle } = req.data;

      if (!fournisseur_ID)
        return req.error(400, 'Le champ fournisseur_ID est obligatoire.');
      if (!company_code)
        return req.error(400, 'Le champ company_code est obligatoire.');
      if (!purchasing_org)
        return req.error(400, 'Le champ purchasing_org est obligatoire.');
      if (!date_previsionnelle)
        return req.error(400, 'La date prévisionnelle de livraison est obligatoire.');

      // Assigner un numéro provisoire si absent
      if (!req.data.numero_sap) {
        req.data.numero_sap = `DRAFT-${require('crypto').randomBytes(4).toString('hex').toUpperCase()}`;
      }

      // Valeurs par défaut
      const now = new Date().toISOString();
      req.data.statut = req.data.statut || 'EN_ATTENTE';
      req.data.urgence = req.data.urgence || 'NORMALE';
      req.data.devise = req.data.devise || 'EUR';
      req.data.type = req.data.type || 'NB';
      req.data.date_creation = req.data.date_creation || now;
      req.data.date_modification = now;
      req.data.date_commande = req.data.date_commande || now.split('T')[0];
      req.data.montant_total = req.data.montant_total || 0;
      req.data.score_priorite = 0;
      req.data.postes_en_retard = 0;
      req.data.marqueur_suppression = false;
      req.data.statut_approbation = '';
      req.data.createdAt = now;
      req.data.updatedAt = now;
    });

    // BEFORE UPDATE — Bloquer les modifications sur états terminaux
    this.before('UPDATE', 'Orders', async (req) => {
      const ID = req.params?.[0]?.ID || req.data?.ID;
      if (!ID) return;

      const db = await cds.connect.to('db');
      const commande = await db.run(
        SELECT.one.from('smartorder.Orders').columns('statut', 'numero_sap').where({ ID })
      );

      if (!commande) return req.error(404, `Commande introuvable (ID: ${ID}).`);

      // Les états terminaux sont immuables (sauf changerStatut qui a sa propre logique)
      if (['LIVRE', 'ANNULE'].includes(commande.statut)) {
        // Autoriser uniquement la mise à jour du marqueur_suppression par le handler DELETE
        const keysUpdated = Object.keys(req.data).filter(k => k !== 'marqueur_suppression' && k !== 'updatedAt');
        if (keysUpdated.length > 0) {
          return req.error(409,
            `La commande "${commande.numero_sap}" est dans un état terminal (${commande.statut}). Aucune modification n'est possible.`
          );
        }
      }

      req.data.date_modification = new Date().toISOString();
      req.data.updatedAt = new Date().toISOString();
    });

    // BEFORE DELETE — Vérifier que la commande est en statut ANNULE
    this.before('DELETE', 'Orders', async (req) => {
      const ID = req.params?.[0]?.ID;
      if (!ID) return;

      // Vérifier le rôle ADMIN
      if (!hasMinimumRole(req.user, 'ADMIN')) {
        return req.error(403, 'La suppression d\'une commande est réservée aux administrateurs.');
      }

      const db = await cds.connect.to('db');
      const commande = await db.run(
        SELECT.one.from('smartorder.Orders').columns('statut', 'numero_sap').where({ ID })
      );

      if (!commande) return req.error(404, `Commande introuvable (ID: ${ID}).`);

      if (commande.statut !== 'ANNULE') {
        return req.error(409,
          `La suppression n'est autorisée que pour les commandes en statut ANNULE. ` +
          `Statut actuel : "${commande.statut}" (commande: ${commande.numero_sap}).`
        );
      }
    });

    // ------------------------------------------------------------------
    // AFTER hooks — Sync SAP post-opération
    // ------------------------------------------------------------------

    // AFTER CREATE — Synchroniser la nouvelle commande vers SAP S/4HANA
    this.after('CREATE', 'Orders', async (result, req) => {
      if (!result || !result.ID) return;

      const orderId = result.ID;
      const db = await cds.connect.to('db');

      // Charger le fournisseur pour obtenir son code_sap
      let fournisseur = null;
      if (result.fournisseur_ID) {
        fournisseur = await db.run(
          SELECT.one.from('smartorder.Fournisseurs')
            .columns('ID', 'code_sap', 'nom')
            .where({ ID: result.fournisseur_ID })
        );
      }

      // Charger les lignes de commande
      const lignes = await db.run(
        SELECT.from('smartorder.LignesCommande').where({ commande_ID: orderId })
      );

      // Synchroniser vers SAP (asynchrone — ne bloque pas la réponse)
      setImmediate(async () => {
        try {
          const sapResult = await getSapWriteService().createOrderInSAP(
            result, fournisseur, lignes
          );

          // Si SAP a retourné un vrai numéro de commande, mettre à jour
          if (sapResult.numero_sap && result.numero_sap?.startsWith('DRAFT-')) {
            await db.run(
              UPDATE('smartorder.Orders')
                .set({ numero_sap: sapResult.numero_sap, updatedAt: new Date().toISOString() })
                .where({ ID: orderId })
            );
            LOG.info('Numéro SAP confirmé : %s → %s (order=%s)',
              result.numero_sap, sapResult.numero_sap, orderId);
          }

          // Émettre WebSocket ORDER_CREATED
          const io = global._socketIO;
          if (io) {
            io.to('MANAGER').to('ADMIN').emit('ORDER_CREATED', {
              orderId,
              numero_sap: sapResult.numero_sap || result.numero_sap,
              mock: sapResult.mock,
              timestamp: new Date().toISOString(),
            });
          }

          // Lancer recalcul prédiction ML (asynchrone)
          try {
            const commandeComplete = await db.run(
              SELECT.one.from('smartorder.Orders').where({ ID: orderId })
            );
            if (commandeComplete) await this._recalculerPrediction(commandeComplete, req);
          } catch (mlErr) {
            LOG.warn('Erreur recalcul ML après CREATE : %s', mlErr.message);
          }

        } catch (err) {
          LOG.error('Erreur sync SAP après CREATE order=%s : %s', orderId, err.message);
        }
      });
    });

    // AFTER UPDATE — Synchroniser les modifications vers SAP S/4HANA
    this.after('UPDATE', 'Orders', async (result, req) => {
      if (!result) return;

      const ID = req.params?.[0]?.ID || result.ID;
      if (!ID) return;

      const db = await cds.connect.to('db');
      const commande = await db.run(
        SELECT.one.from('smartorder.Orders').columns('numero_sap').where({ ID })
      );

      if (!commande?.numero_sap) return;

      // Synchroniser les champs SAP-compatibles vers SAP (asynchrone)
      setImmediate(async () => {
        try {
          await getSapWriteService().updateOrderInSAP(commande.numero_sap, req.data);
          LOG.info('Commande %s synchronisée vers SAP après UPDATE', commande.numero_sap);
        } catch (err) {
          LOG.warn('Erreur sync SAP après UPDATE order=%s : %s', commande.numero_sap, err.message);
        }
      });

      // Émettre WebSocket ORDER_UPDATED
      const io = global._socketIO;
      if (io) {
        io.to('MANAGER').to('ADMIN').emit('ORDER_UPDATED', {
          orderId: ID,
          numero_sap: commande.numero_sap,
          timestamp: new Date().toISOString(),
        });
      }
    });

    // AFTER DELETE — Marquage suppression SAP + notification WebSocket
    this.after('DELETE', 'Orders', async (_, req) => {
      const ID = req.params?.[0]?.ID;
      if (!ID) return;

      // Émettre WebSocket ORDER_DELETED
      const io = global._socketIO;
      if (io) {
        io.to('MANAGER').to('ADMIN').emit('ORDER_DELETED', {
          orderId: ID,
          deletedBy: req.user?.id || 'system',
          timestamp: new Date().toISOString(),
        });
      }
    });

    // ------------------------------------------------------------------
    // BEFORE hooks — Validation & Pagination
    // ------------------------------------------------------------------

    // Appliquer la pagination par défaut (20 items) et le plafond (500)
    this.on('READ', 'Orders', async (req, next) => {
      if (csvFallbackEnabled() && isCsvReadForced()) {
        LOG.info('READ Orders via CSV fallback forcé (SMARTORDER_READ_SOURCE=csv)');
        return ordersFallbackResult(req);
      }

      try {
        return await next();
      } catch (err) {
        if (!csvFallbackEnabled() || (!isCsvReadForced() && !isRecoverableDbError(err))) {
          throw err;
        }

        LOG.warn('READ Orders PostgreSQL indisponible/incomplet (%s) - fallback CSV actif', err.message);
        return ordersFallbackResult(req);
      }
    });

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
      const role = getEffectiveRole(req.user) || 'USER';

      if (role === 'ADMIN') return; // Les admins voient tout

      if (role === 'MANAGER') {
        // Récupérer le périmètre du manager
        const db = await cds.connect.to('db');

        try {
          const manager = await db.run(
            SELECT.one.from('smartorder.Utilisateurs').where({
              xsuaa_user_id: req.user.id
            }).or({ username: req.user.id })
          );

          if (manager?.perimetre) {
            const perimetre = JSON.parse(manager.perimetre);

            // Filtrer par company_code
            if (perimetre.company_codes?.length > 0) {
              const companyFilter = {
                func: 'in',
                args: [
                  { ref: ['company_code'] },
                  { list: perimetre.company_codes.map(code => ({ val: code })) }
                ]
              };

              if (!req.query.SELECT.where) {
                req.query.SELECT.where = [companyFilter];
              } else {
                req.query.SELECT.where = [
                  ...req.query.SELECT.where,
                  'and',
                  companyFilter
                ];
              }

              LOG.info('Filtrage périmètre MANAGER : user=%s company_codes=%s',
                req.user.id, perimetre.company_codes.join(','));
            }

            // Filtrer par purchasing_org
            if (perimetre.purchasing_orgs?.length > 0) {
              const orgFilter = {
                func: 'in',
                args: [
                  { ref: ['purchasing_org'] },
                  { list: perimetre.purchasing_orgs.map(org => ({ val: org })) }
                ]
              };

              if (!req.query.SELECT.where) {
                req.query.SELECT.where = [orgFilter];
              } else {
                req.query.SELECT.where = [
                  ...req.query.SELECT.where,
                  'and',
                  orgFilter
                ];
              }
            }
          }
        } catch (err) {
          LOG.warn('Erreur récupération périmètre MANAGER : %s', err.message);
        }
      }

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
      if (!hasMinimumRole(req.user, 'MANAGER')) {
        return req.error(403, 'Changement de statut reserve aux managers et administrateurs.');
      }

      const ID = getBoundOrderId(req);
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

      if (commande.statut_approbation === 'R' && nouveauStatut !== 'ANNULE') {
        throw new cds.error(
          'La commande est rejetée côté approbation. Elle doit rester annulée/rejetée ou être retraitée via un nouveau cycle d’approbation.',
          { status: 409 }
        );
      }

      const now = new Date().toISOString();
      const userId = req.user?.id || 'system';
      const utilisateur = await db.run(
        SELECT.one.from('smartorder.Utilisateurs')
          .columns('ID')
          .where({ xsuaa_user_id: userId })
          .or({ username: userId })
      );

      {
        // 1. Mettre à jour le statut de la commande
        const nextApprovalStatus = deriveApprovalStatus(commande.statut_approbation, nouveauStatut);
        const updateData = {
          statut: nouveauStatut,
          statut_approbation: nextApprovalStatus,
          date_modification: now,
          updatedAt: now,
        };

        // Si livré, enregistrer la date de livraison réelle
        if (nouveauStatut === 'LIVRE') {
          updateData.date_livraison_reelle = now.split('T')[0]; // Date only
        }

        await db.run(
          UPDATE(Orders).set(updateData).where({ ID })
        );

        // 2. Créer l'entrée d'audit dans l'historique des statuts
        await db.run(
          INSERT.into(HistoriqueStatut).entries({
            ID: uuid(),
            commande_ID: ID,
            user_ID: utilisateur?.ID,
            ancien_statut: commande.statut,
            nouveau_statut: nouveauStatut,
            commentaire: commentaire.trim(),
            source_changement: 'APP_WEB',
            createdAt: now,
          })
        );
      }

      // 3. Audit log
      auditLog('STATUS_CHANGE', {
        userId,
        orderId: ID,
        orderNo: commande.numero_sap,
        ancienStatut: commande.statut,
        nouveauStatut,
        ancienStatutApprobation: commande.statut_approbation || 'EN_ATTENTE',
        nouveauStatutApprobation: deriveApprovalStatus(commande.statut_approbation, nouveauStatut) || 'EN_ATTENTE',
        commentaire: commentaire.trim(),
      });

      // 4. Propager le changement de statut vers SAP S/4HANA (asynchrone)
      setImmediate(async () => {
        try {
          const sapResult = await getSapWriteService().propagateStatusToSAP(
            commande.numero_sap, nouveauStatut
          );
          if (sapResult.sapAction) {
            LOG.info('Statut propagé vers SAP : order=%s statut=%s action=%s',
              commande.numero_sap, nouveauStatut, sapResult.sapAction);
          }
        } catch (err) {
          LOG.warn('Erreur propagation statut SAP : order=%s : %s', commande.numero_sap, err.message);
        }
      });

      // 5. Émettre événement WebSocket si statut critique
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

      // 6. Générer alerte automatique si bloqué
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
      if (!hasMinimumRole(req.user, 'MANAGER')) {
        return req.error(403, 'Recalcul ML reserve aux managers et administrateurs.');
      }

      const ID = getBoundOrderId(req);
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
      if (!hasMinimumRole(req.user, 'MANAGER')) {
        return req.error(403, 'Acquittement reserve aux managers et administrateurs.');
      }

      const ID = getBoundEntityId(req, 'Alertes');
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
      if (!hasMinimumRole(req.user, 'ADMIN')) {
        return req.error(403, 'Modification des roles reservee aux administrateurs.');
      }

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

    // ── Action unbound : createOrder (avec sync SAP) ──────────────────────────
    this.on('createOrder', async (req) => {
      if (!hasMinimumRole(req.user, 'MANAGER')) {
        return req.error(403, 'Creation de commande reservee aux managers et administrateurs.');
      }

      const {
        type = 'NB', fournisseur_ID, company_code, purchasing_org, purchasing_group,
        devise = 'EUR', urgence = 'NORMALE', date_previsionnelle, date_commande, lignes = []
      } = req.data;

      // Validation
      if (!fournisseur_ID) return req.error(400, 'fournisseur_ID est obligatoire.');
      if (!company_code) return req.error(400, 'company_code est obligatoire.');
      if (!purchasing_org) return req.error(400, 'purchasing_org est obligatoire.');
      if (!date_previsionnelle) return req.error(400, 'date_previsionnelle est obligatoire.');

      const db = await cds.connect.to('db');
      const { Orders, LignesCommande, HistoriqueStatut } = this.entities;
      const userId = req.user?.id || 'system';
      const now = new Date().toISOString();

      // Charger le fournisseur
      const fournisseur = await db.run(
        SELECT.one.from('smartorder.Fournisseurs')
          .columns('ID', 'code_sap', 'nom')
          .where({ ID: fournisseur_ID })
      );
      if (!fournisseur) return req.error(404, `Fournisseur introuvable (ID: ${fournisseur_ID}).`);

      // Numéro provisoire
      const draftNum = `DRAFT-${require('crypto').randomBytes(4).toString('hex').toUpperCase()}`;
      const orderId = uuid();

      // Calculer montant total depuis les lignes
      const montant_total = lignes.reduce(
        (sum, l) => sum + ((l.prix_unitaire || 0) * (l.quantite_commandee || 0)), 0
      );

      // 1. Insérer en BDD locale
      await db.run(
        INSERT.into(Orders).entries({
          ID: orderId,
          numero_sap: draftNum,
          type, statut: 'EN_ATTENTE', urgence,
          date_creation: now,
          date_modification: now,
          date_previsionnelle,
          date_commande: date_commande || now.split('T')[0],
          montant_total,
          devise, score_priorite: 0,
          company_code, purchasing_org, purchasing_group,
          marqueur_suppression: false, statut_approbation: '',
          postes_en_retard: 0,
          fournisseur_ID,
          createdAt: now, updatedAt: now,
        })
      );

      // 2. Insérer les lignes de commande
      for (let i = 0; i < lignes.length; i++) {
        const l = lignes[i];
        await db.run(
          INSERT.into(LignesCommande).entries({
            ID: uuid(),
            commande_ID: orderId,
            numero_poste: (i + 1) * 10,
            code_produit: l.code_produit || 'INCONNU',
            designation_produit: l.designation_produit || null,
            quantite_commandee: l.quantite_commandee || 1,
            quantite_livree: 0,
            prix_unitaire: l.prix_unitaire || 0,
            unite: l.unite || 'PC',
            plant: l.plant || null,
          })
        );
      }

      // 3. Créer entrée historique (source APP_WEB)
      const utilisateur = await db.run(
        SELECT.one.from('smartorder.Utilisateurs').columns('ID')
          .where({ xsuaa_user_id: userId }).or({ username: userId })
      );
      await db.run(
        INSERT.into(HistoriqueStatut).entries({
          ID: uuid(),
          commande_ID: orderId,
          user_ID: utilisateur?.ID,
          ancien_statut: 'EN_ATTENTE',
          nouveau_statut: 'EN_ATTENTE',
          commentaire: `Commande créée par ${userId}.`,
          source_changement: 'APP_WEB',
          createdAt: now,
        })
      );

      // 4. Sync SAP (asynchrone — ne bloque pas la réponse)
      setImmediate(async () => {
        try {
          const lignesBDD = await db.run(
            SELECT.from('smartorder.LignesCommande').where({ commande_ID: orderId })
          );
          const sapResult = await getSapWriteService().createOrderInSAP(
            {
              type, company_code, purchasing_org, purchasing_group, devise,
              date_commande: date_commande || now.split('T')[0]
            },
            fournisseur,
            lignesBDD
          );

          if (sapResult.numero_sap && draftNum.startsWith('DRAFT-')) {
            await db.run(
              UPDATE('smartorder.Orders')
                .set({ numero_sap: sapResult.numero_sap, updatedAt: new Date().toISOString() })
                .where({ ID: orderId })
            );
            LOG.info('createOrder — numéro SAP confirmé : %s → %s', draftNum, sapResult.numero_sap);
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

          // Recalcul ML
          try {
            const cmd = await db.run(SELECT.one.from('smartorder.Orders').where({ ID: orderId }));
            if (cmd) await this._recalculerPrediction(cmd, req);
          } catch (mlErr) {
            LOG.warn('createOrder — erreur ML : %s', mlErr.message);
          }
        } catch (sapErr) {
          LOG.error('createOrder — erreur sync SAP : %s', sapErr.message);
        }
      });

      auditLog('ORDER_CREATED', { userId, orderId, fournisseur: fournisseur.nom });
      LOG.info('Commande créée : ID=%s num_provisoire=%s user=%s', orderId, draftNum, userId);

      // Retourner la commande créée
      return db.run(
        SELECT.one.from(Orders)
          .where({ ID: orderId })
      );
    });

    // Appeler le super.init() en dernier
    await super.init();
    if (this.name === 'OrdersService') {
      LOG.info(`✅ OrdersService CAP initialisé (CRUD + State_Machine + SAP sync + pagination ${DEFAULT_PAGE_SIZE}/${MAX_PAGE_SIZE})`);
    } else {
      LOG.info(`✅ ${this.name} initialisé via OrdersService handler`);
    }
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

// ============================================================
// Handler AdminService
// ============================================================
module.exports.AdminService = class AdminService extends cds.ApplicationService {
  async init() {
    this.before('*', async (req) => {
      if (!hasMinimumRole(req.user, 'ADMIN')) {
        return req.error(403, 'Acces reserve aux administrateurs.');
      }
    });

    await super.init();
    LOG.info('AdminService CAP initialise avec verification ADMIN');
  }
};

// ============================================================
// Handler AnalyticsService
// ============================================================
module.exports.AnalyticsService = class AnalyticsService extends cds.ApplicationService {
  async init() {
    // Vérifier le rôle avant toute lecture
    this.before('READ', 'CommandesAnalytics', async (req) => {
      if (!req.user) {
        throw new cds.error('Non authentifié', { status: 401 });
      }

      const role = getEffectiveRole(req.user) || 'USER';

      if (role === 'USER') {
        throw new cds.error(
          'Accès refusé. Le dashboard analytics nécessite le rôle MANAGER ou ADMIN.',
          { status: 403 }
        );
      }

      LOG.debug('READ CommandesAnalytics — user=%s role=%s', req.user.id, role);
    });

    await super.init();
    LOG.info('✅ AnalyticsService CAP initialisé avec vérification de rôle');
  }
};
