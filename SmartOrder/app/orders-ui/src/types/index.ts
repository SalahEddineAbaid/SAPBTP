// ============================================
// TypeScript interfaces for SmartOrder
// ============================================

export interface Fournisseur {
  ID: string;
  code_sap: string;
  nom: string;
  pays?: string;
  email?: string;
  telephone?: string;
  score_performance?: number;
  taux_retard_moyen?: number;
  delai_moyen_jours?: number;
  nombre_commandes?: number;
  commandes_actives?: number;
  commandes_en_retard?: number;
  commandes_livrees?: number;
  actif?: boolean;
  derniere_sync?: string;
}

export interface Prediction {
  ID: string;
  risque_label: 'FAIBLE' | 'MOYEN' | 'ELEVE';
  risque_score: number;
  score_composite: number;
  priorite_action: string;
  suggestion?: string;
  modele_version?: string;
}

export interface LigneCommande {
  ID: string;
  commande_ID: string;
  numero_poste: number;
  code_produit: string;
  designation_produit?: string;
  quantite_commandee: number;
  quantite_livree?: number;
  prix_unitaire?: number;
  unite?: string;
  poids_total?: number;
  categorie_article?: string;
  plant?: string;
}

export interface HistoriqueStatut {
  ID: string;
  ancien_statut: string;
  nouveau_statut: string;
  date_changement: string;
  utilisateur?: string;
  commentaire?: string;
}

export interface Order {
  ID: string;
  numero_sap: string;
  type_commande?: string;
  type?: string;
  statut: string;
  urgence: string;
  montant_total?: number;
  devise?: string;
  date_creation: string;
  date_commande?: string;
  date_previsionnelle?: string;
  date_livraison_reelle?: string;
  date_modification?: string;
  score_priorite?: number;
  statut_approbation?: string;
  postes_en_retard?: number;
  fournisseur?: Fournisseur;
  fournisseur_ID?: string;
  prediction?: Prediction;
  lignes?: LigneCommande[];
  historique?: HistoriqueStatut[];
}

export interface SyncJob {
  ID: string;
  mode: string;
  statut: string;
  started_at?: string;
  ended_at?: string;
  commandes_creees?: number;
  commandes_maj?: number;
  erreurs?: number;
  error_message?: string;
  duree_ms?: number;
  createdAt?: string;
}

export interface MLModel {
  ID: string;
  type: string;
  version: string;
  accuracy?: number;
  f1_score?: number;
  mae?: number;
  r2?: number;
  dataset_size?: number;
  trained_at?: string;
  actif: boolean;
}

export interface AuditLog {
  ID: string;
  commande_ID?: string;
  user_ID?: string;
  ancien_statut: string;
  nouveau_statut: string;
  commentaire: string;
  source_changement: string;
  createdAt: string;
  user?: {
    ID: string;
    username: string;
    email?: string;
  };
  commande?: {
    ID: string;
    numero_sap: string;
  };
}

export interface User {
  ID: string;
  username: string;
  email: string;
  prenom?: string;
  nom?: string;
  telephone?: string;
  departement?: string;
  avatar_url?: string;
  role: 'USER' | 'MANAGER' | 'ADMIN';
  perimetre?: string; // JSON string
  actif: boolean;
  derniere_connexion?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Utilisateur {
  ID: string;
  username: string;
  email?: string;
  role: string;
  actif?: boolean;
}

export interface UserProfile {
  ID: string;
  username: string;
  email: string;
  displayName?: string;
  identitySource?: string;
  prenom?: string;
  nom?: string;
  telephone?: string;
  departement?: string;
  avatar_url?: string;
  role: 'USER' | 'MANAGER' | 'ADMIN';
  perimetre?: {
    company_codes?: string[];
    purchasing_orgs?: string[];
  };
  actif: boolean;
  derniere_connexion?: string;
  createdAt?: string;
  updatedAt?: string;
  preferences?: UserPreferences;
}

export interface UserPreferences {
  theme?: 'light' | 'dark' | 'system';
  density?: 'comfortable' | 'compact';
  language?: 'FR' | 'EN' | 'AR';
  timezone?: string;
  dateFormat?: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
  timeFormat?: '12h' | '24h';
  currency?: string;
  notifications?: {
    email?: boolean;
    push?: boolean;
    types?: ('BLOQUE' | 'RETARD' | 'ANOMALIE_VOLUME' | 'FOURNISSEUR_RISQUE')[];
  };
  display?: {
    pagination?: 20 | 50 | 100;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    visibleColumns?: string[];
  };
  autoRefresh?: 0 | 30 | 60 | 300; // 0 = manuel
}

export interface UserSession {
  username: string;
  displayName?: string;
  role: string;
  email: string;
  credentials: string;
  access_token?: string;
  authType?: string;
  validatedAt?: number;
  scopes?: string[];
  groups?: string[];
  roles?: string[];
  prenom?: string;
  nom?: string;
}

export interface ODataResponse<T> {
  value: T[];
  '@odata.count'?: number;
}

// ============================================================
// Types CRUD — Création et modification de commandes
// ============================================================

export interface LigneCommandeInput {
  code_produit: string;
  designation_produit?: string;
  quantite_commandee: number;
  prix_unitaire: number;
  unite?: string;
  plant?: string;
}

export interface CreateOrderPayload {
  type?: string;
  fournisseur_ID: string;
  company_code: string;
  purchasing_org: string;
  purchasing_group?: string;
  devise?: string;
  urgence?: 'NORMALE' | 'HAUTE' | 'CRITIQUE';
  date_previsionnelle: string;
  date_commande?: string;
  lignes?: LigneCommandeInput[];
}

export interface UpdateOrderPayload {
  urgence?: 'NORMALE' | 'HAUTE' | 'CRITIQUE';
  date_previsionnelle?: string;
  purchasing_group?: string;
  devise?: string;
}

export interface SapSyncStatus {
  pending?: boolean;
  syncing?: boolean;
  success?: boolean;
  error?: string;
  mock?: boolean;
  numero_sap_provisoire?: string;
  numero_sap?: string;
  logicalDelete?: boolean;
}

export interface CreateOrderResponse {
  order: Order;
  sap: SapSyncStatus;
}

export interface UpdateOrderResponse {
  order: Order;
  sap: SapSyncStatus;
}

export interface DeleteOrderResponse {
  message: string;
  sap: SapSyncStatus;
}
