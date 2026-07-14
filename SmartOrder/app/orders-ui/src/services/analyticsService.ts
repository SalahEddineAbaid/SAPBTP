import { fetchApi } from './apiClient';

function getHeaders(): Record<string, string> {
  const stored = sessionStorage.getItem('smartorder_user');
  if (!stored) return {};
  try {
    const data = JSON.parse(stored);
    if (data.access_token) return { Authorization: `Bearer ${data.access_token}` };
    if (data.credentials)  return { Authorization: `Basic ${data.credentials}` };
  } catch { /* ignore */ }
  return {};
}

async function handleResponse(res: Response, context: string) {
  if (res.status === 401) {
    sessionStorage.removeItem('smartorder_user');
    window.location.href = '/login';
    throw new Error('Session expirée');
  }
  
  if (res.status === 403) {
    throw new Error(
      'Accès refusé. Cette fonctionnalité nécessite le rôle MANAGER ou ADMIN.'
    );
  }
  
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || `Erreur ${context}`);
  }
  
  return res.json();
}

export async function getDashboardStats() {
  const res = await fetchApi('/api/analytics/dashboard', { headers: getHeaders() }, { retries: 2, timeoutMs: 30000 });
  return handleResponse(res, 'chargement dashboard');
}

export async function getCommandesAnalytics(params: { top?: number } = {}) {
  const { top = 100 } = params;
  const url = `/odata/v4/analytics/CommandesAnalytics?$top=${top}&$count=true`;
  const res = await fetchApi(url, { headers: getHeaders() }, { retries: 2, timeoutMs: 30000 });
  const data = await handleResponse(res, 'chargement analytics');
  return { items: data.value || [], count: data['@odata.count'] || 0 };
}
