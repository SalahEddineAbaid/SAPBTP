import { useState, useEffect } from 'react';
import { Play, RefreshCw, CheckCircle, XCircle, Clock, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import type { SyncJob } from '../../types';
import { fetchApi } from '../../services/apiClient';

export default function SyncSAPPage() {
  const { getAuthHeaders } = useAuth();
  const [syncJobs, setSyncJobs] = useState<SyncJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMode, setSyncMode] = useState<'DELTA' | 'FULL'>('DELTA');
  const [lastSync, setLastSync] = useState<SyncJob | null>(null);

  useEffect(() => {
    loadSyncJobs();
  }, []);

  const loadSyncJobs = async () => {
    try {
      setLoading(true);
      const res = await fetchApi('/api/admin/sync', {
        headers: getAuthHeaders(),
      }, { retries: 2, timeoutMs: 30000 });
      if (!res.ok) throw new Error('Erreur chargement jobs');
      const data = await res.json();
      const jobs = data.items || data.value || [];
      setSyncJobs(jobs);
      if (jobs.length > 0) {
        setLastSync(jobs[0]);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const waitForSyncJob = async (jobId: string) => {
    const maxAttempts = 90;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      const res = await fetchApi(`/api/admin/sync/${encodeURIComponent(jobId)}`, {
        headers: getAuthHeaders(),
      }, { retries: 1, timeoutMs: 30000 });
      if (!res.ok) continue;
      const job: SyncJob = await res.json();
      if (job.statut && job.statut !== 'EN_COURS') {
        await loadSyncJobs();
        if (job.statut === 'ECHEC') {
          throw new Error(job.error_message || 'La synchronisation SAP a echoue.');
        }
        return;
      }
    }
    await loadSyncJobs();
    throw new Error('La synchronisation prend trop de temps. Verifiez le statut dans l historique.');
  };

  const triggerSync = async () => {
    try {
      setSyncing(true);
      const res = await fetchApi('/api/admin/sync', {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ mode: syncMode }),
      }, { retries: 2, timeoutMs: 60000 });
      
      if (!res.ok) {
        const errorBody = await res.json().catch(() => null);
        throw new Error(errorBody?.error || errorBody?.message || 'Erreur déclenchement sync');
      }
      
      // Attendre 2 secondes puis recharger
      const responseBody = await res.json().catch(() => null);
      if (responseBody?.jobId) {
        await waitForSyncJob(responseBody.jobId);
      } else {
        await loadSyncJobs();
      }
      setSyncing(false);
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : 'Erreur lors du déclenchement de la synchronisation');
      setSyncing(false);
    }
  };

  const formatDate = (date?: string) => {
    if (!date) return '—';
    return new Date(date).toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDuration = (ms?: number) => {
    if (!ms) return '—';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'SUCCES': return <CheckCircle size={14} className="text-emerald-500" />;
      case 'ECHEC': return <XCircle size={14} className="text-red-500" />;
      case 'EN_COURS': return <Clock size={14} className="text-amber-500" />;
      default: return <Clock size={14} className="text-slate-400" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'SUCCES': return 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 dark:text-emerald-400 dark:bg-emerald-950/10';
      case 'ECHEC': return 'bg-red-500/10 text-red-650 border border-red-500/20 dark:text-red-400 dark:bg-red-950/10';
      case 'EN_COURS': return 'bg-amber-500/10 text-amber-600 border border-amber-500/20 dark:text-amber-400 dark:bg-amber-950/10';
      default: return 'bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:text-slate-350 dark:border-slate-700';
    }
  };

  const getModeBadge = (mode: string) => {
    return mode === 'FULL' 
      ? <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-purple-500/10 text-purple-500 border border-purple-500/20">FULL</span>
      : <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-500/10 text-blue-500 border border-blue-500/20">DELTA</span>;
  };

  if (loading) return <div className="flex items-center justify-center min-h-[300px] w-full"><div className="animate-spin rounded-full h-10 w-10 border-4 border-slate-200 border-t-blue-600 dark:border-slate-800 dark:border-t-cyan-400" /></div>;

  const btnActive = 'px-5 py-2 text-xs font-bold bg-gradient-to-r from-blue-600 to-sky-500 dark:from-cyan-500 dark:to-blue-600 text-white rounded-lg shadow-sm hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer';
  const btnInactive = 'px-5 py-2 text-xs font-bold border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-950 transition-all duration-200 cursor-pointer';

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100 tracking-tight">Synchronisation SAP</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Gérer la synchronisation avec SAP S/4HANA</p>
        </div>
      </div>

      {/* Carte de synchronisation */}
      <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl p-6 shadow-sm backdrop-blur-md">
        <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800/80 pb-4 mb-5">
          <h3 className="text-base font-extrabold text-slate-800 dark:text-slate-200 tracking-tight flex items-center gap-1.5">
            <RefreshCw size={16} className="text-blue-500 dark:text-cyan-400 animate-spin" style={{ animationDuration: '8s' }} />Synchronisation SAP S/4HANA
          </h3>
        </div>

        <div className="flex flex-col md:flex-row gap-6 items-stretch mb-6">
          {/* Mode de synchronisation */}
          <div className="flex-1">
            <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Mode de synchronisation</label>
            <div className="flex gap-2">
              <button
                className={syncMode === 'DELTA' ? btnActive : btnInactive}
                onClick={() => setSyncMode('DELTA')}
                disabled={syncing}
              >
                DELTA
              </button>
              <button
                className={syncMode === 'FULL' ? btnActive : btnInactive}
                onClick={() => setSyncMode('FULL')}
                disabled={syncing}
              >
                FULL
              </button>
            </div>
            {syncMode === 'FULL' && (
              <div className="mt-3.5 p-3 bg-amber-500/10 text-amber-600 border border-amber-500/20 text-xs font-semibold rounded-lg flex items-center gap-2 animate-pulse">
                <AlertTriangle size={15} className="flex-shrink-0" />
                <span>Le mode FULL peut prendre plusieurs minutes selon le volume de données.</span>
              </div>
            )}
          </div>

          {/* Dernière sync */}
          {lastSync && (
            <div className="flex-1 p-4 bg-slate-50 dark:bg-slate-900/40 border border-slate-200/40 dark:border-slate-800/40 rounded-xl flex items-center justify-center">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400 leading-relaxed text-center">
                Dernière sync : il y a {lastSync.started_at ? Math.floor((Date.now() - new Date(lastSync.started_at).getTime()) / 3600000) : 0}h {lastSync.started_at ? Math.floor(((Date.now() - new Date(lastSync.started_at).getTime()) % 3600000) / 60000) : 0}m <br/>
                <span className="font-bold text-slate-700 dark:text-slate-350">{lastSync.commandes_creees || 0} créées, {lastSync.commandes_maj || 0} mises à jour</span>
              </div>
            </div>
          )}
        </div>

        {/* Bouton de lancement */}
        <button
          className="w-full h-12 bg-gradient-to-r from-blue-600 to-sky-500 dark:from-cyan-500 dark:to-blue-600 text-white rounded-xl shadow-md font-bold hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60 cursor-pointer transition-all flex items-center justify-center gap-2 border-none"
          onClick={triggerSync}
          disabled={syncing}
        >
          {syncing ? (
            <>
              <RefreshCw size={16} className="animate-spin" />
              Synchronisation en cours...
            </>
          ) : (
            <>
              <Play size={16} fill="currentColor" />
              Lancer la synchronisation
            </>
          )}
        </button>
      </div>

      {/* Historique des synchronisations */}
      <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl shadow-sm overflow-hidden backdrop-blur-md">
        <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800/80 p-5">
          <h3 className="text-base font-extrabold text-slate-800 dark:text-slate-200 tracking-tight">📊 Historique des synchronisations</h3>
        </div>

        {syncJobs.length > 0 ? (
          <div className="overflow-x-auto w-full">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Date</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Mode</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Statut</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749] text-center">Créées</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749] text-center">Mises à jour</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749] text-center">Erreurs</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Durée</th>
                </tr>
              </thead>
              <tbody>
                {syncJobs.map((job, index) => (
                  <tr 
                    key={job.ID || `${job.started_at || job.createdAt || 'sync'}-${job.mode || 'mode'}-${index}`}
                    className="border-b border-slate-100 dark:border-slate-800/50 hover:bg-slate-50/30 dark:hover:bg-slate-950/10 transition-colors duration-150 animate-slide-up"
                    style={{ animationDelay: `${index * 0.02}s` }}
                  >
                    <td className="py-4 px-6 text-slate-600 dark:text-slate-400 text-xs font-semibold tabular-nums whitespace-nowrap">
                      {formatDate(job.started_at)}
                    </td>
                    <td className="py-4 px-6">
                      {getModeBadge(job.mode)}
                    </td>
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(job.statut)}
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${getStatusBadge(job.statut)}`}>
                          {job.statut === 'SUCCES' ? 'Succès' : job.statut === 'ECHEC' ? 'Échec' : job.statut}
                        </span>
                      </div>
                    </td>
                    <td className="py-4 px-6 text-center font-bold text-slate-700 dark:text-slate-300 tabular-nums">
                      {job.commandes_creees || 0}
                    </td>
                    <td className="py-4 px-6 text-center font-bold text-slate-700 dark:text-slate-300 tabular-nums">
                      {job.commandes_maj || 0}
                    </td>
                    <td className="py-4 px-6 text-center">
                      {job.erreurs ? (
                        <span className="text-red-500 dark:text-red-400 font-extrabold tabular-nums">
                          {job.erreurs}
                        </span>
                      ) : (
                        <span className="text-slate-400 dark:text-slate-600 font-medium">0</span>
                      )}
                    </td>
                    <td className="py-4 px-6 text-slate-550 dark:text-slate-400 text-xs font-semibold tabular-nums">
                      {formatDuration(job.duree_ms)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500">
            <RefreshCw size={48} className="opacity-30 mb-4 animate-float" />
            <p className="text-sm font-semibold">Aucune synchronisation effectuée</p>
          </div>
        )}
      </div>
    </div>
  );
}
