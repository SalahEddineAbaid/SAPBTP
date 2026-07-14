import { useState, useEffect } from 'react';
import { RefreshCw, Calendar, ArrowRight } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { fetchApi } from '../../services/apiClient';

interface AuditLog {
  ID: string;
  commande_ID?: string;
  user_ID?: string;
  ancien_statut: string;
  nouveau_statut: string;
  commentaire: string;
  source_changement: string;
  createdAt: string;
  user?: {
    username: string;
  };
  commande?: {
    numero_sap: string;
  };
}

export default function LogsPage() {
  const { getAuthHeaders } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateDebut, setDateDebut] = useState('');
  const [dateFin, setDateFin] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [sourceFilter, setSourceFilter] = useState('ALL');
  const [commandesMap, setCommandesMap] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    loadLogs();
  }, []);

  const loadLogs = async () => {
    try {
      setLoading(true);
      const res = await fetchApi('/api/admin/logs/history?limit=100', {
        headers: getAuthHeaders(),
      }, { retries: 2, timeoutMs: 30000 });
      if (!res.ok) throw new Error('Erreur chargement logs');
      const data = await res.json();
      const logsData = data.value || [];
      setLogs(logsData);
      
      // Charger les commandes pour obtenir les numero_sap
      const commandeIds = Array.from(new Set(logsData.map((log: AuditLog) => log.commande_ID).filter(Boolean)));
      if (commandeIds.length > 0) {
        await loadCommandes(commandeIds as string[]);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadCommandes = async (ids: string[]) => {
    try {
      const filter = ids.map(id => `ID eq ${id}`).join(' or ');
      const res = await fetchApi(`/odata/v4/orders/Orders?$filter=${encodeURIComponent(filter)}&$select=ID,numero_sap`, {
        headers: getAuthHeaders(),
      }, { retries: 2, timeoutMs: 30000 });
      if (res.ok) {
        const data = await res.json();
        const map = new Map<string, string>();
        (data.value || []).forEach((cmd: any) => {
          map.set(cmd.ID, cmd.numero_sap);
        });
        setCommandesMap(map);
      }
    } catch (err) {
      console.error('Erreur chargement commandes:', err);
    }
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'EN_ATTENTE': return 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800/50 dark:text-slate-300 dark:border-slate-700/50';
      case 'EN_COURS': return 'bg-blue-500/10 text-blue-600 border-blue-500/20 dark:text-blue-400 dark:bg-blue-950/10';
      case 'EN_LIVRAISON': return 'bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400 dark:bg-amber-950/10';
      case 'LIVRE': return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400 dark:bg-emerald-950/10';
      default: return 'bg-red-500/10 text-red-650 border border-red-500/20 dark:text-red-400 dark:bg-red-950/10';
    }
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      EN_ATTENTE: 'En attente',
      EN_COURS: 'En cours',
      EN_LIVRAISON: 'En livraison',
      LIVRE: 'Livré',
      ANNULE: 'Annulé',
      BLOQUE: 'Bloqué',
    };
    return labels[status] || status;
  };

  const getSourceBadge = (source: string) => {
    switch (source) {
      case 'SYNC_SAP': return <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-500 border border-amber-500/20">SYNC_SAP</span>;
      case 'APP_WEB': return <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-500/10 text-blue-500 border border-blue-500/20">APP_WEB</span>;
      case 'API': return <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-purple-500/10 text-purple-500 border border-purple-500/20">API</span>;
      default: return <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:text-slate-350 dark:border-slate-700">{source}</span>;
    }
  };

  const filteredLogs = logs.filter((log) => {
    const logDate = new Date(log.createdAt);
    const matchesDateDebut = !dateDebut || logDate >= new Date(dateDebut);
    const matchesDateFin = !dateFin || logDate <= new Date(dateFin);
    const matchesStatus = statusFilter === 'ALL' || log.nouveau_statut === statusFilter;
    const matchesSource = sourceFilter === 'ALL' || log.source_changement === sourceFilter;
    
    return matchesDateDebut && matchesDateFin && matchesStatus && matchesSource;
  });

  if (loading) return <div className="flex items-center justify-center min-h-[300px] w-full"><div className="animate-spin rounded-full h-10 w-10 border-4 border-slate-200 border-t-blue-600 dark:border-slate-800 dark:border-t-cyan-400" /></div>;

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100 tracking-tight">Logs système</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Historique des changements de statut — {filteredLogs.length} entrée{filteredLogs.length > 1 ? 's' : ''}
          </p>
        </div>
        <button 
          className="inline-flex items-center gap-2 px-3 py-1.5 h-8 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-950/80 cursor-pointer transition-all duration-200" 
          onClick={loadLogs}
        >
          <RefreshCw size={14} />
          Actualiser
        </button>
      </div>

      {/* Filtres */}
      <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl p-5 shadow-sm backdrop-blur-md">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Date début */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-bold text-slate-450 dark:text-slate-500 uppercase tracking-wider">
              <Calendar size={13} className="text-blue-500 dark:text-cyan-400" />
              Date début
            </label>
            <input
              type="datetime-local"
              className="w-full h-10 px-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-blue-600 dark:focus:border-cyan-400 transition-all cursor-pointer"
              value={dateDebut}
              onChange={(e) => setDateDebut(e.target.value)}
            />
          </div>

          {/* Date fin */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-bold text-slate-450 dark:text-slate-500 uppercase tracking-wider">
              <Calendar size={13} className="text-blue-500 dark:text-cyan-400" />
              Date fin
            </label>
            <input
              type="datetime-local"
              className="w-full h-10 px-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-blue-600 dark:focus:border-cyan-400 transition-all cursor-pointer"
              value={dateFin}
              onChange={(e) => setDateFin(e.target.value)}
            />
          </div>

          {/* Filtre Statut */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Statuts</label>
            <select
              className="w-full h-10 px-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-blue-600 dark:focus:border-cyan-400 transition-all cursor-pointer"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="ALL">Tous les statuts</option>
              <option value="EN_ATTENTE">En attente</option>
              <option value="EN_COURS">En cours</option>
              <option value="EN_LIVRAISON">En livraison</option>
              <option value="LIVRE">Livré</option>
              <option value="ANNULE">Annulé</option>
              <option value="BLOQUE">Bloqué</option>
            </select>
          </div>

          {/* Filtre Source */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Sources</label>
            <select
              className="w-full h-10 px-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-blue-600 dark:focus:border-cyan-400 transition-all cursor-pointer"
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
            >
              <option value="ALL">Toutes les sources</option>
              <option value="APP_WEB">APP_WEB</option>
              <option value="SYNC_SAP">SYNC_SAP</option>
              <option value="API">API</option>
            </select>
          </div>
        </div>
      </div>

      {/* Tableau des logs */}
      <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl shadow-sm overflow-hidden backdrop-blur-md">
        <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800/80 p-5">
          <h3 className="text-base font-extrabold text-slate-800 dark:text-slate-200 tracking-tight">📋 Historique d&apos;Audit</h3>
        </div>

        {filteredLogs.length > 0 ? (
          <div className="overflow-x-auto w-full">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Date/Heure</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Commande</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Utilisateur</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Transition</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Commentaire</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Source</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log, index) => (
                  <tr 
                    key={log.ID}
                    className="border-b border-slate-100 dark:border-slate-800/50 hover:bg-slate-50/30 dark:hover:bg-slate-950/10 transition-colors duration-150 animate-slide-up"
                    style={{ animationDelay: `${index * 0.02}s` }}
                  >
                    <td className="py-4 px-6 text-slate-600 dark:text-slate-400 text-xs font-semibold tabular-nums whitespace-nowrap">
                      {formatDate(log.createdAt)}
                    </td>
                    <td className="py-4 px-6 font-bold text-blue-600 dark:text-cyan-400">
                      {log.commande_ID ? commandesMap.get(log.commande_ID) || log.commande_ID.substring(0, 8) : '—'}
                    </td>
                    <td className="py-4 px-6 font-semibold text-slate-800 dark:text-slate-200 text-sm">
                      {log.user?.username || '—'}
                    </td>
                    <td className="py-4 px-6 text-xs">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${getStatusBadgeClass(log.ancien_statut)}`}>
                          {getStatusLabel(log.ancien_statut)}
                        </span>
                        <ArrowRight size={12} className="text-slate-400" />
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${getStatusBadgeClass(log.nouveau_statut)}`}>
                          {getStatusLabel(log.nouveau_statut)}
                        </span>
                      </div>
                    </td>
                    <td className="py-4 px-6 text-slate-700 dark:text-slate-350 text-sm max-w-xs break-words">
                      {log.commentaire}
                    </td>
                    <td className="py-4 px-6 text-xs">
                      {getSourceBadge(log.source_changement)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500">
            <RefreshCw size={48} className="opacity-30 mb-4 animate-float" />
            <p className="text-sm font-semibold">Aucun log trouvé</p>
          </div>
        )}
      </div>
    </div>
  );
}
