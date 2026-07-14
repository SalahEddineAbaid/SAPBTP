/**
 * Service Admin - users, logs, SAP sync, ML models.
 */

import { User, AuditLog, SyncJob, MLModel } from '../types';
import { fetchApi } from './apiClient';

const API_BASE = process.env.REACT_APP_API_URL || '';

type UserRole = 'USER' | 'MANAGER' | 'ADMIN';

export interface UserPerimetre {
  company_codes?: string[];
  purchasing_orgs?: string[];
}

export interface UsersResponse {
  value: User[];
  '@odata.count'?: number;
}

export interface AdminUsersResponse {
  items: User[];
  total: number;
}

export interface UpsertUserPayload {
  username?: string;
  email: string;
  prenom?: string;
  nom?: string;
  role?: UserRole;
  actif?: boolean;
  perimetre?: UserPerimetre;
}

async function readApiError(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => null);
  const message = body?.error || body?.message || fallback;
  return new Error(message);
}

// ============================================================
// USERS
// ============================================================

export async function getUsers(headers: HeadersInit): Promise<UsersResponse> {
  const res = await fetchApi(`${API_BASE}/api/admin/users`, { headers }, { retries: 2, timeoutMs: 30000 });
  if (!res.ok) throw await readApiError(res, 'Erreur chargement utilisateurs');
  const data: AdminUsersResponse = await res.json();
  return {
    value: data.items || [],
    '@odata.count': data.total || 0,
  };
}

export async function createUser(data: UpsertUserPayload, headers: HeadersInit): Promise<User> {
  const res = await fetchApi(`${API_BASE}/api/admin/users`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  }, { retries: 2, timeoutMs: 30000 });
  if (!res.ok) throw await readApiError(res, 'Erreur creation utilisateur');
  return res.json();
}

export async function updateUser(
  userId: string,
  data: Partial<Pick<UpsertUserPayload, 'email' | 'prenom' | 'nom' | 'actif'>>,
  headers: HeadersInit
): Promise<User> {
  const res = await fetchApi(`${API_BASE}/api/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  }, { retries: 2, timeoutMs: 30000 });
  if (!res.ok) throw await readApiError(res, 'Erreur modification utilisateur');
  return res.json();
}

export async function deleteUser(userId: string, headers: HeadersInit): Promise<void> {
  const res = await fetchApi(`${API_BASE}/api/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers,
  }, { retries: 2, timeoutMs: 30000 });
  if (!res.ok) throw await readApiError(res, 'Erreur suppression utilisateur');
}

export async function toggleUserStatus(userId: string, actif: boolean, headers: HeadersInit): Promise<User> {
  return updateUser(userId, { actif }, headers);
}

export async function modifyUserRole(
  userId: string,
  role: string,
  perimetre: string | UserPerimetre,
  headers: HeadersInit
): Promise<User> {
  const parsedPerimetre = typeof perimetre === 'string' ? JSON.parse(perimetre || '{}') : perimetre;
  const res = await fetchApi(`${API_BASE}/api/admin/users/${encodeURIComponent(userId)}/role`, {
    method: 'PATCH',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ role, perimetre: parsedPerimetre }),
  }, { retries: 2, timeoutMs: 30000 });

  if (!res.ok) throw await readApiError(res, 'Erreur modification role');
  return res.json();
}

// ============================================================
// LOGS & AUDIT
// ============================================================

export interface LogsResponse {
  value: AuditLog[];
  '@odata.count'?: number;
}

export async function getLogs(headers: HeadersInit, top: number = 100): Promise<LogsResponse> {
  const res = await fetchApi(
    `${API_BASE}/odata/v4/admin/HistoriqueStatut?$expand=user,commande&$orderby=createdAt desc&$top=${top}`,
    { headers },
    { retries: 2, timeoutMs: 30000 }
  );
  if (!res.ok) throw await readApiError(res, 'Erreur chargement logs');
  return res.json();
}

// ============================================================
// SAP SYNC
// ============================================================

export interface SyncJobsResponse {
  items: SyncJob[];
  total: number;
}

export interface TriggerSyncResponse {
  jobId: string;
  statut: string;
  message: string;
  started_at: string;
}

export async function getSyncJobs(headers: HeadersInit): Promise<SyncJobsResponse> {
  const res = await fetchApi(`${API_BASE}/api/admin/sync`, { headers }, { retries: 2, timeoutMs: 30000 });
  if (!res.ok) throw await readApiError(res, 'Erreur chargement jobs sync');
  return res.json();
}

export async function triggerSync(mode: 'DELTA' | 'FULL', headers: HeadersInit): Promise<TriggerSyncResponse> {
  const res = await fetchApi(`${API_BASE}/api/admin/sync`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ mode }),
  }, { retries: 2, timeoutMs: 30000 });
  if (!res.ok) throw await readApiError(res, 'Erreur declenchement sync');
  return res.json();
}

export async function getSyncJobStatus(jobId: string, headers: HeadersInit): Promise<SyncJob> {
  const res = await fetchApi(`${API_BASE}/api/admin/sync/${jobId}`, { headers }, { retries: 2, timeoutMs: 30000 });
  if (!res.ok) throw await readApiError(res, 'Erreur recuperation statut job');
  return res.json();
}

// ============================================================
// ML MODELS
// ============================================================

export interface MLModelsResponse {
  models: MLModel[];
  mlService: {
    status: string;
    version?: string;
  };
}

export interface RetrainResponse {
  jobId: string;
  message: string;
  started_at: string;
}

export async function getMLModels(headers: HeadersInit): Promise<MLModelsResponse> {
  const res = await fetchApi(`${API_BASE}/api/admin/ml/models`, { headers }, { retries: 2, timeoutMs: 30000 });
  if (!res.ok) throw await readApiError(res, 'Erreur chargement modeles ML');
  return res.json();
}

export async function triggerMLRetrain(force: boolean, headers: HeadersInit): Promise<RetrainResponse> {
  const res = await fetchApi(`${API_BASE}/api/admin/ml/retrain`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ force }),
  }, { retries: 2, timeoutMs: 30000 });
  if (!res.ok) throw await readApiError(res, 'Erreur declenchement reentrainement');
  return res.json();
}
