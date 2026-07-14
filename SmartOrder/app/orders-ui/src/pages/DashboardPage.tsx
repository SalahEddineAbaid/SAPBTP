import { useState, useEffect } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import {
  ShoppingCart, AlertTriangle, DollarSign, TrendingUp, ArrowRight,
  CheckCircle, Clock, Package, ArrowUp, ArrowDown, Activity, Zap
} from 'lucide-react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar,
  XAxis, YAxis, Tooltip, Area, AreaChart, CartesianGrid
} from 'recharts';
import { getOrders } from '../services/orderService';
import { useAuth } from '../hooks/useAuth';
import type { Order } from '../types';

/* ── Palette & Labels ─────────────────────────────── */
const STATUS_COLORS: Record<string, string> = {
  EN_ATTENTE:  '#64748b',
  EN_COURS:    '#3b82f6',
  EN_LIVRAISON:'#f59e0b',
  LIVRE:       '#10b981',
  ANNULE:      '#ef4444',
  BLOQUE:      '#8b5cf6',
};

const STATUS_GRADIENTS: Record<string, [string, string]> = {
  EN_ATTENTE:  ['#94a3b8', '#64748b'],
  EN_COURS:    ['#60a5fa', '#3b82f6'],
  EN_LIVRAISON:['#fcd34d', '#f59e0b'],
  LIVRE:       ['#34d399', '#10b981'],
  ANNULE:      ['#f87171', '#ef4444'],
  BLOQUE:      ['#a78bfa', '#8b5cf6'],
};

const STATUS_LABELS: Record<string, string> = {
  EN_ATTENTE: 'En attente', EN_COURS: 'En cours', EN_LIVRAISON: 'En livraison',
  LIVRE: 'Livré', ANNULE: 'Annulé', BLOQUE: 'Bloqué',
};

/* ── Main Component ───────────────────────────────── */
export default function DashboardPage() {
  const { hasRole } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSegIdx, setActiveSegIdx] = useState<number | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    getOrders({ top: 500 })
      .then(({ items }) => setOrders(items))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (!hasRole('MANAGER')) return <Navigate to="/orders" replace />;
  if (loading) return <div className="flex items-center justify-center min-h-[300px] w-full"><div className="animate-spin rounded-full h-10 w-10 border-4 border-slate-200 border-t-blue-600 dark:border-slate-800 dark:border-t-cyan-400" /></div>;

  /* ── Computed KPIs ── */
  const total       = orders.length;
  const enRetard    = orders.filter(o => (o.postes_en_retard ?? 0) > 0 || o.statut === 'BLOQUE').length;
  const livrees     = orders.filter(o => o.statut === 'LIVRE').length;
  const enCours     = orders.filter(o => o.statut === 'EN_COURS' || o.statut === 'EN_LIVRAISON').length;
  const montantTotal = orders.reduce((s, o) => s + (o.montant_total || 0), 0);
  const avgScore    = total > 0 ? orders.reduce((s, o) => s + (o.score_priorite || 0), 0) / total : 0;
  const performanceRate = total > 0 ? ((livrees / total) * 100).toFixed(1) : '0.0';

  /* ── Chart Data ── */
  const performanceData = [
    { month: 'Jan', value: 85 },
    { month: 'Fév', value: 88 },
    { month: 'Mar', value: 82 },
    { month: 'Avr', value: 90 },
    { month: 'Mai', value: 94 },
    { month: 'Juin', value: parseFloat(performanceRate) },
  ];

  const statusData = Object.entries(
    orders.reduce<Record<string, number>>((acc, o) => {
      acc[o.statut] = (acc[o.statut] || 0) + 1; return acc;
    }, {})
  ).map(([key, value]) => ({
    name:  STATUS_LABELS[key] || key,
    value,
    fill:  STATUS_COLORS[key] || '#64748b',
    key,
  }));

  const urgentOrders = [...orders]
    .sort((a, b) => (b.score_priorite || 0) - (a.score_priorite || 0))
    .slice(0, 5);

  const maxScore = Math.max(...urgentOrders.map(o => o.score_priorite || 0), 1);

  const formatCurrency = (amount: number) => {
    return (amount / 1000).toFixed(0) + 'K';
  };

  return (
    <div className="animate-fade-in space-y-6">
      {/* ── Page Header ─────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100 tracking-tight">Dashboard</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Vue d&apos;ensemble des commandes SmartOrder</p>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-100 dark:bg-slate-900/30 border border-slate-200/50 dark:border-slate-800 text-xs font-semibold text-slate-500 dark:text-slate-400 rounded-full w-fit">
          <Activity size={13} className="text-blue-500 dark:text-cyan-400" />
          <span>Mis à jour à l&apos;instant</span>
        </div>
      </div>

      {/* ── KPI Row ─────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* PERFORMANCE — wide card */}
        <div className="xl:col-span-2 bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl p-6 shadow-sm flex flex-col justify-between backdrop-blur-md relative overflow-hidden group">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 to-sky-400 dark:from-cyan-500 dark:to-blue-500" />
          <div className="flex justify-between items-start mb-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Performance Globale</div>
              <div className="text-4xl font-extrabold tracking-tight text-slate-800 dark:text-white tabular-nums flex items-baseline gap-0.5 mt-1">
                {performanceRate}
                <span className="text-lg font-bold text-slate-400 dark:text-slate-500">%</span>
              </div>
            </div>
            <div className="flex items-center gap-1 px-2.5 py-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-xs font-bold rounded-lg">
              <ArrowUp size={12} strokeWidth={3} />
              <span>+2.4% vs mois dernier</span>
            </div>
          </div>

          <div className="h-44 min-h-[176px] w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={performanceData} margin={{ top: 4, right: 4, left: -32, bottom: 0 }}>
                <defs>
                  <linearGradient id="perfGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} className="dark:stroke-slate-800/40" />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                <YAxis domain={[75, 100]} tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, fontSize: '0.8rem', boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }}
                  formatter={(v: any) => [`${v}%`, 'Performance']}
                />
                <Area type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2.5} fill="url(#perfGrad)" dot={false} activeDot={{ r: 5, fill: '#3b82f6', stroke: '#fff', strokeWidth: 2 }} animationDuration={900} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-3 gap-4 mt-6 pt-6 border-t border-slate-100 dark:border-slate-800/80">
            <div className="flex flex-col items-center justify-center p-3 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200/40 dark:border-slate-800/40">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-emerald-500/10 text-emerald-500">
                <CheckCircle size={15} strokeWidth={2.5} />
              </div>
              <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider mt-2">Livrées</div>
              <div className="text-lg font-bold text-slate-800 dark:text-slate-200 mt-0.5">{livrees}</div>
            </div>
            <div className="flex flex-col items-center justify-center p-3 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200/40 dark:border-slate-800/40">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-blue-500/10 text-blue-500">
                <Clock size={15} strokeWidth={2.5} />
              </div>
              <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider mt-2">En cours</div>
              <div className="text-lg font-bold text-slate-800 dark:text-slate-200 mt-0.5">{enCours}</div>
            </div>
            <div className="flex flex-col items-center justify-center p-3 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200/40 dark:border-slate-800/40">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-red-500/10 text-red-500">
                <AlertTriangle size={15} strokeWidth={2.5} />
              </div>
              <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider mt-2">Retard</div>
              <div className={`text-lg font-bold mt-0.5 ${enRetard > 0 ? 'text-red-500 dark:text-red-400' : 'text-slate-800 dark:text-slate-200'}`}>{enRetard}</div>
            </div>
          </div>
        </div>

        {/* RIGHT KPI CARDS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-4">
          {/* Commandes */}
          <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl p-5 shadow-sm relative overflow-hidden backdrop-blur-md flex flex-col justify-between group">
            <div className="flex justify-between items-start w-full">
              <div className="w-9 h-9 rounded-lg bg-blue-500/10 text-blue-500 flex items-center justify-center">
                <ShoppingCart size={18} />
              </div>
              <span className="flex items-center gap-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">
                <ArrowUp size={10} strokeWidth={3} />+12%
              </span>
            </div>
            <div className="mt-4">
              <div className="text-2xl font-extrabold text-slate-800 dark:text-slate-100 tabular-nums">{total}</div>
              <div className="text-xs font-bold text-slate-400 dark:text-slate-500 mt-0.5">Commandes totales</div>
              <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-900 rounded-full mt-3 overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full transition-all duration-500" style={{ width: `${Math.min((total / 20) * 100, 100)}%` }} />
              </div>
            </div>
          </div>

          {/* Montant */}
          <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl p-5 shadow-sm relative overflow-hidden backdrop-blur-md flex flex-col justify-between group">
            <div className="flex justify-between items-start w-full">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
                <DollarSign size={18} />
              </div>
              <span className="flex items-center gap-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">
                <ArrowUp size={10} strokeWidth={3} />+8%
              </span>
            </div>
            <div className="mt-4">
              <div className="text-2xl font-extrabold text-slate-800 dark:text-slate-100 tabular-nums">{formatCurrency(montantTotal)}</div>
              <div className="text-xs font-bold text-slate-400 dark:text-slate-500 mt-0.5">Montant total (€)</div>
              <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-900 rounded-full mt-3 overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full transition-all duration-500" style={{ width: '72%' }} />
              </div>
            </div>
          </div>

          {/* Score */}
          <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl p-5 shadow-sm relative overflow-hidden backdrop-blur-md flex flex-col justify-between group">
            <div className="flex justify-between items-start w-full">
              <div className="w-9 h-9 rounded-lg bg-purple-500/10 text-purple-500 flex items-center justify-center">
                <TrendingUp size={18} />
              </div>
              <span className="flex items-center gap-0.5 text-[10px] font-bold text-red-600 dark:text-red-400 bg-red-500/10 px-2 py-0.5 rounded">
                <ArrowDown size={10} strokeWidth={3} />-3%
              </span>
            </div>
            <div className="mt-4">
              <div className="text-2xl font-extrabold text-slate-800 dark:text-slate-100 tabular-nums">{avgScore.toFixed(1)}</div>
              <div className="text-xs font-bold text-slate-400 dark:text-slate-500 mt-0.5">Score priorité moyen</div>
              <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-900 rounded-full mt-3 overflow-hidden">
                <div className="h-full bg-purple-500 rounded-full transition-all duration-500" style={{ width: `${Math.min((avgScore / 100) * 100, 100)}%` }} />
              </div>
            </div>
          </div>

          {/* Retard */}
          <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl p-5 shadow-sm relative overflow-hidden backdrop-blur-md flex flex-col justify-between group">
            <div className="flex justify-between items-start w-full">
              <div className="w-9 h-9 rounded-lg bg-red-500/10 text-red-500 flex items-center justify-center">
                <Package size={18} />
              </div>
              {enRetard > 0 && (
                <span className="flex items-center gap-1 text-[10px] font-bold text-red-600 dark:text-red-400 bg-red-500/10 px-2.5 py-0.5 rounded animate-pulse">
                  <Zap size={10} />Action
                </span>
              )}
            </div>
            <div className="mt-4">
              <div className={`text-2xl font-extrabold tabular-nums ${enRetard > 0 ? 'text-red-500 dark:text-red-400' : 'text-slate-800 dark:text-slate-100'}`}>{enRetard}</div>
              <div className="text-xs font-bold text-slate-400 dark:text-slate-500 mt-0.5">En retard / Bloquées</div>
              <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-900 rounded-full mt-3 overflow-hidden">
                <div className="h-full bg-red-500 rounded-full transition-all duration-500" style={{ width: `${Math.min((enRetard / Math.max(total, 1)) * 100, 100)}%` }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Charts Row ──────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Répartition par statut */}
        <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl p-6 shadow-sm flex flex-col justify-between backdrop-blur-md">
          <div className="flex justify-between items-start border-b border-slate-100 dark:border-slate-800/80 pb-4 mb-6">
            <div>
              <h3 className="text-base font-extrabold text-slate-800 dark:text-slate-200 tracking-tight">Répartition par statut</h3>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{total} commandes au total</p>
            </div>
            <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400">{statusData.length} statuts</span>
          </div>

          {statusData.length > 0 ? (() => {
            const activeSeg = activeSegIdx !== null ? statusData[activeSegIdx] : null;
            const activePct = activeSeg && total > 0
              ? Math.round((activeSeg.value / total) * 100)
              : null;
            return (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
                <div className="relative w-48 h-48 min-w-[192px] min-h-[192px] flex-shrink-0 flex items-center justify-center bg-transparent">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <defs>
                        {statusData.map((d, i) => {
                          const [c1, c2] = STATUS_GRADIENTS[d.key] || [d.fill, d.fill];
                          return (
                            <linearGradient key={i} id={`pie-g-${i}`} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={c1} />
                              <stop offset="100%" stopColor={c2} />
                            </linearGradient>
                          );
                        })}
                      </defs>
                      <Pie
                        data={statusData}
                        cx="50%" cy="50%"
                        innerRadius={56} outerRadius={88}
                        dataKey="value"
                        paddingAngle={3}
                        animationDuration={900}
                        animationBegin={100}
                        onMouseEnter={(_, idx) => setActiveSegIdx(idx)}
                        onMouseLeave={() => setActiveSegIdx(null)}
                        style={{ cursor: 'pointer', outline: 'none' }}
                      >
                        {statusData.map((_, i) => (
                          <Cell
                            key={i}
                            fill={`url(#pie-g-${i})`}
                            stroke="transparent"
                            opacity={activeSegIdx === null || activeSegIdx === i ? 1 : 0.45}
                            style={{ transition: 'opacity 200ms ease, filter 200ms ease' }}
                          />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>

                  {/* Dynamic centre label */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none select-none z-10">
                    {activeSeg ? (
                      <div className="flex flex-col items-center justify-center p-2">
                        <div className="flex items-center gap-1">
                          <span
                            className="w-1.5 h-1.5 rounded-full inline-block"
                            style={{ background: activeSeg.fill }}
                          />
                          <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">{activeSeg.name}</span>
                        </div>
                        <span
                          className="text-2xl font-black tabular-nums mt-0.5"
                          style={{ color: activeSeg.fill }}
                        >
                          {activeSeg.value}
                        </span>
                        <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide">
                          {activePct}%
                        </span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center">
                        <span className="text-2xl font-black text-slate-800 dark:text-white tabular-nums">{total}</span>
                        <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide">commandes</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex-1 w-full flex flex-col gap-2.5">
                  {statusData.map((d, i) => {
                    const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
                    const isActive = activeSegIdx === i;
                    return (
                      <div
                        key={i}
                        className={`flex items-center justify-between text-xs p-1.5 rounded-lg transition-all duration-150 ${isActive ? 'bg-slate-50 dark:bg-slate-900/50' : 'bg-transparent'}`}
                        onMouseEnter={() => setActiveSegIdx(i)}
                        onMouseLeave={() => setActiveSegIdx(null)}
                        style={{ cursor: 'default' }}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0 transition-transform duration-150"
                            style={{
                              background: d.fill,
                              transform: isActive ? 'scale(1.3)' : 'scale(1)',
                            }}
                          />
                          <span
                            className={`text-slate-600 dark:text-slate-300 font-medium ${isActive ? 'text-slate-900 dark:text-white font-semibold' : ''}`}
                          >
                            {d.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="w-20 bg-slate-100 dark:bg-slate-950/50 h-1.5 rounded-full overflow-hidden mx-3 flex-shrink-0 hidden md:block">
                            <div
                              className="h-full rounded-full transition-all duration-300"
                              style={{
                                width: `${pct}%`,
                                background: d.fill,
                                opacity: isActive ? 1 : 0.7,
                              }}
                            />
                          </div>
                          <span className="font-bold tabular-nums text-right w-6" style={{ color: isActive ? d.fill : undefined }}>
                            {d.value}
                          </span>
                          <span className="text-slate-400 dark:text-slate-500 text-[10px] text-right font-medium w-8">{pct}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })() : <div className="flex items-center justify-center py-12 text-slate-400 dark:text-slate-500 text-sm font-semibold">Aucune donnée</div>}
        </div>

        {/* Top 5 Priorité haute */}
        <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl p-6 shadow-sm flex flex-col justify-between backdrop-blur-md">
          <div className="flex justify-between items-start border-b border-slate-100 dark:border-slate-800/80 pb-4 mb-6">
            <div>
              <h3 className="text-base font-extrabold text-slate-800 dark:text-slate-200 tracking-tight">Top 5 — Priorité haute</h3>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Commandes à traiter en urgence</p>
            </div>
            <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">Score</span>
          </div>

          {urgentOrders.length > 0 ? (
            <div className="flex flex-col gap-4 flex-1 justify-center">
              {urgentOrders.map((o, i) => {
                const pct = maxScore > 0 ? (o.score_priorite || 0) / maxScore * 100 : 0;
                const score = o.score_priorite || 0;
                const color = score >= 70 ? '#ef4444' : score >= 45 ? '#f59e0b' : '#8b5cf6';
                return (
                  <div
                    key={o.ID}
                    className="flex items-center gap-4 p-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-950/20 cursor-pointer transition-all duration-150 animate-slide-right"
                    style={{ animationDelay: `${i * 50}ms` }}
                    onClick={() => navigate(`/orders/${o.ID}`)}
                  >
                    <div className="text-sm font-black w-6 text-center" style={{ color }}>{i + 1}</div>
                    <div className="flex-1">
                      <div className="text-xs font-semibold text-slate-400 dark:text-slate-500 mb-1">{o.numero_sap}</div>
                      <div className="w-full bg-slate-100 dark:bg-slate-950/50 h-2 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-700 ease-out"
                          style={{ width: `${pct}%`, backgroundColor: color }}
                        />
                      </div>
                    </div>
                    <div className="text-sm font-extrabold w-12 text-right tabular-nums" style={{ color }}>{score.toFixed(0)}</div>
                  </div>
                );
              })}
            </div>
          ) : <div className="flex items-center justify-center py-12 text-slate-400 dark:text-slate-500 text-sm font-semibold">Aucune donnée</div>}
        </div>
      </div>

      {/* ── Recent Orders ───────────────────────────── */}
      <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl p-6 shadow-sm flex flex-col justify-between backdrop-blur-md w-full overflow-hidden">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h3 className="text-base font-extrabold text-slate-800 dark:text-slate-200 tracking-tight">Commandes récentes</h3>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">8 dernières commandes</p>
          </div>
          <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-500 hover:text-slate-800 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-900 transition-all cursor-pointer border border-transparent hover:border-slate-200 dark:hover:border-slate-800" onClick={() => navigate('/orders')}>
            Voir tout <ArrowRight size={14} />
          </button>
        </div>

        {orders.length > 0 ? (
          <div className="overflow-x-auto w-full">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-3.5 px-4 border-b border-slate-200 dark:border-[#1e2749]">N° SAP</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-3.5 px-4 border-b border-slate-200 dark:border-[#1e2749]">Fournisseur</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-3.5 px-4 border-b border-slate-200 dark:border-[#1e2749]">Statut</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-3.5 px-4 border-b border-slate-200 dark:border-[#1e2749]">Montant</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-3.5 px-4 border-b border-slate-200 dark:border-[#1e2749]">Risque</th>
                </tr>
              </thead>
              <tbody>
                {orders.slice(0, 8).map(o => (
                  <tr key={o.ID} onClick={() => navigate(`/orders/${o.ID}`)} className="cursor-pointer hover:bg-slate-50/50 dark:hover:bg-slate-950/20 border-b border-slate-100 dark:border-slate-800/50 transition-colors duration-150">
                    <td className="py-3.5 px-4 font-semibold text-blue-600 dark:text-cyan-400">{o.numero_sap}</td>
                    <td className="py-3.5 px-4 font-semibold text-slate-800 dark:text-slate-200">{o.fournisseur?.nom || '—'}</td>
                    <td className="py-3.5 px-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider border ${
                        o.statut === 'LIVRE'       ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400 dark:bg-emerald-950/10' :
                        o.statut === 'BLOQUE'      ? 'bg-red-500/10 text-red-600 border-red-500/20 dark:text-red-400 dark:bg-red-950/10'  :
                        o.statut === 'EN_LIVRAISON'? 'bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400 dark:bg-amber-950/10' :
                        'bg-blue-500/10 text-blue-600 border-blue-500/20 dark:text-blue-400 dark:bg-blue-950/10'
                      }`}>
                        {o.statut === 'LIVRE'       && <CheckCircle size={11} />}
                        {o.statut === 'BLOQUE'      && <AlertTriangle size={11} />}
                        {o.statut === 'EN_LIVRAISON'&& <Package size={11} />}
                        {STATUS_LABELS[o.statut] || o.statut}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-bold tabular-nums text-slate-800 dark:text-slate-100">
                      {(o.montant_total || 0).toLocaleString('fr-FR')} {o.devise || '€'}
                    </td>
                    <td className="py-3.5 px-4">
                      {o.prediction ? (
                        <div className="flex items-center gap-1.5">
                          <div className={`w-2.5 h-2.5 rounded-full ${
                            o.prediction.risque_label === 'ELEVE' ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]' :
                            o.prediction.risque_label === 'MOYEN' ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]' :
                            'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]'
                          }`} />
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
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500">
            <ShoppingCart size={44} className="opacity-30 mb-4 animate-float" />
            <p className="text-sm font-semibold">Aucune commande. Lancez une synchronisation SAP depuis l&apos;onglet Admin.</p>
          </div>
        )}
      </div>
    </div>
  );
}
