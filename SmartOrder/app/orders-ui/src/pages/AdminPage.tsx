import { useState, useEffect } from 'react';
import { Settings, RefreshCw, Play, Clock, CheckCircle, XCircle } from 'lucide-react';
import { triggerSync, getSyncJobs, getUsers } from '../services/adminService';
import type { SyncJob, Utilisateur } from '../types';

export default function AdminPage() {
  const [syncJobs, setSyncJobs] = useState<SyncJob[]>([]);
  const [users, setUsers] = useState<Utilisateur[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ success: boolean; message?: string; creees?: number; mises_a_jour?: number } | null>(null);

  useEffect(() => {
    Promise.all([
      getSyncJobs().catch(() => ({ items: [] as SyncJob[], count: 0 })),
      getUsers().catch(() => ({ items: [] as Utilisateur[], count: 0 })),
    ]).then(([jobs, u]) => { setSyncJobs(jobs.items); setUsers(u.items); }).finally(() => setLoading(false));
  }, []);

  const handleSync = async (mode: 'FULL' | 'DELTA') => {
    setSyncing(true); setSyncResult(null);
    try {
      const result = await triggerSync(mode);
      setSyncResult({ success: true, ...result });
      const jobs = await getSyncJobs();
      setSyncJobs(jobs.items);
    } catch (err: unknown) {
      setSyncResult({ success: false, message: err instanceof Error ? err.message : 'Erreur' });
    } finally { setSyncing(false); }
  };

  const formatDate = (d?: string) => d ? new Date(d).toLocaleString('fr-FR') : '—';

  if (loading) return <div className="loading-spinner"><div className="spinner" /></div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Administration</h1>
          <p className="page-description">Synchronisation SAP, utilisateurs et modèles ML</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 'var(--space-md)' }}>
        <div className="card-header"><h3 className="card-title"><RefreshCw size={16} style={{ marginRight: 6 }} />Synchronisation SAP S/4HANA</h3></div>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <button className="btn btn-primary" disabled={syncing} onClick={() => handleSync('FULL')}>
            <Play size={14} /> {syncing ? 'En cours...' : 'Sync FULL'}
          </button>
          <button className="btn btn-secondary" disabled={syncing} onClick={() => handleSync('DELTA')}>
            <RefreshCw size={14} /> Sync DELTA
          </button>
        </div>

        {syncResult && (
          <div style={{ padding: '12px', borderRadius: 'var(--radius-md)', marginBottom: '16px',
            background: syncResult.success ? 'var(--status-success-soft)' : 'var(--status-danger-soft)',
            color: syncResult.success ? 'var(--status-success)' : 'var(--status-danger)', fontSize: '0.85rem' }}>
            {syncResult.success
              ? `✅ Sync terminée — ${syncResult.creees || 0} créées, ${syncResult.mises_a_jour || 0} mises à jour`
              : `❌ Erreur: ${syncResult.message}`}
          </div>
        )}

        {syncJobs.length > 0 && (
          <table className="data-table">
            <thead><tr><th>Date</th><th>Mode</th><th>Statut</th><th>Résultat</th><th>Durée</th></tr></thead>
            <tbody>
              {syncJobs.slice(0, 10).map(j => (
                <tr key={j.ID}>
                  <td>{formatDate(j.started_at)}</td>
                  <td><span className="badge badge-info">{j.mode}</span></td>
                  <td>
                    {j.statut === 'SUCCES' ? <span className="badge badge-success"><CheckCircle size={12} /> Succès</span>
                      : j.statut === 'ERREUR' ? <span className="badge badge-danger"><XCircle size={12} /> Erreur</span>
                      : <span className="badge badge-warning"><Clock size={12} /> {j.statut}</span>}
                  </td>
                  <td style={{ fontSize: '0.8rem' }}>{j.commandes_creees || 0} créées, {j.commandes_maj || 0} maj, {j.erreurs || 0} erreurs</td>
                  <td style={{ fontSize: '0.8rem' }}>{j.duree_ms ? `${(j.duree_ms / 1000).toFixed(1)}s` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="card-header"><h3 className="card-title"><Settings size={16} style={{ marginRight: 6 }} />Utilisateurs ({users.length})</h3></div>
        {users.length > 0 ? (
          <table className="data-table">
            <thead><tr><th>Username</th><th>Email</th><th>Rôle</th><th>Actif</th></tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.ID}>
                  <td style={{ fontWeight: 600 }}>{u.username}</td>
                  <td>{u.email || '—'}</td>
                  <td><span className={`badge ${u.role === 'ADMIN' ? 'badge-danger' : u.role === 'MANAGER' ? 'badge-warning' : 'badge-info'}`}>{u.role}</span></td>
                  <td>{u.actif !== false ? <span className="badge badge-success">Actif</span> : <span className="badge badge-neutral">Inactif</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="empty-state">Aucun utilisateur</div>}
      </div>
    </div>
  );
}
