import { useState, useEffect } from 'react';
import { Settings, RefreshCw, Play, Clock, CheckCircle, XCircle } from 'lucide-react';
import { triggerSync, getSyncJobs, getUsers } from '../services/adminService';
import { useAuth } from '../hooks/useAuth';
import type { SyncJob, User } from '../types';

export default function AdminPage() {
  const { getAuthHeaders } = useAuth();
  const [syncJobs, setSyncJobs] = useState<SyncJob[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ success: boolean; message?: string; creees?: number; mises_a_jour?: number } | null>(null);

  useEffect(() => {
    const headers = getAuthHeaders();
    Promise.all([
      getSyncJobs(headers).catch(() => ({ items: [] as SyncJob[], total: 0 })),
      getUsers(headers).catch(() => ({ value: [] as User[], '@odata.count': 0 })),
    ]).then(([jobs, u]) => { 
      setSyncJobs(jobs.items); 
      setUsers(u.value); 
    }).finally(() => setLoading(false));
  }, []);

  const handleSync = async (mode: 'FULL' | 'DELTA') => {
    setSyncing(true); setSyncResult(null);
    try {
      const headers = getAuthHeaders();
      const result = await triggerSync(mode, headers);
      setSyncResult({ success: true, message: result.message });
      const jobs = await getSyncJobs(headers);
      setSyncJobs(jobs.items);
    } catch (err: unknown) {
      setSyncResult({ success: false, message: err instanceof Error ? err.message : 'Erreur' });
    } finally { setSyncing(false); }
  };

  const formatDate = (d?: string) => d ? new Date(d).toLocaleString('fr-FR') : '—';

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px] w-full">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-slate-200 border-t-blue-600 dark:border-slate-800 dark:border-t-cyan-400" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100 tracking-tight">Administration</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Synchronisation SAP, utilisateurs et modèles ML</p>
        </div>
      </div>

      <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl p-6 shadow-sm backdrop-blur-md">
        <div className="border-b border-slate-100 dark:border-slate-800/80 pb-4 mb-4 flex items-center gap-2">
          <RefreshCw size={18} className="text-blue-600 dark:text-cyan-400" />
          <h3 className="text-base font-extrabold text-slate-800 dark:text-slate-200 tracking-tight">Synchronisation SAP S/4HANA</h3>
        </div>
        
        <div className="flex flex-wrap gap-3 mb-6">
          <button 
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-gradient-to-r from-blue-600 to-sky-500 dark:from-cyan-500 dark:to-blue-600 text-white shadow-sm hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed" 
            disabled={syncing} 
            onClick={() => handleSync('FULL')}
          >
            <Play size={14} /> {syncing ? 'En cours...' : 'Sync FULL'}
          </button>
          <button 
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-950/80 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed transition-all" 
            disabled={syncing} 
            onClick={() => handleSync('DELTA')}
          >
            <RefreshCw size={14} /> Sync DELTA
          </button>
        </div>

        {syncResult && (
          <div className={`p-4 rounded-xl border mb-6 text-xs leading-relaxed ${
            syncResult.success 
              ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400' 
              : 'border-red-500/20 bg-red-500/5 text-red-650 dark:text-red-400'
          }`}>
            {syncResult.success
              ? `✅ Sync terminée — ${syncResult.creees || 0} créées, ${syncResult.mises_a_jour || 0} mises à jour`
              : `❌ Erreur: ${syncResult.message}`}
          </div>
        )}

        {syncJobs.length > 0 && (
          <div className="overflow-x-auto w-full">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Date</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Mode</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Statut</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Résultat</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Durée</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
                {syncJobs.slice(0, 10).map((j, index) => (
                  <tr key={j.ID} className="hover:bg-slate-50/30 dark:hover:bg-slate-950/10 transition-colors duration-150 animate-slide-up" style={{ animationDelay: `${index * 0.02}s` }}>
                    <td className="py-4 px-6 text-xs text-slate-600 dark:text-slate-300 font-semibold tabular-nums">{formatDate(j.started_at)}</td>
                    <td className="py-4 px-6">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/10 text-blue-600 border border-blue-500/20 dark:text-blue-400 dark:bg-blue-950/10">{j.mode}</span>
                    </td>
                    <td className="py-4 px-6">
                      {j.statut === 'SUCCES' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 dark:text-emerald-450 dark:bg-emerald-950/10">
                          <CheckCircle size={10} /> Succès
                        </span>
                      ) : j.statut === 'ERREUR' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-red-500/10 text-red-650 border border-red-500/20 dark:text-red-400 dark:bg-red-950/10">
                          <XCircle size={10} /> Erreur
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-600 border border-amber-500/20 dark:text-amber-400 dark:bg-amber-950/10">
                          <Clock size={10} /> {j.statut}
                        </span>
                      )}
                    </td>
                    <td className="py-4 px-6 text-xs text-slate-500 dark:text-slate-400 font-semibold tabular-nums">{j.commandes_creees || 0} créées, {j.commandes_maj || 0} maj, {j.erreurs || 0} erreurs</td>
                    <td className="py-4 px-6 text-xs text-slate-500 dark:text-slate-400 font-semibold tabular-nums">{j.duree_ms ? `${(j.duree_ms / 1000).toFixed(1)}s` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl shadow-sm overflow-hidden backdrop-blur-md">
        <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800/80 p-5">
          <Settings size={18} className="text-blue-600 dark:text-cyan-400" />
          <h3 className="text-base font-extrabold text-slate-800 dark:text-slate-200 tracking-tight">Utilisateurs ({users.length})</h3>
        </div>

        {users.length > 0 ? (
          <div className="overflow-x-auto w-full">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Username</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Email</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Rôle</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Actif</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
                {users.map((u, index) => (
                  <tr key={u.ID} className="hover:bg-slate-50/30 dark:hover:bg-slate-950/10 transition-colors duration-150 animate-slide-up" style={{ animationDelay: `${index * 0.02}s` }}>
                    <td className="py-4 px-6 font-bold text-slate-800 dark:text-slate-100">{u.username}</td>
                    <td className="py-4 px-6 text-xs text-slate-500 dark:text-slate-400">{u.email || '—'}</td>
                    <td className="py-4 px-6">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
                        u.role === 'ADMIN' ? 'bg-red-500/10 text-red-650 border border-red-500/20 dark:text-red-400 dark:bg-red-950/10' 
                        : u.role === 'MANAGER' ? 'bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400 dark:bg-amber-950/10' 
                        : 'bg-blue-500/10 text-blue-600 border-blue-500/20 dark:text-blue-450 dark:bg-blue-950/10'
                      }`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="py-4 px-6">
                      {u.actif ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 dark:text-emerald-400 dark:bg-emerald-950/10">Actif</span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-550 border border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700/50">Inactif</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500">
            <Settings size={48} className="opacity-30 mb-4 animate-float" />
            <p className="text-sm font-semibold">Aucun utilisateur</p>
          </div>
        )}
      </div>
    </div>
  );
}
