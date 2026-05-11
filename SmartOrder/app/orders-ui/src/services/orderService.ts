import type { Order, Fournisseur, ODataResponse } from '../types';

const BASE = '/odata/v4/orders';

function getHeaders(): Record<string, string> {
  const stored = sessionStorage.getItem('smartorder_user');
  if (!stored) return { 'Content-Type': 'application/json' };
  const { credentials } = JSON.parse(stored);
  return { 'Content-Type': 'application/json', Authorization: `Basic ${credentials}` };
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    sessionStorage.removeItem('smartorder_user');
    window.location.href = '/login';
    throw new Error('Session expirée');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || `Erreur HTTP ${res.status}`);
  }
  return res.json();
}

interface PaginatedResult<T> { items: T[]; count: number; }

interface GetOrdersParams {
  top?: number; skip?: number; orderby?: string; filter?: string; search?: string;
}

export async function getOrders(params: GetOrdersParams = {}): Promise<PaginatedResult<Order>> {
  const { top = 20, skip = 0, orderby = 'date_creation desc', filter = '', search = '' } = params;
  let url = `${BASE}/Orders?$top=${top}&$skip=${skip}&$orderby=${orderby}&$expand=fournisseur,prediction&$count=true`;
  if (filter) url += `&$filter=${encodeURIComponent(filter)}`;
  if (search) url += `&$search=${encodeURIComponent(search)}`;

  const data = await fetch(url, { headers: getHeaders() }).then(r => handleResponse<ODataResponse<Order>>(r));
  return { items: data.value || [], count: data['@odata.count'] || 0 };
}

export async function getOrder(id: string): Promise<Order> {
  const url = `${BASE}/Orders(${id})?$expand=fournisseur,prediction,lignes,historique`;
  return fetch(url, { headers: getHeaders() }).then(r => handleResponse<Order>(r));
}

export async function changeStatus(id: string, statut: string, commentaire: string): Promise<Order> {
  const url = `${BASE}/Orders(${id})/OrdersService.changerStatut`;
  return fetch(url, {
    method: 'POST', headers: getHeaders(),
    body: JSON.stringify({ statut, commentaire }),
  }).then(r => handleResponse<Order>(r));
}

export async function getFournisseurs(params: { top?: number; skip?: number } = {}): Promise<PaginatedResult<Fournisseur>> {
  const { top = 50, skip = 0 } = params;
  const url = `${BASE}/Fournisseurs?$top=${top}&$skip=${skip}&$count=true`;
  const data = await fetch(url, { headers: getHeaders() }).then(r => handleResponse<ODataResponse<Fournisseur>>(r));
  return { items: data.value || [], count: data['@odata.count'] || 0 };
}
