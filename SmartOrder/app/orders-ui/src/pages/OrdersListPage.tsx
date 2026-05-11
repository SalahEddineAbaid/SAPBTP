import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, Filter, ChevronLeft, ChevronRight } from 'lucide-react';
import { getOrders } from '../services/orderService';
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

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Commandes</h1>
          <p className="page-description">{total} commande(s) au total</p>
        </div>
      </div>

      <div className="filters-bar">
        <form onSubmit={e => { e.preventDefault(); setPage(0); }} className="search-bar" style={{ maxWidth: '300px' }}>
          <Search size={16} className="search-icon" />
          <input type="text" placeholder="N° SAP..." value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }} />
        </form>
        <Filter size={16} style={{ color: 'var(--text-muted)' }} />
        {STATUTS.map(s => (
          <button key={s || 'all'} className={`filter-chip ${statusFilter === s ? 'active' : ''}`}
            onClick={() => { setStatusFilter(s); setPage(0); }}>
            {s ? STATUS_LABELS[s] : 'Tous'}
          </button>
        ))}
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div className="loading-spinner"><div className="spinner" /></div>
        ) : orders.length === 0 ? (
          <div className="empty-state" style={{ padding: '48px' }}>Aucune commande trouvée</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>N° SAP</th><th>Type</th><th>Fournisseur</th><th>Statut</th><th>Montant</th><th>Date commande</th><th>Date prévue</th><th>Approbation</th><th>Risque ML</th></tr>
            </thead>
            <tbody>
              {orders.map(o => (
                <tr key={o.ID} onClick={() => navigate(`/orders/${o.ID}`)}>
                  <td style={{ fontWeight: 600, color: 'var(--accent-blue)' }}>{o.numero_sap}</td>
                  <td><span className="badge badge-neutral">{o.type_commande || o.type || '—'}</span></td>
                  <td>{o.fournisseur?.nom || '—'}</td>
                  <td>
                    <span className={`badge ${o.statut === 'LIVRE' ? 'badge-success' : o.statut === 'ANNULE' || o.statut === 'BLOQUE' ? 'badge-danger' : o.statut === 'EN_LIVRAISON' ? 'badge-warning' : 'badge-info'}`}>
                      {STATUS_LABELS[o.statut] || o.statut}
                    </span>
                  </td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{(o.montant_total || 0).toLocaleString('fr-FR')} {o.devise || ''}</td>
                  <td>{formatDate(o.date_commande || o.date_creation)}</td>
                  <td>{formatDate(o.date_previsionnelle)}</td>
                  <td>
                    <span className={`badge ${o.statut_approbation === 'X' ? 'badge-success' : o.statut_approbation === 'R' ? 'badge-danger' : 'badge-neutral'}`}>
                      {o.statut_approbation === 'X' ? 'Approuvée' : o.statut_approbation === 'R' ? 'Rejetée' : 'En attente'}
                    </span>
                  </td>
                  <td>
                    {o.prediction ? (
                      <div className="risk-indicator">
                        <div className={`risk-dot ${o.prediction.risque_label === 'ELEVE' ? 'high' : o.prediction.risque_label === 'MOYEN' ? 'medium' : 'low'}`} />
                        <span style={{ fontSize: '0.8rem' }}>{o.prediction.risque_label}</span>
                      </div>
                    ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {totalPages > 1 && (
          <div className="pagination" style={{ padding: '12px 16px' }}>
            <span className="pagination-info">Page {page + 1} / {totalPages} — {total} résultat(s)</span>
            <div className="pagination-buttons">
              <button className="btn btn-secondary btn-sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                <ChevronLeft size={16} /> Précédent
              </button>
              <button className="btn btn-secondary btn-sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                Suivant <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
