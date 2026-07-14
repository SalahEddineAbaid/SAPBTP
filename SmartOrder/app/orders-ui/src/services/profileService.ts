import type { UserProfile, UserPreferences } from '../types';
import { fetchApi } from './apiClient';

/**
 * Récupérer le profil de l'utilisateur connecté
 */
export async function getProfile(headers: Record<string, string>): Promise<UserProfile> {
  const res = await fetchApi('/api/profile', {
    headers,
    credentials: 'include',
  }, { retries: 2, timeoutMs: 30000 });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Erreur serveur' }));
    throw new Error(error.error || 'Erreur chargement profil');
  }

  return res.json();
}

/**
 * Mettre à jour le profil utilisateur
 */
export async function updateProfile(
  data: Partial<Pick<UserProfile, 'prenom' | 'nom' | 'telephone' | 'departement' | 'avatar_url'>>,
  headers: Record<string, string>
): Promise<UserProfile> {
  const res = await fetchApi('/api/profile', {
    method: 'PATCH',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(data),
  }, { retries: 2, timeoutMs: 30000 });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Erreur serveur' }));
    throw new Error(error.error || 'Erreur mise à jour profil');
  }

  return res.json();
}

/**
 * Mettre à jour les préférences utilisateur
 */
export async function updatePreferences(
  preferences: UserPreferences,
  headers: Record<string, string>
): Promise<UserProfile> {
  const res = await fetchApi('/api/profile/preferences', {
    method: 'PATCH',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(preferences),
  }, { retries: 2, timeoutMs: 30000 });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Erreur serveur' }));
    throw new Error(error.error || 'Erreur mise à jour préférences');
  }

  return res.json();
}

/**
 * Préférences par défaut
 */
export const DEFAULT_PREFERENCES: UserPreferences = {
  theme: 'dark',
  density: 'comfortable',
  language: 'FR',
  timezone: 'Europe/Paris',
  dateFormat: 'DD/MM/YYYY',
  timeFormat: '24h',
  currency: 'EUR',
  notifications: {
    email: true,
    push: false,
    types: ['BLOQUE', 'RETARD'],
  },
  display: {
    pagination: 20,
    sortBy: 'date_creation',
    sortOrder: 'desc',
    visibleColumns: ['numero_sap', 'fournisseur', 'statut', 'montant_total', 'date_creation', 'risque'],
  },
  autoRefresh: 30,
};
