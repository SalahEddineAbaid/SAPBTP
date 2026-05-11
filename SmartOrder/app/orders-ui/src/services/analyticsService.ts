function getHeaders(): Record<string, string> {
  const stored = sessionStorage.getItem('smartorder_user');
  if (!stored) return {};
  const { credentials } = JSON.parse(stored);
  return { Authorization: `Basic ${credentials}` };
}

export async function getDashboardStats() {
  const res = await fetch('/api/analytics/dashboard', { headers: getHeaders() });
  if (!res.ok) throw new Error('Erreur chargement dashboard');
  return res.json();
}

export async function getCommandesAnalytics(params: { top?: number } = {}) {
  const { top = 100 } = params;
  const url = `/odata/v4/analytics/CommandesAnalytics?$top=${top}&$count=true`;
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) throw new Error('Erreur chargement analytics');
  const data = await res.json();
  return { items: data.value || [], count: data['@odata.count'] || 0 };
}
