import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle, RefreshCw, Search, Truck } from 'lucide-react';
import { getFournisseurs } from '../services/orderService';
import type { Fournisseur } from '../types';

const PAGE_SIZE = 200;

function formatPercent(value?: number) {
  return `${Math.round((value ?? 0) * 100)}%`;
}

function performanceColor(score?: number) {
  const val = score ?? 0;
  if (val >= 0.85) return 'bg-emerald-500';
  if (val >= 0.65) return 'bg-amber-500';
  return 'bg-red-500';
}

function delayBadgeColor(rate?: number) {
  const val = rate ?? 0;
  if (val > 0.25) return 'bg-red-500/10 text-red-600 border-red-500/20 dark:text-red-400 dark:bg-red-950/10';
  if (val > 0.1) return 'bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400 dark:bg-amber-950/10';
  return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400 dark:bg-emerald-950/10';
}

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Fournisseur[]>([]);
  const [count, setCount] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadSuppliers = useCallback(async (query = '') => {
    setLoading(true);
    setError('');
    try {
      const result = await getFournisseurs({ top: PAGE_SIZE, search: query.trim() });
      setSuppliers(result.items);
      setCount(result.count);
    } catch (err) {
      setSuppliers([]);
      setCount(0);
      setError(err instanceof Error ? err.message : 'Erreur chargement fournisseurs.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => loadSuppliers(search), 350);
    return () => window.clearTimeout(timer);
  }, [loadSuppliers, search]);

  const summary = useMemo(() => {
    const risky = suppliers.filter((s) => (s.taux_retard_moyen ?? 0) > 0.1).length;
    const linkedOrders = suppliers.reduce((sum, s) => sum + (s.nombre_commandes || 0), 0);
    const inactive = suppliers.filter((s) => s.actif === false).length;
    return { risky, linkedOrders, inactive };
  }, [suppliers]);

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100 tracking-tight">Fournisseurs</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{count} fournisseur(s) au total</p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <label className="relative block">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Rechercher code SAP, nom, pays..."
              className="w-full sm:w-80 h-11 rounded-xl border border-slate-200 dark:border-[#1e2749] bg-white dark:bg-[#0f1633] pl-11 pr-4 text-sm font-medium text-slate-700 dark:text-slate-200 outline-none focus:border-blue-400 dark:focus:border-cyan-400"
            />
          </label>
          <button
            type="button"
            onClick={() => loadSuppliers(search)}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-[#1e2749] bg-white dark:bg-[#0f1633] px-4 text-sm font-bold text-slate-700 dark:text-slate-200 hover:border-blue-300 dark:hover:border-cyan-500 disabled:opacity-60"
            disabled={loading}
          >
            <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
            Actualiser
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border border-slate-200 dark:border-[#1e2749] bg-white dark:bg-[#0f1633]/60 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Commandes liées</p>
          <p className="mt-2 text-2xl font-extrabold text-slate-800 dark:text-slate-100">{summary.linkedOrders}</p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-[#1e2749] bg-white dark:bg-[#0f1633]/60 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Fournisseurs à risque</p>
          <p className="mt-2 text-2xl font-extrabold text-slate-800 dark:text-slate-100">{summary.risky}</p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-[#1e2749] bg-white dark:bg-[#0f1633]/60 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Inactifs</p>
          <p className="mt-2 text-2xl font-extrabold text-slate-800 dark:text-slate-100">{summary.inactive}</p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
          <AlertCircle size={18} />
          {error}
        </div>
      )}

      <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl shadow-sm overflow-hidden backdrop-blur-md">
        {loading ? (
          <div className="flex items-center justify-center min-h-[320px] w-full">
            <div className="animate-spin rounded-full h-10 w-10 border-4 border-slate-200 border-t-blue-600 dark:border-slate-800 dark:border-t-cyan-400" />
          </div>
        ) : suppliers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500">
            <Truck size={64} className="opacity-30 mb-4" />
            <p className="text-sm font-semibold text-center max-w-md leading-relaxed">
              Aucun fournisseur trouvé. Vérifiez la synchronisation SAP ou modifiez votre recherche.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto w-full">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Code SAP</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Nom</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Pays</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Performance</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Taux retard</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Commandes</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Statut</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((supplier, index) => (
                  <tr
                    key={supplier.ID}
                    className="border-b border-slate-100 dark:border-slate-800/50 hover:bg-slate-50/40 dark:hover:bg-slate-950/10 transition-colors duration-150 animate-slide-up"
                    style={{ animationDelay: `${index * 0.02}s` }}
                  >
                    <td className="py-4 px-6 font-bold text-slate-850 dark:text-slate-100 tabular-nums">{supplier.code_sap}</td>
                    <td className="py-4 px-6 font-semibold text-slate-800 dark:text-slate-200">{supplier.nom}</td>
                    <td className="py-4 px-6 text-slate-650 dark:text-slate-400 font-medium">{supplier.pays || '-'}</td>
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-3">
                        <div className="h-1.5 w-24 bg-slate-100 dark:bg-slate-900 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${performanceColor(supplier.score_performance)}`}
                            style={{ width: formatPercent(supplier.score_performance) }}
                          />
                        </div>
                        <span className="text-xs font-bold tabular-nums text-slate-700 dark:text-slate-300">{formatPercent(supplier.score_performance)}</span>
                      </div>
                    </td>
                    <td className="py-4 px-6">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider border ${delayBadgeColor(supplier.taux_retard_moyen)}`}>
                        {formatPercent(supplier.taux_retard_moyen)}
                      </span>
                    </td>
                    <td className="py-4 px-6 font-semibold tabular-nums text-slate-700 dark:text-slate-300">
                      {supplier.nombre_commandes || 0}
                      <span className="ml-2 text-xs font-medium text-slate-400">
                        {supplier.commandes_en_retard ? `${supplier.commandes_en_retard} en retard` : ''}
                      </span>
                    </td>
                    <td className="py-4 px-6">
                      <span className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider border ${
                        supplier.actif === false
                          ? 'border-slate-300 bg-slate-100 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400'
                          : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      }`}>
                        {supplier.actif === false ? <AlertCircle size={13} /> : <CheckCircle size={13} />}
                        {supplier.actif === false ? 'Inactif' : 'Actif'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
