import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, Filter, ChevronLeft, ChevronRight, Package, Clock, CheckCircle, XCircle, AlertTriangle, Truck, Plus } from 'lucide-react';
import { getOrders } from '../services/orderService';
import { useAuth } from '../hooks/useAuth';
import type { Order } from '../types';

const STATUS_LABELS: Record<string, string> = {
  EN_ATTENTE: 'En attente', EN_COURS: 'En cours', EN_LIVRAISON: 'En livraison',
  LIVRE: 'Livré', ANNULE: 'Annulé', BLOQUE: 'Bloqué',
};
const STATUTS = ['', 'EN_ATTENTE', 'EN_COURS', 'EN_LIVRAISON', 'LIVRE', 'ANNULE', 'BLOQUE'];
const PAGE_SIZE = 20;

export default function OrdersListPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const canCreate = hasRole('MANAGER');

  useEffect(() => {
    const q = searchParams.get('search') || '';
    if (q) setSearch(q);
  }, [searchParams]);

  useEffect(() => {
    setLoading(true);
    const filter = statusFilter ? `statut eq '${statusFilter}'` : '';
    getOrders({ top: PAGE_SIZE, skip: page * PAGE_SIZE, filter, search })
      .then(({ items, count }) => { setOrders(items); setTotal(count); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [page, statusFilter, search]);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const formatDate = (d?: string) => d ? new Date(d).toLocaleDateString('fr-FR') : '—';

  // Fonction pour obtenir l'icône du statut
  const getStatusIcon = (statut: string) => {
    switch (statut) {
      case 'LIVRE': return <CheckCircle size={12} />;
      case 'ANNULE': return <XCircle size={12} />;
      case 'BLOQUE': return <AlertTriangle size={12} />;
      case 'EN_LIVRAISON': return <Truck size={12} />;
      case 'EN_COURS': return <Clock size={12} />;
      default: return <Package size={12} />;
    }
  };

  const badgeColor = (statut: string) => {
    switch (statut) {
      case 'LIVRE': return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 dark:bg-emerald-950/10';
      case 'ANNULE':
      case 'BLOQUE': return 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20 dark:bg-red-950/10';
      case 'EN_LIVRAISON': return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 dark:bg-amber-950/10';
      default: return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20 dark:bg-blue-950/10';
    }
  };

  const riskBadgeColor = (risk?: string) => {
    switch (risk) {
      case 'ELEVE': return 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]';
      case 'MOYEN': return 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]';
      default: return 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]';
    }
  };

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100 tracking-tight">Commandes</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{total} commande(s) au total</p>
        </div>
        {/* Bouton Nouvelle commande — visible MANAGER et ADMIN */}
        {canCreate && (
          <button
            id="btn-new-order"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-gradient-to-r from-blue-600 to-sky-500 dark:from-cyan-500 dark:to-blue-600 text-white shadow-md hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer"
            onClick={() => navigate('/orders/new')}
          >
            <Plus size={16} /> Nouvelle commande
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 p-1.5 bg-slate-100 dark:bg-slate-900/30 border border-slate-200/50 dark:border-slate-800 rounded-xl">
        <form onSubmit={e => { e.preventDefault(); setPage(0); }} className="relative w-full md:max-w-[240px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input 
            type="text" 
            placeholder="Rechercher N° SAP..." 
            className="w-full h-9 pl-9 pr-3 bg-white dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-blue-600 dark:focus:border-cyan-400 focus:ring-1 focus:ring-blue-600/20 dark:focus:ring-cyan-400/20 transition-all placeholder-slate-400"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }} 
          />
        </form>
        <div className="h-6 w-px bg-slate-200 dark:bg-slate-800 mx-1 hidden sm:block" />
        {STATUTS.map(s => (
          <button 
            key={s || 'all'} 
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 cursor-pointer ${
              statusFilter === s 
                ? 'bg-white dark:bg-slate-950 text-blue-600 dark:text-cyan-400 shadow-sm border border-slate-200/50 dark:border-slate-800' 
                : 'text-slate-600 dark:text-slate-400 hover:bg-white/50 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-white border border-transparent'
            }`}
            onClick={() => { setStatusFilter(s); setPage(0); }}
          >
            {s && getStatusIcon(s)}
            {s ? STATUS_LABELS[s] : 'Tous'}
          </button>
        ))}
      </div>

      <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl shadow-sm overflow-hidden backdrop-blur-md">
        {loading ? (
          <div className="flex items-center justify-center min-h-[300px] w-full"><div className="animate-spin rounded-full h-10 w-10 border-4 border-slate-200 border-t-blue-600 dark:border-slate-800 dark:border-t-cyan-400" /></div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500">
            <Package size={64} className="opacity-30 mb-4 animate-float" />
            <p className="text-sm font-semibold">Aucune commande trouvée</p>
          </div>
        ) : (
          <div className="overflow-x-auto w-full">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">N° SAP</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Type</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Fournisseur</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Statut</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Montant</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Date commande</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Date prévue</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Approbation</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Risque ML</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o, index) => (
                  <tr 
                    key={o.ID} 
                    onClick={() => navigate(`/orders/${o.ID}`)} 
                    className="cursor-pointer hover:bg-slate-50/50 dark:hover:bg-slate-950/20 border-b border-slate-100 dark:border-slate-800/50 transition-colors duration-150 animate-slide-up"
                    style={{ animationDelay: `${index * 0.02}s` }}
                  >
                    <td className="py-4 px-6 font-semibold text-blue-600 dark:text-cyan-400">{o.numero_sap}</td>
                    <td className="py-4 px-6">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-800/50 dark:text-slate-300 dark:border-slate-700/50">{o.type_commande || o.type || '—'}</span>
                    </td>
                    <td className="py-4 px-6 font-medium text-slate-800 dark:text-slate-200">{o.fournisseur?.nom || '—'}</td>
                    <td className="py-4 px-6">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider border ${badgeColor(o.statut)}`}>
                        {getStatusIcon(o.statut)}
                        {STATUS_LABELS[o.statut] || o.statut}
                      </span>
                    </td>
                    <td className="py-4 px-6 font-bold tabular-nums text-slate-800 dark:text-slate-100">
                      {(o.montant_total || 0).toLocaleString('fr-FR')} {o.devise || '€'}
                    </td>
                    <td className="py-4 px-6 text-slate-500 dark:text-slate-400 text-xs">
                      {formatDate(o.date_commande || o.date_creation)}
                    </td>
                    <td className="py-4 px-6 text-slate-500 dark:text-slate-400 text-xs">
                      {formatDate(o.date_previsionnelle)}
                    </td>
                    <td className="py-4 px-6">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
                        o.statut_approbation === 'X' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400 dark:bg-emerald-950/10' : 
                        o.statut_approbation === 'R' ? 'bg-red-500/10 text-red-600 border-red-500/20 dark:text-red-400 dark:bg-red-950/10' : 
                        'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800/50 dark:text-slate-300 dark:border-slate-700/50'
                      }`}>
                        {o.statut_approbation === 'X' && <CheckCircle size={12} />}
                        {o.statut_approbation === 'R' && <XCircle size={12} />}
                        {o.statut_approbation === 'X' ? 'Approuvée' : o.statut_approbation === 'R' ? 'Rejetée' : 'En attente'}
                      </span>
                    </td>
                    <td className="py-4 px-6">
                      {o.prediction ? (
                        <div className="flex items-center gap-1.5">
                          <div className={`w-2.5 h-2.5 rounded-full ${riskBadgeColor(o.prediction.risque_label)}`} />
                          <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                            {o.prediction.risque_label}
                          </span>
                        </div>
                      ) : <span className="text-slate-400 dark:text-slate-500">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {totalPages > 1 && (
          <div className="flex items-center justify-between gap-4 flex-wrap border-t border-slate-100 dark:border-slate-800/80 p-4">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Page {page + 1} / {totalPages} — {total} résultat(s)</span>
            <div className="flex items-center gap-2">
              <button 
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-950/80 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-all duration-200"
                disabled={page === 0} 
                onClick={() => setPage(p => p - 1)}
              >
                <ChevronLeft size={16} /> Précédent
              </button>
              <button 
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-950/80 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-all duration-200"
                disabled={page >= totalPages - 1} 
                onClick={() => setPage(p => p + 1)}
              >
                Suivant <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
