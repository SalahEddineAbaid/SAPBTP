import type {
  Order,
  Fournisseur,
  CreateOrderPayload,
  UpdateOrderPayload,
  CreateOrderResponse,
  UpdateOrderResponse,
  DeleteOrderResponse,
} from '../types';
import { fetchApi } from './apiClient';

const BASE = '/odata/v4/orders';
const BASE_API = '/api/orders/crud';

/**
 * Fetch avec timeout automatique
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeout = 60000
): Promise<Response> {
  return fetchApi(url, options, { timeoutMs: timeout, retries: 2 });
}

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const stored = sessionStorage.getItem('smartorder_user');
  if (!stored) return headers;
  try {
    const data = JSON.parse(stored);
    if (data.access_token) {
      headers.Authorization = `Bearer ${data.access_token}`;
    } else if (data.credentials) {
      headers.Authorization = `Basic ${data.credentials}`;
    }
  } catch { /* ignore */ }
  return headers;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    sessionStorage.removeItem('smartorder_user');
    window.location.href = '/login';
    throw new Error('Session expirée');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (res.status === 403) {
      throw new Error(body.message || body.error?.message || 'Action réservée aux rôles Manager et Admin.');
    }
    throw new Error(body.message || body.error?.message || body.error || `Erreur HTTP ${res.status}`);
  }
  return res.json();
}

interface PaginatedResult<T> { items: T[]; count: number; }

interface GetOrdersParams {
  top?: number; skip?: number; orderby?: string; filter?: string; search?: string;
}

// ============================================================
// READ — Lecture des commandes (OData CAP)
// ============================================================

export async function getOrders(params: GetOrdersParams = {}): Promise<PaginatedResult<Order>> {
  const { top = 20, skip = 0, orderby = 'date_creation desc', filter = '', search = '' } = params;
  let url = `/api/orders/list?top=${top}&skip=${skip}&orderby=${encodeURIComponent(orderby)}`;
  if (filter) url += `&filter=${encodeURIComponent(filter)}`;
  if (search) url += `&search=${encodeURIComponent(search)}`;

  const data = await fetchWithTimeout(url, { headers: getHeaders() }).then(r => handleResponse<PaginatedResult<Order>>(r));
  return { items: data.items || [], count: data.count || 0 };
}

export async function getOrder(id: string): Promise<Order> {
  const url = `${BASE}/Orders(${id})?$expand=fournisseur,prediction,lignes,historique`;
  return fetchWithTimeout(url, { headers: getHeaders() }).then(r => handleResponse<Order>(r));
}

export async function changeStatus(id: string, statut: string, commentaire: string): Promise<Order> {
  const url = `${BASE}/Orders(${id})/OrdersService.changerStatut`;
  return fetchWithTimeout(url, {
    method: 'POST', headers: getHeaders(),
    body: JSON.stringify({ statut, commentaire }),
  }).then(r => handleResponse<Order>(r));
}

export async function getFournisseurs(params: { top?: number; skip?: number; search?: string } = {}): Promise<PaginatedResult<Fournisseur>> {
  const { top = 50, skip = 0, search = '' } = params;
  let url = `/api/suppliers?top=${top}&skip=${skip}`;
  if (search) url += `&search=${encodeURIComponent(search)}`;
  const data = await fetchWithTimeout(url, { headers: getHeaders() }).then(r => handleResponse<PaginatedResult<Fournisseur>>(r));
  return { items: data.items || [], count: data.count || 0 };
}

// ============================================================
// CREATE — Créer une commande avec sync SAP automatique
// ============================================================

/**
 * Crée une nouvelle commande dans SmartOrder et la synchronise vers SAP S/4HANA.
 * La commande reçoit d'abord un numéro provisoire (DRAFT-XXXXXXXX),
 * puis le vrai numéro SAP est assigné en arrière-plan.
 *
 * @param payload - Données de la commande à créer
 * @returns La commande créée + statut de la sync SAP
 */
export async function createOrder(payload: CreateOrderPayload): Promise<CreateOrderResponse> {
  return fetchWithTimeout(
    `${BASE_API}`,
    { method: 'POST', headers: getHeaders(), body: JSON.stringify(payload) },
    60000 // Timeout plus long pour inclure la sync SAP
  ).then(r => handleResponse<CreateOrderResponse>(r));
}

// ============================================================
// UPDATE — Modifier une commande avec sync SAP automatique
// ============================================================

/**
 * Modifie une commande (champs autorisés) et propage les changements vers SAP.
 *
 * Champs modifiables : urgence, date_previsionnelle, purchasing_group, devise
 * Note : Les champs SAP-only (statut, montant) ne sont pas modifiables via cette route.
 *        Pour changer le statut, utilisez changeStatus().
 *
 * @param id      - ID de la commande SmartOrder
 * @param payload - Champs à modifier
 * @returns La commande mise à jour + statut de la sync SAP
 */
export async function updateOrder(id: string, payload: UpdateOrderPayload): Promise<UpdateOrderResponse> {
  return fetchWithTimeout(
    `${BASE_API}/${id}`,
    { method: 'PATCH', headers: getHeaders(), body: JSON.stringify(payload) }
  ).then(r => handleResponse<UpdateOrderResponse>(r));
}

// ============================================================
// DELETE — Supprimer une commande (statut ANNULE requis)
// ============================================================

/**
 * Supprime une commande de SmartOrder.
 *
 * Prérequis :
 *   - Statut de la commande = 'ANNULE'
 *   - Rôle ADMIN obligatoire
 *
 * Comportement SAP :
 *   - La commande est d'abord marquée pour suppression dans SAP
 *     (PurOrderIsMarkedForDeletion = true) — suppression logique
 *   - Puis supprimée physiquement de la BDD SmartOrder
 *
 * @param id - ID de la commande à supprimer
 * @returns Message de confirmation + résultat SAP
 */
export async function deleteOrder(id: string): Promise<DeleteOrderResponse> {
  return fetchWithTimeout(
    `${BASE_API}/${id}`,
    { method: 'DELETE', headers: getHeaders() }
  ).then(r => handleResponse<DeleteOrderResponse>(r));
}

// ============================================================
// SYNC — Relancer la synchronisation SAP manuellement
// ============================================================

/**
 * Relit la commande depuis SAP S/4HANA et met à jour la BDD locale.
 * Utile après un conflit ou une désynchronisation.
 * Réservé aux ADMIN.
 *
 * @param id - ID de la commande à resynchroniser
 */
export async function syncOrderFromSAP(id: string): Promise<{ message: string }> {
  return fetchWithTimeout(
    `${BASE_API}/${id}/sync`,
    { method: 'GET', headers: getHeaders() }
  ).then(r => handleResponse<{ message: string }>(r));
}
