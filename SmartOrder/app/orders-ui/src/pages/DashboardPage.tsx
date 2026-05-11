import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingCart, AlertTriangle, DollarSign, TrendingUp, ArrowRight } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';
import { getOrders } from '../services/orderService';
import type { Order } from '../types';

const STATUS_COLORS: Record<string, string> = {
  EN_ATTENTE: '#64748b', EN_COURS: '#3b82f6', EN_LIVRAISON: '#f59e0b',
  LIVRE: '#10b981', ANNULE: '#ef4444', BLOQUE: '#8b5cf6',
};
const STATUS_LABELS: Record<string, string> = {
  EN_ATTENTE: 'En attente', EN_COURS: 'En cours', EN_LIVRAISON: 'En livraison',
  LIVRE: 'Livré', ANNULE: 'Annulé', BLOQUE: 'Bloqué',
};

export default function DashboardPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    getOrders({ top: 500 })
      .then(({ items }) => setOrders(items))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading-spinner"><div className="spinner" /></div>;

  const total = orders.length;
  const enRetard = orders.filter(o => (o.postes_en_retard ?? 0) > 0 || o.statut === 'BLOQUE').length;
  const montantTotal = orders.reduce((s, o) => s + (o.montant_total || 0), 0);
  const avgScore = total > 0 ? orders.reduce((s, o) => s + (o.score_priorite || 0), 0) / total : 0;

  const statusData = Object.entries(
    orders.reduce<Record<string, number>>((acc, o) => { acc[o.statut] = (acc[o.statut] || 0) + 1; return acc; }, {})
  ).map(([name, value]) => ({ name: STATUS_LABELS[name] || name, value, fill: STATUS_COLORS[name] || '#64748b' }));

  const urgentOrders = [...orders].sort((a, b) => (b.score_priorite || 0) - (a.score_priorite || 0)).slice(0, 5);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-description">Vue d'ensemble des commandes SmartOrder</p>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: 'var(--accent-blue-soft)' }}>
            <ShoppingCart size={24} color="var(--accent-blue)" />
          </div>
          <div><div className="kpi-value">{total}</div><div className="kpi-label">Commandes totales</div></div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: 'var(--status-danger-soft)' }}>
            <AlertTriangle size={24} color="var(--status-danger)" />
          </div>
          <div><div className="kpi-value" style={{ color: 'var(--status-danger)' }}>{enRetard}</div><div className="kpi-label">En retard / Bloquées</div></div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: 'var(--status-success-soft)' }}>
            <DollarSign size={24} color="var(--status-success)" />
          </div>
          <div><div className="kpi-value">{montantTotal.toLocaleString('fr-FR', { maximumFractionDigits: 0 })}</div><div className="kpi-label">Montant total</div></div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: 'var(--accent-purple-soft)' }}>
            <TrendingUp size={24} color="var(--accent-purple)" />
          </div>
          <div><div className="kpi-value">{avgScore.toFixed(1)}</div><div className="kpi-label">Score priorité moyen</div></div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)' }}>
        <div className="card">
          <div className="card-header"><h3 className="card-title">Répartition par statut</h3></div>
          {statusData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={statusData} cx="50%" cy="50%" innerRadius={60} outerRadius={100}
                  dataKey="value" paddingAngle={3} animationDuration={800}>
                  {statusData.map((entry, i) => <Cell key={i} fill={entry.fill} stroke="transparent" />)}
                </Pie>
                <Tooltip contentStyle={{ background: '#1a1f35', border: '1px solid #334155', borderRadius: '8px', color: '#f1f5f9' }} />
              </PieChart>
            </ResponsiveContainer>
          ) : <div className="empty-state">Aucune donnée</div>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
            {statusData.map(d => (
              <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem' }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: d.fill }} />
                <span style={{ color: 'var(--text-secondary)' }}>{d.name}: {d.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3 className="card-title">Top 5 — Priorité haute</h3></div>
          {urgentOrders.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={urgentOrders} layout="vertical" margin={{ left: 80 }}>
                <XAxis type="number" domain={[0, 100]} stroke="#64748b" fontSize={11} />
                <YAxis type="category" dataKey="numero_sap" stroke="#64748b" fontSize={11} width={75} />
                <Tooltip contentStyle={{ background: '#1a1f35', border: '1px solid #334155', borderRadius: '8px', color: '#f1f5f9' }} />
                <Bar dataKey="score_priorite" fill="#8b5cf6" radius={[0, 6, 6, 0]} animationDuration={800} />
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="empty-state">Aucune donnée</div>}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3 className="card-title">Commandes récentes</h3>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/orders')}>Voir tout <ArrowRight size={14} /></button>
        </div>
        {orders.length > 0 ? (
          <table className="data-table">
            <thead><tr><th>N° SAP</th><th>Fournisseur</th><th>Statut</th><th>Montant</th><th>Risque</th></tr></thead>
            <tbody>
              {orders.slice(0, 8).map(o => (
                <tr key={o.ID} onClick={() => navigate(`/orders/${o.ID}`)}>
                  <td style={{ fontWeight: 600 }}>{o.numero_sap}</td>
                  <td>{o.fournisseur?.nom || '—'}</td>
                  <td>
                    <span className={`badge ${o.statut === 'LIVRE' ? 'badge-success' : o.statut === 'BLOQUE' ? 'badge-danger' : o.statut === 'EN_LIVRAISON' ? 'badge-warning' : 'badge-info'}`}>
                      {STATUS_LABELS[o.statut] || o.statut}
                    </span>
                  </td>
                  <td>{(o.montant_total || 0).toLocaleString('fr-FR')} {o.devise || ''}</td>
                  <td>
                    {o.prediction ? (
                      <div className="risk-indicator">
                        <div className={`risk-dot ${o.prediction.risque_label === 'ELEVE' ? 'high' : o.prediction.risque_label === 'MOYEN' ? 'medium' : 'low'}`} />
                        <span>{o.prediction.risque_label}</span>
                      </div>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-state">
            <ShoppingCart size={48} />
            <p>Aucune commande. Lancez une synchronisation SAP depuis l'onglet Admin.</p>
          </div>
        )}
      </div>
    </div>
  );
}
