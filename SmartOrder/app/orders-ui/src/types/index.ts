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
  nombre_commandes?: number;
  actif?: boolean;
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
}

export interface Utilisateur {
  ID: string;
  username: string;
  email?: string;
  role: string;
  actif?: boolean;
}

export interface UserSession {
  username: string;
  role: string;
  email: string;
  credentials: string;
}

export interface ODataResponse<T> {
  value: T[];
  '@odata.count'?: number;
}
