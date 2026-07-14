/**
 * SmartOrder — Schema CDS validé
 * Validé contre : OP_PURCHASEORDER_0001 Schema View
 * Source : SAP Business Accelerator Hub — 15/04/2026
 * URL : https://api.sap.com/api/OP_PURCHASEORDER_0001/schema
 *
 * Corrections appliquées après revue technique :
 * - date_creation : DateTime (au lieu de Date) — nécessaire pour analytics/ML
 * - unite : String(6) — certains systèmes SAP utilisent des unités ISO longues
 * - marqueur_suppression ajouté — PurOrderIsMarkedForDeletion
 */

namespace smartorder;

// ============================================================
// TYPES ÉNUMÉRÉS — logique métier interne SmartOrder
// ============================================================
type StatutEnum : String enum {
  EN_ATTENTE   = 'EN_ATTENTE';
  EN_COURS     = 'EN_COURS';
  EN_LIVRAISON = 'EN_LIVRAISON';
  LIVRE        = 'LIVRE';
  ANNULE       = 'ANNULE';
  BLOQUE       = 'BLOQUE';
}
// Nota : StatutEnum est calculé côté SmartOrder
// à partir de PurchasingProcessingStatus + PurchaseOrderDeletionCode
// Il n'existe pas en tant que champ unique dans l'API SAP.

type RisqueEnum : String enum {
  FAIBLE = 'FAIBLE';
  MOYEN  = 'MOYEN';
  ELEVE  = 'ELEVE';
}

type RoleEnum : String enum {
  USER    = 'USER';
  MANAGER = 'MANAGER';
  ADMIN   = 'ADMIN';
}

type UrgenceEnum : String enum {
  NORMALE  = 'NORMALE';
  HAUTE    = 'HAUTE';
  CRITIQUE = 'CRITIQUE';
}
// Nota : UrgenceEnum est enrichi manuellement par les managers.
// Pas de champ équivalent dans l'API Purchase Order SAP.

type PrioriteEnum : String enum {
  TRAITER_EN_PRIORITE = 'TRAITER_EN_PRIORITE';
  SURVEILLER          = 'SURVEILLER';
  ESCALADER           = 'ESCALADER';
}

type AlerteType : String enum {
  RETARD             = 'RETARD';
  BLOQUE             = 'BLOQUE';
  ANOMALIE_VOLUME    = 'ANOMALIE_VOLUME';
  FOURNISSEUR_RISQUE = 'FOURNISSEUR_RISQUE';
}

type SeveriteEnum : String enum {
  FAIBLE   = 'FAIBLE';
  MOYEN    = 'MOYEN';
  ELEVE    = 'ELEVE';
  CRITIQUE = 'CRITIQUE';
}

type SyncStatus : String enum {
  EN_ATTENTE = 'EN_ATTENTE';
  EN_COURS   = 'EN_COURS';
  SUCCES     = 'SUCCES';
  ECHEC      = 'ECHEC';
}

// ============================================================
// ENTITÉ : Fournisseurs
// Source OData : Partner.Supplier (page 6 du Schema View)
//             + données historiques calculées en interne
// ============================================================
entity Fournisseurs {
  key ID             : UUID        @Core.Computed;

  // OData : Partner.Supplier (Purchasing Document Partner)
  // Longueur réelle SAP : 10 caractères alphanumériques
  code_sap           : String(10)  not null @assert.unique;

  // Nom du fournisseur — récupéré via A_BusinessPartner
  // SAP : BusinessPartnerFullName (max 81 chars)
  nom                : String(81)  not null;

  // SAP : Country dans A_BusinessPartner — ISO 3 chars
  pays               : String(3)   default 'MA';

  // Email et téléphone via $expand sur A_BusinessPartner
  // Non disponible directement dans Purchase Order API
  email              : String(241);
  telephone          : String(30);

  // Champs calculés en interne par SmartOrder
  // Absents de l'API SAP — calculés depuis l'historique des commandes
  taux_retard_moyen  : Double      default 0;
  delai_moyen_jours  : Double      default 0;
  score_performance  : Double      default 1;

  // actif = !PurchaseOrderDeletionCode (logique inversée SAP)
  actif              : Boolean     default true;

  derniere_sync      : DateTime;
  createdAt          : DateTime;
  updatedAt          : DateTime;

  orders             : Association to many Orders on orders.fournisseur = $self;
}

// ============================================================
// ENTITÉ : Utilisateurs
// Source : XSUAA — pas d'équivalent dans Purchase Order API
// Entité 100% interne SmartOrder
// ============================================================
entity Utilisateurs {
  key ID               : UUID        @Core.Computed;
  xsuaa_user_id        : String(100) @assert.unique;
  username             : String(100) not null @assert.unique;
  email                : String(200) not null @assert.unique;
  prenom               : String(100);
  nom                  : String(100);
  role                 : RoleEnum    not null default 'USER';
  perimetre            : LargeString;
  actif                : Boolean     default true;
  derniere_connexion   : DateTime;
  
  // Profile fields
  telephone            : String(30);
  departement          : String(50);
  avatar_url           : String(500);
  
  // Preferences (stored as JSON)
  preferences          : LargeString;
  
  createdAt            : DateTime;
  updatedAt            : DateTime;
  orders_managed       : Association to many Orders on orders_managed.manager = $self;
  historique           : Association to many HistoriqueStatut on historique.user = $self;
}

// ============================================================
// ENTITÉ : Orders (Commandes fournisseur)
// Source OData principale : PurchaseOrder (page 33 Schema View)
// URL : /A_PurchaseOrder
// ============================================================
entity Orders {
  key ID                  : UUID          @Core.Computed;

  // OData : PurchaseOrder — "Purchasing Document"
  // Longueur réelle SAP = 10 chars (ex: "4500001234")
  numero_sap              : String(10)    not null @assert.unique;

  // OData : PurchaseOrderType — "Purchasing Doc. Type"
  // Exemples SAP : "NB" (commande standard), "ZNB" (custom YAAS)
  // Longueur réelle = 4 chars max — stocke le code SAP brut
  type                    : String(4)     not null default 'NB';

  // Calculé par SmartOrder depuis :
  //   PurchasingProcessingStatus + PurchaseOrderDeletionCode
  //   + ReleaseIsNotCompleted (voir mapStatut() dans syncSAPService)
  statut                  : StatutEnum    not null default 'EN_ATTENTE';

  // Enrichi manuellement par les managers — absent de l'API SAP
  urgence                 : UrgenceEnum   not null default 'NORMALE';

  // OData : CreationDate — "Created On" (page 33)
  // Type Edm.Date dans l'API SAP, mais stocké en DateTime côté SmartOrder
  // pour les calculs de durée analytics/ML (le mapper ajoute T00:00:00Z)
  date_creation           : DateTime      not null;

  // OData : ScheduleLines.ScheduleLineDeliveryDate (page 9)
  // "Delivery Date" — première date de livraison prévue
  // Nécessite $expand=_PurchaseOrderScheduleLineTP dans la requête
  date_previsionnelle     : Date          not null;

  date_livraison_reelle   : Date;

  // OData : LastChangeDateTime — "Last Changed" (page 33)
  // Type Edm.DateTimeOffset → compatible CDS DateTime
  date_modification       : DateTime      not null;

  // Calculé côté SmartOrder : somme des NetAmount des lignes
  // Pas de champ NetAmount au niveau header dans Purchase Order API
  montant_total           : Decimal(15,2) not null default 0;

  // OData : DocumentCurrency — "Currency" (page 33)
  // SAP utilise jusqu'à 5 chars (GDWAE)
  devise                  : String(5)     not null default 'EUR';

  score_priorite          : Double        default 0;

  // OData : CompanyCode — "Company Code" (page 33)
  // Indispensable pour le filtrage par entité YAAS
  company_code            : String(4);

  // OData : PurchasingOrganization — "Purch. Organization" (page 33)
  purchasing_org          : String(4);

  // OData : PurchasingGroup — "Purchasing Group" (page 33) — optionnel
  purchasing_group        : String(3);

  // OData : PurOrderIsMarkedForDeletion — "Deletion Indicator" (page 33)
  // Utilisé dans le calcul du StatutEnum (ANNULE si true)
  marqueur_suppression    : Boolean       default false;

  // OData : ReleaseStatus — "Release Status" (Statut d'approbation)
  // Valeurs : '' (non libérée), 'X' (libérée/approuvée), 'R' (rejetée)
  // Champ visible dans Fiori "Gestion des commandes d'achat" — YAAS
  statut_approbation      : String(1)     default '';

  // OData : PurchaseOrderDate — "Purch. Order Date"
  // Date métier officielle de la commande (peut différer de CreationDate)
  // CreationDate = quand le document a été saisi dans SAP
  // PurchaseOrderDate = la date métier imprimée sur le document
  date_commande           : Date;

  // Calculé lors de la sync : nombre de lignes dont la livraison est en retard
  // (date_previsionnelle < aujourd'hui ET quantite_livree < quantite_commandee)
  // Visible dans S/4HANA comme "Postes en retard"
  postes_en_retard        : Integer       default 0;

  createdAt               : DateTime;
  updatedAt               : DateTime;

  fournisseur             : Association to Fournisseurs;
  manager                 : Association to Utilisateurs;
  lignes                  : Composition of many LignesCommande  on lignes.commande    = $self;
  prediction              : Composition of one  Predictions     on prediction.commande = $self;
  alertes                 : Composition of many Alertes         on alertes.commande    = $self;
  historique              : Composition of many HistoriqueStatut on historique.commande = $self;
}

// ============================================================
// ENTITÉ : LignesCommande
// Source OData : PurchaseOrderItem (pages 40-50 Schema View)
// URL : /A_PurchaseOrderItem
// ============================================================
entity LignesCommande {
  key ID                  : UUID          @Core.Computed;
  commande                : Association to Orders;

  // OData : PurchaseOrderItem — "Purchase Order Item"
  // SAP retourne String "00010", "00020" → parseInt() dans mapper
  // Note : SAP stocke EBELP comme String(5) avec zéro-padding ("00010").
  // parseInt() dans le mapper perd le padding — acceptable pour SmartOrder.
  numero_poste            : Integer       not null;

  // OData : Material — "Material" (page 40)
  // Longueur SAP = 40 chars alphanumériques
  code_produit            : String(40)    not null;

  // OData : PurchaseOrderItemText — "Short Text" (page 40)
  // Longueur SAP standard = 40 chars, avec marge pour textes custom/importés.
  designation_produit     : String(80);

  // OData : OrderQuantity — "Order Quantity" (page 41)
  quantite_commandee      : Decimal(15,3) not null;

  // Calculé : OrderQuantity - OpenPurchaseOrderQuantity
  // OpenPurchaseOrderQuantity est dans ScheduleLines (page 9)
  quantite_livree         : Decimal(15,3) default 0;

  // OData : NetPriceAmount — "Net Order Price" (page 41)
  prix_unitaire           : Decimal(15,2) not null;

  // OData : PurchaseOrderQuantityUnit — "Order Unit" (page 41)
  // String(6) pour supporter les unités ISO longues (PCE, KGM...)
  unite                   : String(6)     default 'PC';

  // OData : ItemGrossWeight — "Gross Weight" (page 41)
  poids_total             : Decimal(10,3);

  // OData : MaterialGroup/ArticleCategory — champ item.
  // Certains tenants YAAS exposent un groupe marchandise custom long (ex: ZPFDND).
  categorie_article       : String(20);

  // OData : Plant — "Plant" (page 40)
  // Site/usine de livraison SAP
  plant                   : String(4);
}

// ============================================================
// ENTITÉ : Predictions ML
// Entité 100% interne SmartOrder — aucun équivalent SAP
// ============================================================
entity Predictions {
  key ID                  : UUID          @Core.Computed;
  commande                : Association to Orders;
  risque_label            : RisqueEnum    not null default 'FAIBLE';
  risque_score            : Double        not null default 0;
  risque_probabilites     : LargeString;
  duree_estimee_jours     : Double;
  duree_reelle_jours      : Double;
  score_composite         : Double        default 0;
  priorite_action         : PrioriteEnum  default 'SURVEILLER';
  suggestion              : LargeString;
  features_snapshot       : LargeString;
  modele_version          : String(20)    default 'v1.0.0';
  calcule_le              : DateTime;
  recalcul_requis         : Boolean       default false;
}

// ============================================================
// ENTITÉ : Alertes — interne SmartOrder
// ============================================================
entity Alertes {
  key ID                  : UUID          @Core.Computed;
  commande                : Association to Orders;
  type                    : AlerteType    not null;
  severite                : SeveriteEnum  not null default 'MOYEN';
  message                 : LargeString   not null;
  details                 : LargeString;
  lu                      : Boolean       default false;
  acquitte                : Boolean       default false;
  destinataires_roles     : LargeString;
  date_creation           : DateTime;
  date_acquittement       : DateTime;
}

// ============================================================
// ENTITÉ : HistoriqueStatut — audit trail immuable
// ============================================================
entity HistoriqueStatut {
  key ID                  : UUID          @Core.Computed;
  commande                : Association to Orders;
  user                    : Association to Utilisateurs;
  ancien_statut           : StatutEnum    not null;
  nouveau_statut          : StatutEnum    not null;
  commentaire             : LargeString   not null;
  source_changement       : String(50)    default 'APP_WEB';
  createdAt               : DateTime;
}

// ============================================================
// ENTITÉ : SyncJobs — suivi des synchronisations SAP
// ============================================================
entity SyncJobs {
  key ID                  : UUID          @Core.Computed;
  mode                    : String(10)    default 'DELTA';
  statut                  : SyncStatus    default 'EN_ATTENTE';
  commandes_creees        : Integer       default 0;
  commandes_maj           : Integer       default 0;
  erreurs                 : Integer       default 0;
  depuis                  : DateTime;
  started_at              : DateTime;
  ended_at                : DateTime;
  duree_ms                : Integer;
  error_message           : LargeString;
  createdAt               : DateTime;
}

// ============================================================
// ENTITÉ : MlModels — registre des versions ML
// ============================================================
entity MlModels {
  key ID                  : UUID          @Core.Computed;
  type                    : String(30)    not null;
  version                 : String(20)    not null;
  accuracy                : Double;
  f1_score                : Double;
  mae                     : Double;
  r2                      : Double;
  dataset_size            : Integer;
  trained_at              : DateTime;
  actif                   : Boolean       default true;
}
