import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Package, Truck, User, Brain, Clock } from 'lucide-react';
import { getOrder, changeStatus } from '../services/orderService';
import type { Order } from '../types';

const STATUS_LABELS: Record<string, string> = {
  EN_ATTENTE: 'En attente', EN_COURS: 'En cours', EN_LIVRAISON: 'En livraison',
  LIVRE: 'Livré', ANNULE: 'Annulé', BLOQUE: 'Bloqué',
};
const TRANSITIONS: Record<string, string[]> = {
  EN_ATTENTE: ['EN_COURS', 'ANNULE'], EN_COURS: ['EN_LIVRAISON', 'BLOQUE', 'ANNULE'],
  EN_LIVRAISON: ['LIVRE', 'BLOQUE'], BLOQUE: ['EN_COURS', 'ANNULE'], LIVRE: [], ANNULE: [],
};

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [newStatus, setNewStatus] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  const loadOrder = () => {
    if (!id) return;
    setLoading(true);
    getOrder(id).then(setOrder).catch(console.error).finally(() => setLoading(false));
  };
  useEffect(loadOrder, [id]);

  const handleChangeStatus = async () => {
    if (!id || comment.length < 5) return;
    setSaving(true);
    try {
      await changeStatus(id, newStatus, comment);
      setShowModal(false); setComment('');
      loadOrder();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Erreur');
    } finally { setSaving(false); }
  };

  const formatDate = (d?: string) => d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  if (loading) return <div className="loading-spinner"><div className="spinner" /></div>;
  if (!order) return <div className="empty-state">Commande introuvable</div>;

  const pred = order.prediction;
  const allowed = TRANSITIONS[order.statut] || [];

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button className="btn btn-ghost" onClick={() => navigate('/orders')}><ArrowLeft size={18} /></button>
          <div>
            <h1 className="page-title">Commande {order.numero_sap}</h1>
            <p className="page-description">Type: {order.type_commande || order.type || '—'} • Créée le {formatDate(order.date_creation)}</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-secondary btn-sm" onClick={loadOrder}><RefreshCw size={14} /> Actualiser</button>
          {allowed.length > 0 && <button className="btn btn-primary btn-sm" onClick={() => setShowModal(true)}>Changer statut</button>}
        </div>
      </div>

      <div className="detail-grid">
        <div className="card">
          <div className="card-header">
            <h3 className="card-title"><Package size={16} style={{ marginRight: 6 }} />Informations</h3>
            <span className={`badge ${order.statut === 'LIVRE' ? 'badge-success' : order.statut === 'BLOQUE' || order.statut === 'ANNULE' ? 'badge-danger' : 'badge-info'}`}>
              {STATUS_LABELS[order.statut]}
            </span>
          </div>
          <div className="detail-row"><span className="detail-label">N° SAP</span><span className="detail-value">{order.numero_sap}</span></div>
          <div className="detail-row"><span className="detail-label">Montant total</span><span className="detail-value">{(order.montant_total || 0).toLocaleString('fr-FR')} {order.devise}</span></div>
          <div className="detail-row"><span className="detail-label">Date commande</span><span className="detail-value">{formatDate(order.date_commande || order.date_creation)}</span></div>
          <div className="detail-row"><span className="detail-label">Date prévue</span><span className="detail-value">{formatDate(order.date_previsionnelle)}</span></div>
          <div className="detail-row"><span className="detail-label">Date réelle</span><span className="detail-value">{formatDate(order.date_livraison_reelle)}</span></div>
          <div className="detail-row"><span className="detail-label">Approbation</span>
            <span className={`badge ${order.statut_approbation === 'X' ? 'badge-success' : order.statut_approbation === 'R' ? 'badge-danger' : 'badge-neutral'}`}>
              {order.statut_approbation === 'X' ? 'Approuvée' : order.statut_approbation === 'R' ? 'Rejetée' : 'En attente'}
            </span>
          </div>
          <div className="detail-row"><span className="detail-label">Postes en retard</span><span className="detail-value" style={{ color: (order.postes_en_retard ?? 0) > 0 ? 'var(--status-danger)' : 'var(--status-success)' }}>{order.postes_en_retard || 0}</span></div>
          <div className="detail-row"><span className="detail-label">Score priorité</span><span className="detail-value">{order.score_priorite || 0}/100</span></div>
        </div>

        <div className="card">
          <div className="card-header"><h3 className="card-title"><User size={16} style={{ marginRight: 6 }} />Fournisseur</h3></div>
          {order.fournisseur ? (<>
            <div className="detail-row"><span className="detail-label">Nom</span><span className="detail-value">{order.fournisseur.nom}</span></div>
            <div className="detail-row"><span className="detail-label">Code SAP</span><span className="detail-value">{order.fournisseur.code_sap}</span></div>
            <div className="detail-row"><span className="detail-label">Pays</span><span className="detail-value">{order.fournisseur.pays}</span></div>
            <div className="detail-row"><span className="detail-label">Performance</span><span className="detail-value">{((order.fournisseur.score_performance || 0) * 100).toFixed(0)}%</span></div>
            <div className="detail-row"><span className="detail-label">Taux retard</span><span className="detail-value" style={{ color: (order.fournisseur.taux_retard_moyen ?? 0) > 0.2 ? 'var(--status-danger)' : 'var(--text-primary)' }}>{((order.fournisseur.taux_retard_moyen || 0) * 100).toFixed(0)}%</span></div>
          </>) : <div className="empty-state">Aucun fournisseur</div>}

          {pred && (
            <div style={{ marginTop: '20px', padding: '16px', background: 'var(--bg-input)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <Brain size={16} color="var(--accent-purple)" />
                <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Prédiction ML</span>
                <span className="badge badge-purple" style={{ marginLeft: 'auto' }}>{pred.modele_version || 'v0'}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Risque</span>
                <div className="risk-indicator">
                  <div className={`risk-dot ${pred.risque_label === 'ELEVE' ? 'high' : pred.risque_label === 'MOYEN' ? 'medium' : 'low'}`} />
                  <span className="detail-value">{pred.risque_label} ({(pred.risque_score * 100).toFixed(0)}%)</span>
                </div>
              </div>
              <div className="detail-row"><span className="detail-label">Score composite</span><span className="detail-value">{pred.score_composite}/100</span></div>
              <div className="detail-row"><span className="detail-label">Action</span><span className="detail-value">{pred.priorite_action}</span></div>
              {pred.suggestion && <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '8px' }}>{pred.suggestion}</p>}
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 'var(--space-md)' }}>
        <div className="card-header"><h3 className="card-title"><Truck size={16} style={{ marginRight: 6 }} />Lignes de commande ({order.lignes?.length || 0})</h3></div>
        {(order.lignes?.length ?? 0) > 0 ? (
          <table className="data-table">
            <thead><tr><th>Poste</th><th>Produit</th><th>Désignation</th><th>Qté cmd</th><th>Qté livrée</th><th>Prix unit.</th><th>Plant</th></tr></thead>
            <tbody>
              {order.lignes!.map(l => (
                <tr key={l.ID}>
                  <td>{l.numero_poste}</td><td style={{ fontWeight: 600 }}>{l.code_produit}</td>
                  <td>{l.designation_produit || '—'}</td><td>{l.quantite_commandee}</td>
                  <td style={{ color: (l.quantite_livree ?? 0) < l.quantite_commandee ? 'var(--status-warning)' : 'var(--status-success)' }}>{l.quantite_livree || 0}</td>
                  <td>{(l.prix_unitaire || 0).toLocaleString('fr-FR')} {l.unite}</td><td>{l.plant || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="empty-state">Aucune ligne</div>}
      </div>

      {(order.historique?.length ?? 0) > 0 && (
        <div className="card" style={{ marginTop: 'var(--space-md)' }}>
          <div className="card-header"><h3 className="card-title"><Clock size={16} style={{ marginRight: 6 }} />Historique des statuts</h3></div>
          <div className="timeline">
            {order.historique!.map(h => (
              <div className="timeline-item" key={h.ID}>
                <div className="timeline-dot" />
                <div className="timeline-date">{formatDate(h.date_changement)} — {h.utilisateur || 'Système'}</div>
                <div className="timeline-content">
                  <span className="badge badge-neutral" style={{ marginRight: 4 }}>{STATUS_LABELS[h.ancien_statut]}</span>
                  → <span className="badge badge-info" style={{ marginLeft: 4 }}>{STATUS_LABELS[h.nouveau_statut]}</span>
                  {h.commentaire && <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>{h.commentaire}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}
          onClick={() => setShowModal(false)}>
          <div className="card" style={{ width: 420, maxWidth: '90vw' }} onClick={e => e.stopPropagation()}>
            <h3 className="card-title" style={{ marginBottom: 16 }}>Changer le statut</h3>
            <div className="form-group">
              <label className="form-label">Nouveau statut</label>
              <select className="form-select" value={newStatus} onChange={e => setNewStatus(e.target.value)}>
                <option value="">— Sélectionner —</option>
                {allowed.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Commentaire (min. 5 caractères)</label>
              <textarea className="form-input" rows={3} value={comment} onChange={e => setComment(e.target.value)} placeholder="Raison du changement..." />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Annuler</button>
              <button className="btn btn-primary" disabled={!newStatus || comment.length < 5 || saving} onClick={handleChangeStatus}>
                {saving ? 'En cours...' : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
