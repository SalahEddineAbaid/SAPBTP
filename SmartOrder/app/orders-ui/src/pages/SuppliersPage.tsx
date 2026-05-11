import { useState, useEffect } from 'react';
import { Truck } from 'lucide-react';
import { getFournisseurs } from '../services/orderService';
import type { Fournisseur } from '../types';

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Fournisseur[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getFournisseurs({ top: 100 })
      .then(({ items }) => setSuppliers(items))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading-spinner"><div className="spinner" /></div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Fournisseurs</h1>
          <p className="page-description">{suppliers.length} fournisseur(s)</p>
        </div>
      </div>

      {suppliers.length === 0 ? (
        <div className="card">
          <div className="empty-state"><Truck size={48} /><p>Aucun fournisseur. Les fournisseurs sont créés automatiquement lors de la sync SAP.</p></div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="data-table">
            <thead><tr><th>Code SAP</th><th>Nom</th><th>Pays</th><th>Performance</th><th>Taux retard</th><th>Commandes</th></tr></thead>
            <tbody>
              {suppliers.map(s => (
                <tr key={s.ID}>
                  <td style={{ fontWeight: 600 }}>{s.code_sap}</td>
                  <td>{s.nom}</td>
                  <td>{s.pays || '—'}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ flex: 1, height: 6, background: 'var(--bg-input)', borderRadius: 3, overflow: 'hidden', maxWidth: 80 }}>
                        <div style={{ width: `${(s.score_performance || 0) * 100}%`, height: '100%', borderRadius: 3,
                          background: (s.score_performance ?? 0) >= 0.8 ? 'var(--status-success)' : (s.score_performance ?? 0) >= 0.5 ? 'var(--status-warning)' : 'var(--status-danger)' }} />
                      </div>
                      <span style={{ fontSize: '0.8rem' }}>{((s.score_performance || 0) * 100).toFixed(0)}%</span>
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${(s.taux_retard_moyen ?? 0) > 0.25 ? 'badge-danger' : (s.taux_retard_moyen ?? 0) > 0.1 ? 'badge-warning' : 'badge-success'}`}>
                      {((s.taux_retard_moyen || 0) * 100).toFixed(0)}%
                    </span>
                  </td>
                  <td>{s.nombre_commandes || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
