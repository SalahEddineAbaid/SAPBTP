using smartorder from '../db/schema';

// ============================================================
// SERVICE PRINCIPAL — Commandes (tous les rôles)
// ============================================================
@path: '/odata/v4/orders'
@requires: 'authenticated-user'
service OrdersService {

  // Commandes — CRUD complet + actions bound
  // CREATE/UPDATE/DELETE réservés aux rôles MANAGER et ADMIN
  // Filtrable par : statut, urgence, montant_total, date_creation,
  //                 date_previsionnelle, score_priorite, fournisseur_ID,
  //                 company_code, purchasing_org
  // Triable par   : toutes les colonnes exposées
  // Searchable    : numero_sap (géré par le handler JS)
  entity Orders as projection on smartorder.Orders
    actions {
      // UC07 — Changer le statut d'une commande (avec validation State_Machine)
      // Exige un commentaire obligatoire (min 5 caractères)
      // Crée un enregistrement HistoriqueStatut comme audit trail
      // Propage le changement vers SAP S/4HANA automatiquement
      action changerStatut(
        statut      : smartorder.StatutEnum,
        commentaire : String(2000)
      ) returns Orders;

      // UC08 — Déclencher recalcul prédiction ML
      action recalculerPrediction() returns Predictions;
    };

  // Action unbound — Créer une commande avec sync SAP automatique
  // Retourne la commande créée avec le numero_sap SAP confirmé
  action createOrder(
    type            : String(4),
    fournisseur_ID  : UUID,
    company_code    : String(4),
    purchasing_org  : String(4),
    purchasing_group: String(3),
    devise          : String(5),
    urgence         : smartorder.UrgenceEnum,
    date_previsionnelle : Date,
    date_commande   : Date,
    lignes          : array of {
      code_produit        : String(40);
      designation_produit : String(40);
      quantite_commandee  : Decimal(15,3);
      prix_unitaire       : Decimal(15,2);
      unite               : String(6);
      plant               : String(4);
    }
  ) returns Orders;

  // Fournisseurs — lecture seule pour les utilisateurs
  @readonly
  entity Fournisseurs as projection on smartorder.Fournisseurs;

  // Prédictions — lecture seule
  @readonly
  entity Predictions as projection on smartorder.Predictions;

  // Alertes — lecture + acquittement (MANAGER + ADMIN uniquement)
  entity Alertes as projection on smartorder.Alertes
    excluding { details }
    actions {
      action acquitter() returns Alertes;
    };

  // Historique — lecture seule (audit trail immuable)
  @readonly
  entity HistoriqueStatut as projection on smartorder.HistoriqueStatut;

  // Utilisateurs — lecture seule pour affichage dans l'historique
  @readonly
  entity Utilisateurs as projection on smartorder.Utilisateurs
    excluding { xsuaa_user_id, preferences };
}

// ============================================================
// SERVICE ANALYTIQUE — Dashboard & Anomalies (MANAGER + ADMIN)
// ============================================================
@path: '/odata/v4/analytics'
@requires: 'authenticated-user'
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
@requires: 'authenticated-user'
service AdminService {

  // CRUD Utilisateurs (UC12 + UC13)
  entity Utilisateurs as projection on smartorder.Utilisateurs
    actions {
      action modifierRole(
        role      : smartorder.RoleEnum,
        perimetre : String(2000)  // JSON
      ) returns Utilisateurs;
    };

  // Historique complet pour audit admin (avec associations)
  @readonly
  entity HistoriqueStatut as projection on smartorder.HistoriqueStatut;

  // Orders (lecture seule) — Nécessaire pour la navigation depuis HistoriqueStatut
  @readonly
  entity Orders as projection on smartorder.Orders;

  // Jobs de synchronisation SAP
  @readonly
  entity SyncJobs as projection on smartorder.SyncJobs;

  // Modèles ML
  @readonly
  entity MlModels as projection on smartorder.MlModels;
}

// ============================================================
// SERVICE PROFILE — Gestion du profil utilisateur (tous les rôles)
// ============================================================
@path: '/odata/v4/profile'
@requires: 'authenticated-user'
service ProfileService {

  // Profil de l'utilisateur connecté (lecture seule via OData)
  @readonly
  entity MonProfil as projection on smartorder.Utilisateurs
    excluding { xsuaa_user_id };
}
