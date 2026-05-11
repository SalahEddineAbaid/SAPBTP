/**
 * SmartOrder — Définition du Service CDS
 * Projet PFE SAP BTP — YAAS "Run It Best"
 *
 * Ce service expose automatiquement des endpoints OData v4 pour toutes les entités.
 * Les routes custom (analytics, WebSocket, admin, ML) sont dans server.js + srv/routes/.
 *
 * Endpoints OData auto-générés :
 *   GET  /odata/v4/orders/Orders?$filter=...&$top=20&$skip=0&$expand=prediction,fournisseur
 *   GET  /odata/v4/orders/Orders(ID)
 *   PATCH /odata/v4/orders/Orders(ID)  (via before/after handlers)
 *   ...
 *
 * Pagination :
 *   Default: 20 items/page  |  Max: 500 items/page
 *   Contrôlé par le handler JS (before READ)
 *
 * Filtres supportés :
 *   $filter=statut eq 'EN_COURS' and urgence eq 'HAUTE'
 *   $filter=montant_total ge 10000 and montant_total le 50000
 *   $filter=date_creation ge 2024-01-01T00:00:00Z
 *   $filter=fournisseur/nom eq 'SAP'
 *   $search=numero_sap (converti en filtre contains par le handler JS)
 *
 * Tri supporté :
 *   $orderby=date_creation desc,score_priorite desc
 *   $orderby=montant_total asc
 */

using smartorder from '../db/schema';

// ============================================================
// SERVICE PRINCIPAL — Commandes (tous les rôles)
// ============================================================
@path: '/odata/v4/orders'
@requires: 'authenticated-user'
service OrdersService {

  // Commandes — lecture + actions bound
  // Filtrable par : statut, urgence, montant_total, date_creation,
  //                 date_previsionnelle, score_priorite, fournisseur_ID,
  //                 company_code, purchasing_org
  // Triable par   : toutes les colonnes exposées
  // Searchable    : numero_sap (géré par le handler JS)
  @readonly
  entity Orders as projection on smartorder.Orders
    actions {
      // UC07 — Changer le statut d'une commande (avec validation State_Machine)
      // Exige un commentaire obligatoire (min 5 caractères)
      // Crée un enregistrement HistoriqueStatut comme audit trail
      action changerStatut(
        statut      : smartorder.StatutEnum,
        commentaire : String(2000)
      ) returns Orders;

      // UC08 — Déclencher recalcul prédiction ML
      action recalculerPrediction() returns Predictions;
    };

  // Fournisseurs — lecture seule pour les utilisateurs
  @readonly
  entity Fournisseurs as projection on smartorder.Fournisseurs;

  // Prédictions — lecture seule
  @readonly
  entity Predictions as projection on smartorder.Predictions;

  // Alertes — lecture + acquittement
  entity Alertes as projection on smartorder.Alertes
    excluding { details }
    actions {
      action acquitter() returns Alertes;
    };

  // Historique — lecture seule (audit trail immuable)
  @readonly
  entity HistoriqueStatut as projection on smartorder.HistoriqueStatut;
}

// ============================================================
// SERVICE ANALYTIQUE — Dashboard & Anomalies (MANAGER + ADMIN)
// ============================================================
@path: '/odata/v4/analytics'
@requires: [ 'MANAGER', 'ADMIN' ]
service AnalyticsService {

  // Vue commandes avec champs analytiques
  @readonly
  entity CommandesAnalytics as select from smartorder.Orders {
    ID, numero_sap, statut, urgence, montant_total, devise,
    date_creation, date_commande, date_previsionnelle, date_livraison_reelle,
    score_priorite, statut_approbation, postes_en_retard,
    fournisseur.nom as fournisseur_nom,
    fournisseur.taux_retard_moyen, fournisseur.score_performance,
    prediction.risque_label, prediction.risque_score,
    prediction.score_composite, prediction.priorite_action
  };
}

// ============================================================
// SERVICE ADMIN — Gestion utilisateurs, logs, sync (ADMIN seul)
// ============================================================
@path: '/odata/v4/admin'
@requires: 'ADMIN'
service AdminService {

  // CRUD Utilisateurs (UC12 + UC13)
  entity Utilisateurs as projection on smartorder.Utilisateurs
    actions {
      action modifierRole(
        role      : smartorder.RoleEnum,
        perimetre : String(2000)  // JSON
      ) returns Utilisateurs;
    };

  // Jobs de synchronisation SAP
  @readonly
  entity SyncJobs as projection on smartorder.SyncJobs;

  // Modèles ML
  @readonly
  entity MlModels as projection on smartorder.MlModels;
}
