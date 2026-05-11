import type { SyncJob, Utilisateur, ODataResponse } from '../types';

function getHeaders(): Record<string, string> {
  const stored = sessionStorage.getItem('smartorder_user');
  if (!stored) return { 'Content-Type': 'application/json' };
  const { credentials } = JSON.parse(stored);
  return { 'Content-Type': 'application/json', Authorization: `Basic ${credentials}` };
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || body.message || `Erreur HTTP ${res.status}`);
  }
  return res.json();
}

export async function triggerSync(mode: 'FULL' | 'DELTA' = 'FULL') {
  return fetch('/api/admin/sync', {
    method: 'POST', headers: getHeaders(),
    body: JSON.stringify({ mode }),
  }).then(r => handleResponse<{ creees?: number; mises_a_jour?: number }>(r));
}

export async function getSyncJobs(params: { top?: number } = {}) {
  const { top = 20 } = params;
  const url = `/odata/v4/admin/SyncJobs?$top=${top}&$orderby=started_at desc&$count=true`;
  const data = await fetch(url, { headers: getHeaders() }).then(r => handleResponse<ODataResponse<SyncJob>>(r));
  return { items: data.value || [], count: data['@odata.count'] || 0 };
}

export async function getUsers() {
  const url = `/odata/v4/admin/Utilisateurs?$count=true`;
  const data = await fetch(url, { headers: getHeaders() }).then(r => handleResponse<ODataResponse<Utilisateur>>(r));
  return { items: data.value || [], count: data['@odata.count'] || 0 };
}
