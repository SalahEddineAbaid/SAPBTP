import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, CheckCircle, ShieldAlert, Package } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { fetchApi } from '../services/apiClient';

interface Alerte {
  ID: string;
  type: string;
  severite: string;
  message: string;
  lu: boolean;
  acquitte: boolean;
  date_creation: string;
  commande?: {
    numero_sap: string;
  };
}

export default function AlertsPage() {
  const { getAuthHeaders, hasRole } = useAuth();
  const [alertes, setAlertes] = useState<Alerte[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAlertes = useCallback(async () => {
    try {
      const res = await fetchApi('/api/alerts?top=50', {
        headers: getAuthHeaders(),
      }, { retries: 2, timeoutMs: 30000 });
      if (!res.ok) throw new Error('Erreur chargement alertes');
      const data = await res.json();
      setAlertes(data.value || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    fetchAlertes();
  }, [fetchAlertes]);

  // Protection : seuls MANAGER et ADMIN peuvent accéder aux alertes
  if (!hasRole('MANAGER')) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6 max-w-md mx-auto text-center space-y-4 animate-fade-in">
        <ShieldAlert className="w-16 h-16 text-red-500 animate-bounce" />
        <h2 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight">Accès Refusé</h2>
        <p className="text-slate-500 dark:text-slate-400 font-medium leading-relaxed text-sm">
          Vous n&apos;avez pas les permissions nécessaires pour accéder aux alertes.
        </p>
        <p className="text-slate-400 dark:text-slate-500 text-xs font-semibold uppercase tracking-wider">
          Cette fonctionnalité est réservée aux rôles MANAGER et ADMIN.
        </p>
      </div>
    );
  }

  const handleAcquitter = async (id: string) => {
    try {
      const res = await fetchApi(`/api/alerts/${encodeURIComponent(id)}/ack`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      }, { retries: 2, timeoutMs: 30000 });
      if (!res.ok) throw new Error('Erreur acquittement');
      fetchAlertes();
    } catch (err) {
      console.error(err);
    }
  };

  const formatDate = (d?: string) => d ? new Date(d).toLocaleString('fr-FR') : '—';

  const severiteColor = (sev: string) => {
    switch (sev?.toUpperCase()) {
      case 'FAIBLE': return 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]';
      case 'MOYEN': return 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]';
      default: return 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]';
    }
  };

  if (loading) return <div className="flex items-center justify-center min-h-[300px] w-full"><div className="animate-spin rounded-full h-10 w-10 border-4 border-slate-200 border-t-blue-600 dark:border-slate-800 dark:border-t-cyan-400" /></div>;

  const nonAcquittees = alertes.filter(a => !a.acquitte);
  const acquittees = alertes.filter(a => a.acquitte);

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100 tracking-tight">Alertes</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{nonAcquittees.length} alerte(s) active(s)</p>
        </div>
      </div>

      {nonAcquittees.length > 0 && (
        <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl shadow-sm overflow-hidden backdrop-blur-md">
          <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800/80 p-5">
            <h3 className="text-base font-extrabold text-slate-800 dark:text-slate-200 tracking-tight">Alertes actives</h3>
          </div>
          <div className="overflow-x-auto w-full">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Type</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Sévérité</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Message</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Commande</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Date</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {nonAcquittees.map((a, index) => (
                  <tr 
                    key={a.ID}
                    className="border-b border-slate-100 dark:border-slate-800/50 hover:bg-slate-50/30 dark:hover:bg-slate-950/10 transition-colors duration-150 animate-slide-up"
                    style={{ animationDelay: `${index * 0.02}s` }}
                  >
                    <td className="py-4 px-6 font-semibold">
                      <span className="inline-flex items-center px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-600 border border-amber-500/20 dark:text-amber-400 dark:bg-amber-950/10">{a.type}</span>
                    </td>
                    <td className="py-4 px-6 font-semibold">
                      <div className="flex items-center gap-2">
                        <div className={`w-2.5 h-2.5 rounded-full ${severiteColor(a.severite)}`} />
                        <span className="text-xs text-slate-700 dark:text-slate-300 font-bold">{a.severite}</span>
                      </div>
                    </td>
                    <td className="py-4 px-6 font-medium text-slate-800 dark:text-slate-200 max-w-sm">{a.message}</td>
                    <td className="py-4 px-6 font-bold text-blue-600 dark:text-cyan-400 tabular-nums">{a.commande?.numero_sap || '—'}</td>
                    <td className="py-4 px-6 text-slate-500 dark:text-slate-400 text-xs">
                      {formatDate(a.date_creation)}
                    </td>
                    <td className="py-4 px-6">
                      <button 
                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-bold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-950/80 cursor-pointer shadow-sm transition-all" 
                        onClick={() => handleAcquitter(a.ID)}
                      >
                        <CheckCircle size={14} className="text-emerald-500" /> Acquitter
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {acquittees.length > 0 && (
        <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl shadow-sm overflow-hidden backdrop-blur-md">
          <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800/80 p-5">
            <h3 className="text-base font-extrabold text-slate-800 dark:text-slate-200 tracking-tight">Alertes acquittées</h3>
          </div>
          <div className="overflow-x-auto w-full">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Type</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Sévérité</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Message</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Commande</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Date</th>
                </tr>
              </thead>
              <tbody>
                {acquittees.slice(0, 20).map((a, index) => (
                  <tr 
                    key={a.ID} 
                    className="border-b border-slate-100 dark:border-slate-800/50 hover:bg-slate-50/30 dark:hover:bg-slate-950/10 transition-colors duration-150 opacity-60 animate-slide-up"
                    style={{ animationDelay: `${index * 0.02}s` }}
                  >
                    <td className="py-4 px-6">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-850 dark:text-slate-300 dark:border-slate-700/50">{a.type}</span>
                    </td>
                    <td className="py-4 px-6 font-semibold text-slate-500 dark:text-slate-400 text-xs">{a.severite}</td>
                    <td className="py-4 px-6 font-medium text-slate-650 dark:text-slate-400 max-w-sm text-sm">{a.message}</td>
                    <td className="py-4 px-6 font-bold text-slate-500 dark:text-slate-400 tabular-nums">{a.commande?.numero_sap || '—'}</td>
                    <td className="py-4 px-6 text-slate-400 dark:text-slate-500 text-xs">
                      {formatDate(a.date_creation)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {alertes.length === 0 && (
        <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl p-8 shadow-sm backdrop-blur-md">
          <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500">
            <AlertTriangle size={64} className="opacity-30 mb-4 animate-float text-amber-500" />
            <p className="text-sm font-semibold">Aucune alerte</p>
          </div>
        </div>
      )}
    </div>
  );
}
