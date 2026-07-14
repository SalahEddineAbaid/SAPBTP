import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Package, Truck, User, Brain, Clock, CheckCircle, XCircle, AlertTriangle, Edit2, Trash2, CloudUpload, AlertCircle, Loader2 } from 'lucide-react';
import { getOrder, changeStatus, updateOrder, deleteOrder } from '../services/orderService';
import { useAuth } from '../hooks/useAuth';
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
  const { hasRole } = useAuth();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [newStatus, setNewStatus] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  // ── États pour Modifier (UPDATE) ──
  const [showEditModal, setShowEditModal] = useState(false);
  const [editUrgence, setEditUrgence]         = useState<string>('');
  const [editDatePrev, setEditDatePrev]       = useState<string>('');
  const [editPurchGroup, setEditPurchGroup]   = useState<string>('');
  const [editDevise, setEditDevise]           = useState<string>('');
  const [editSaving, setEditSaving]           = useState(false);
  const [editError, setEditError]             = useState<string>('');

  // ── États pour Supprimer (DELETE) ──
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting]               = useState(false);
  const [deleteError, setDeleteError]         = useState<string>('');

  // ── Indicateur sync SAP ──
  const [sapStatus, setSapStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const [sapMsg, setSapMsg]       = useState<string>('');

  const loadOrder = () => {
    if (!id) return;
    setLoading(true);
    getOrder(id).then(data => {
      setOrder(data);
      // Pré-remplir les champs du modal edit
      setEditUrgence(data.urgence || 'NORMALE');
      setEditDatePrev(data.date_previsionnelle?.split('T')[0] || '');
      setEditDevise(data.devise || 'EUR');
    }).catch(console.error).finally(() => setLoading(false));
  };
  useEffect(loadOrder, [id]);

  // ── Changer le statut ──
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

  // ── Modifier la commande (UPDATE) ──
  const handleUpdate = async () => {
    if (!id) return;
    setEditSaving(true); setEditError('');
    setSapStatus('syncing'); setSapMsg('Synchronisation SAP en cours…');
    try {
      const payload: Record<string, string> = {};
      if (editUrgence  && editUrgence  !== order?.urgence)           payload.urgence = editUrgence;
      if (editDatePrev && editDatePrev !== order?.date_previsionnelle?.split('T')[0]) payload.date_previsionnelle = editDatePrev;
      if (editPurchGroup !== undefined)  payload.purchasing_group = editPurchGroup;
      if (editDevise   && editDevise   !== order?.devise)            payload.devise  = editDevise;

      if (Object.keys(payload).length === 0) { setShowEditModal(false); return; }

      await updateOrder(id, payload);
      setShowEditModal(false);
      setSapStatus('success'); setSapMsg('Synchronisé dans SAP S/4HANA ✅');
      setTimeout(() => setSapStatus('idle'), 4000);
      loadOrder();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur lors de la modification.';
      setEditError(msg);
      setSapStatus('error'); setSapMsg(`Erreur SAP : ${msg}`);
      setTimeout(() => setSapStatus('idle'), 5000);
    } finally { setEditSaving(false); }
  };

  // ── Supprimer la commande (DELETE) ──
  const handleDelete = async () => {
    if (!id) return;
    setDeleting(true); setDeleteError('');
    try {
      await deleteOrder(id);
      navigate('/orders');
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : 'Erreur lors de la suppression.');
      setDeleting(false);
    }
  };

  const formatDate = (d?: string) => d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

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

  if (loading) return <div className="flex items-center justify-center min-h-[300px] w-full"><div className="animate-spin rounded-full h-10 w-10 border-4 border-slate-200 border-t-blue-600 dark:border-slate-800 dark:border-t-cyan-400" /></div>;
  if (!order) return <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500 text-sm font-semibold">Commande introuvable</div>;

  const pred = order.prediction;
  const allowed = TRANSITIONS[order.statut] || [];
  const canChangeStatus = hasRole('MANAGER');

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button 
            className="w-10 h-10 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 flex items-center justify-center hover:bg-slate-50 dark:hover:bg-slate-950 hover:text-slate-800 dark:hover:text-white transition-all cursor-pointer shadow-sm" 
            onClick={() => navigate('/orders')}
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100 tracking-tight">Commande {order.numero_sap}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">Type: {order.type_commande || order.type || '—'} • Créée le {formatDate(order.date_creation)}</p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {/* Indicateur sync SAP */}
          {sapStatus !== 'idle' && (
            <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 h-8 rounded-lg text-xs font-bold border ${
              sapStatus === 'syncing' ? 'bg-blue-500/10 text-blue-600 border-blue-500/20 dark:text-cyan-400 dark:bg-cyan-950/20 dark:border-cyan-500/20' :
              sapStatus === 'success' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400 dark:bg-emerald-950/20' :
              'bg-red-500/10 text-red-600 border-red-500/20 dark:text-red-400'
            }`}>
              {sapStatus === 'syncing' && <Loader2 size={12} className="animate-spin" />}
              {sapStatus === 'success' && <CloudUpload size={12} />}
              {sapStatus === 'error'   && <AlertCircle size={12} />}
              {sapMsg}
            </div>
          )}
          <button 
            className="inline-flex items-center gap-2 px-3 py-1.5 h-8 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-950/80 cursor-pointer transition-all duration-200" 
            onClick={loadOrder}
          >
            <RefreshCw size={14} /> Actualiser
          </button>
          {/* Bouton Modifier (MANAGER/ADMIN, états non terminaux) */}
          {canChangeStatus && !['LIVRE', 'ANNULE'].includes(order.statut) && (
            <button
              id="btn-edit-order"
              className="inline-flex items-center gap-2 px-3.5 py-1.5 h-8 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-950/80 cursor-pointer transition-all duration-200"
              onClick={() => { setEditError(''); setShowEditModal(true); }}
            >
              <Edit2 size={14} /> Modifier
            </button>
          )}
          {canChangeStatus && allowed.length > 0 && (
            <button 
              className="inline-flex items-center gap-2 px-3.5 py-1.5 h-8 rounded-lg text-xs font-bold bg-gradient-to-r from-blue-600 to-sky-500 dark:from-cyan-500 dark:to-blue-600 text-white shadow-sm hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer" 
              onClick={() => setShowModal(true)}
            >
              Changer statut
            </button>
          )}
          {/* Bouton Supprimer (ADMIN uniquement, commandes ANNULE) */}
          {hasRole('ADMIN') && order.statut === 'ANNULE' && (
            <button
              id="btn-delete-order"
              className="inline-flex items-center gap-2 px-3.5 py-1.5 h-8 rounded-lg text-xs font-bold border border-red-300 dark:border-red-800/60 bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/40 cursor-pointer transition-all duration-200"
              onClick={() => { setDeleteError(''); setShowDeleteModal(true); }}
            >
              <Trash2 size={14} /> Supprimer
            </button>
          )}
          {!canChangeStatus && allowed.length > 0 && (
            <span className="inline-flex items-center gap-2 px-3 py-1.5 h-8 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/70 text-slate-500 dark:text-slate-400">
              Statut réservé Manager
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl p-5 shadow-sm backdrop-blur-md">
          <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800/80 pb-4 mb-4">
            <h3 className="text-base font-extrabold text-slate-800 dark:text-slate-200 tracking-tight flex items-center gap-1.5">
              <Package size={16} className="text-blue-500 dark:text-cyan-400" />Informations
            </h3>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider border ${badgeColor(order.statut)}`}>
              {STATUS_LABELS[order.statut]}
            </span>
          </div>
          <div className="space-y-0.5">
            <div className="flex justify-between items-center py-3 border-b border-slate-100 dark:border-slate-800/50 last:border-b-0 text-sm">
              <span className="text-slate-400 dark:text-slate-500 font-medium">N° SAP</span>
              <span className="text-slate-800 dark:text-slate-200 font-semibold tabular-nums">{order.numero_sap}</span>
            </div>
            <div className="flex justify-between items-center py-3 border-b border-slate-100 dark:border-slate-800/50 last:border-b-0 text-sm">
              <span className="text-slate-400 dark:text-slate-500 font-medium">Montant total</span>
              <span className="text-slate-800 dark:text-slate-200 font-semibold tabular-nums">{(order.montant_total || 0).toLocaleString('fr-FR')} {order.devise}</span>
            </div>
            <div className="flex justify-between items-center py-3 border-b border-slate-100 dark:border-slate-800/50 last:border-b-0 text-sm">
              <span className="text-slate-400 dark:text-slate-500 font-medium">Date commande</span>
              <span className="text-slate-800 dark:text-slate-200 font-semibold tabular-nums">{formatDate(order.date_commande || order.date_creation)}</span>
            </div>
            <div className="flex justify-between items-center py-3 border-b border-slate-100 dark:border-slate-800/50 last:border-b-0 text-sm">
              <span className="text-slate-400 dark:text-slate-500 font-medium">Date prévue</span>
              <span className="text-slate-800 dark:text-slate-200 font-semibold tabular-nums">{formatDate(order.date_previsionnelle)}</span>
            </div>
            <div className="flex justify-between items-center py-3 border-b border-slate-100 dark:border-slate-800/50 last:border-b-0 text-sm">
              <span className="text-slate-400 dark:text-slate-500 font-medium">Date réelle</span>
              <span className="text-slate-800 dark:text-slate-200 font-semibold tabular-nums">{formatDate(order.date_livraison_reelle)}</span>
            </div>
            <div className="flex justify-between items-center py-3 border-b border-slate-100 dark:border-slate-800/50 last:border-b-0 text-sm">
              <span className="text-slate-400 dark:text-slate-500 font-medium">Approbation</span>
              <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
                order.statut_approbation === 'X' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400 dark:bg-emerald-950/10' : 
                order.statut_approbation === 'R' ? 'bg-red-500/10 text-red-600 border-red-500/20 dark:text-red-400 dark:bg-red-950/10' : 
                'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800/50 dark:text-slate-300 dark:border-slate-700/50'
              }`}>
                {order.statut_approbation === 'X' ? 'Approuvée' : order.statut_approbation === 'R' ? 'Rejetée' : 'En attente'}
              </span>
            </div>
            <div className="flex justify-between items-center py-3 border-b border-slate-100 dark:border-slate-800/50 last:border-b-0 text-sm">
              <span className="text-slate-400 dark:text-slate-500 font-medium">Postes en retard</span>
              <span className={`font-semibold tabular-nums ${(order.postes_en_retard ?? 0) > 0 ? 'text-red-500 dark:text-red-400' : 'text-emerald-500 dark:text-emerald-400'}`}>{order.postes_en_retard || 0}</span>
            </div>
            <div className="flex justify-between items-center py-3 border-b border-slate-100 dark:border-slate-800/50 last:border-b-0 text-sm">
              <span className="text-slate-400 dark:text-slate-500 font-medium">Score priorité</span>
              <span className="text-slate-800 dark:text-slate-200 font-semibold tabular-nums">{order.score_priorite || 0}/100</span>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl p-5 shadow-sm backdrop-blur-md flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800/80 pb-4 mb-4">
              <h3 className="text-base font-extrabold text-slate-800 dark:text-slate-200 tracking-tight flex items-center gap-1.5">
                <User size={16} className="text-blue-500 dark:text-cyan-400" />Fournisseur
              </h3>
            </div>
            {order.fournisseur ? (
              <div className="space-y-0.5">
                <div className="flex justify-between items-center py-3 border-b border-slate-100 dark:border-slate-800/50 last:border-b-0 text-sm">
                  <span className="text-slate-400 dark:text-slate-500 font-medium">Nom</span>
                  <span className="text-slate-800 dark:text-slate-200 font-semibold">{order.fournisseur.nom}</span>
                </div>
                <div className="flex justify-between items-center py-3 border-b border-slate-100 dark:border-slate-800/50 last:border-b-0 text-sm">
                  <span className="text-slate-400 dark:text-slate-500 font-medium">Code SAP</span>
                  <span className="text-slate-800 dark:text-slate-200 font-semibold tabular-nums">{order.fournisseur.code_sap}</span>
                </div>
                <div className="flex justify-between items-center py-3 border-b border-slate-100 dark:border-slate-800/50 last:border-b-0 text-sm">
                  <span className="text-slate-400 dark:text-slate-500 font-medium">Pays</span>
                  <span className="text-slate-800 dark:text-slate-200 font-semibold">{order.fournisseur.pays}</span>
                </div>
                <div className="flex justify-between items-center py-3 border-b border-slate-100 dark:border-slate-800/50 last:border-b-0 text-sm">
                  <span className="text-slate-400 dark:text-slate-500 font-medium">Performance</span>
                  <span className="text-slate-800 dark:text-slate-200 font-semibold tabular-nums">{((order.fournisseur.score_performance || 0) * 100).toFixed(0)}%</span>
                </div>
                <div className="flex justify-between items-center py-3 border-b border-slate-100 dark:border-slate-800/50 last:border-b-0 text-sm">
                  <span className="text-slate-400 dark:text-slate-500 font-medium">Taux retard</span>
                  <span className={`font-semibold tabular-nums ${((order.fournisseur.taux_retard_moyen ?? 0) > 0.2) ? 'text-red-500 dark:text-red-400' : 'text-slate-800 dark:text-slate-200'}`}>{((order.fournisseur.taux_retard_moyen || 0) * 100).toFixed(0)}%</span>
                </div>
              </div>
            ) : <div className="text-center py-6 text-slate-400 dark:text-slate-500 text-sm font-semibold">Aucun fournisseur</div>}
          </div>

          {pred && (
            <div className="mt-6 p-4 bg-slate-50 dark:bg-slate-900/40 border border-slate-200/50 dark:border-slate-800/50 rounded-xl transition-colors">
              <div className="flex items-center gap-2 mb-4">
                <Brain size={16} className="text-purple-500 dark:text-purple-400 animate-pulse" />
                <span className="font-bold text-sm text-slate-800 dark:text-slate-200">Prédiction ML</span>
                <span className="ml-auto px-2 py-0.5 rounded text-[8px] font-bold uppercase bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">{pred.modele_version || 'v0'}</span>
              </div>
              <div className="space-y-0.5">
                <div className="flex justify-between items-center py-2.5 border-b border-slate-100 dark:border-slate-800/40 last:border-b-0 text-sm">
                  <span className="text-slate-400 dark:text-slate-500 font-medium text-xs">Risque</span>
                  <div className="flex items-center gap-1.5">
                    <div className={`w-2.5 h-2.5 rounded-full ${riskBadgeColor(pred.risque_label)}`} />
                    <span className="text-slate-800 dark:text-slate-200 font-semibold text-xs tabular-nums">{pred.risque_label} ({(pred.risque_score * 100).toFixed(0)}%)</span>
                  </div>
                </div>
                <div className="flex justify-between items-center py-2.5 border-b border-slate-100 dark:border-slate-800/40 last:border-b-0 text-sm">
                  <span className="text-slate-400 dark:text-slate-500 font-medium text-xs">Score composite</span>
                  <span className="text-slate-800 dark:text-slate-200 font-semibold text-xs tabular-nums">{pred.score_composite}/100</span>
                </div>
                <div className="flex justify-between items-center py-2.5 border-b border-slate-100 dark:border-slate-800/40 last:border-b-0 text-sm">
                  <span className="text-slate-400 dark:text-slate-500 font-medium text-xs">Action</span>
                  <span className="text-slate-800 dark:text-slate-200 font-semibold text-xs">{pred.priorite_action}</span>
                </div>
              </div>
              {pred.suggestion && <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/40 leading-relaxed">{pred.suggestion}</p>}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl p-5 shadow-sm backdrop-blur-md overflow-hidden">
        <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800/80 pb-4 mb-4">
          <h3 className="text-base font-extrabold text-slate-800 dark:text-slate-200 tracking-tight flex items-center gap-1.5">
            <Truck size={16} className="text-blue-500 dark:text-cyan-400" />Lignes de commande ({order.lignes?.length || 0})
          </h3>
        </div>
        {(order.lignes?.length ?? 0) > 0 ? (
          <div className="overflow-x-auto w-full">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-3.5 px-4 border-b border-slate-200 dark:border-[#1e2749]">Poste</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-3.5 px-4 border-b border-slate-200 dark:border-[#1e2749]">Produit</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-3.5 px-4 border-b border-slate-200 dark:border-[#1e2749]">Désignation</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-3.5 px-4 border-b border-slate-200 dark:border-[#1e2749]">Qté cmd</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-3.5 px-4 border-b border-slate-200 dark:border-[#1e2749]">Qté livrée</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-3.5 px-4 border-b border-slate-200 dark:border-[#1e2749]">Prix unit.</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-3.5 px-4 border-b border-slate-200 dark:border-[#1e2749]">Plant</th>
                </tr>
              </thead>
              <tbody>
                {order.lignes!.map(l => (
                  <tr key={l.ID} className="border-b border-slate-100 dark:border-slate-800/50 hover:bg-slate-50/30 dark:hover:bg-slate-950/10 transition-colors">
                    <td className="py-3.5 px-4 tabular-nums text-slate-600 dark:text-slate-400 text-sm">{l.numero_poste}</td>
                    <td className="py-3.5 px-4 font-bold text-slate-800 dark:text-slate-200 text-sm">{l.code_produit}</td>
                    <td className="py-3.5 px-4 text-slate-700 dark:text-slate-300 text-sm">{l.designation_produit || '—'}</td>
                    <td className="py-3.5 px-4 tabular-nums text-slate-700 dark:text-slate-300 text-sm font-semibold">{l.quantite_commandee}</td>
                    <td className={`py-3.5 px-4 tabular-nums text-sm font-semibold ${
                      (l.quantite_livree ?? 0) < l.quantite_commandee ? 'text-amber-500 dark:text-amber-400' : 'text-emerald-500 dark:text-emerald-400'
                    }`}>
                      {l.quantite_livree || 0}
                    </td>
                    <td className="py-3.5 px-4 tabular-nums text-slate-800 dark:text-slate-100 text-sm font-bold">
                      {(l.prix_unitaire || 0).toLocaleString('fr-FR')} {order.devise || ''}
                      {l.unite ? <span className="text-slate-400 dark:text-slate-500 font-semibold"> / {l.unite}</span> : null}
                    </td>
                    <td className="py-3.5 px-4 text-slate-500 dark:text-slate-400 text-sm">{l.plant || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="text-center py-6 text-slate-400 dark:text-slate-500 text-sm font-semibold">Aucune ligne</div>}
      </div>

      {(order.historique?.length ?? 0) > 0 && (
        <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl p-5 shadow-sm backdrop-blur-md">
          <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800/80 pb-4 mb-4">
            <h3 className="text-base font-extrabold text-slate-800 dark:text-slate-200 tracking-tight flex items-center gap-1.5">
              <Clock size={16} className="text-blue-500 dark:text-cyan-400" />Historique des statuts
            </h3>
          </div>
          <div className="flex flex-col gap-6 pl-4 border-l border-slate-200 dark:border-slate-800 relative mt-6 ml-2">
            {order.historique!.map(h => (
              <div className="relative pl-6" key={h.ID}>
                <div className="absolute left-[-22px] top-1.5 w-3 h-3 rounded-full bg-blue-500 dark:bg-cyan-400 border-2 border-white dark:border-[#0f1633] shadow-[0_0_8px_rgba(59,130,246,0.6)] dark:shadow-[0_0_8px_rgba(0,229,255,0.6)] animate-pulse-glow" />
                <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider mb-1">
                  {formatDate(h.date_changement)} — {h.utilisateur || 'Système'}
                </div>
                <div className="text-sm text-slate-700 dark:text-slate-300 font-medium mt-1">
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-850 dark:text-slate-300 dark:border-slate-700/50 mr-2">
                    {STATUS_LABELS[h.ancien_statut]}
                  </span>
                  <span className="text-slate-400 dark:text-slate-600">→</span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-500/10 text-blue-600 border border-blue-500/20 dark:text-blue-400 dark:bg-blue-950/10 ml-2">
                    {STATUS_LABELS[h.nouveau_statut]}
                  </span>
                  {h.commentaire && <p className="text-xs text-slate-400 dark:text-slate-500 mt-2 bg-slate-50 dark:bg-slate-900/30 p-2.5 rounded-lg border border-slate-200/40 dark:border-slate-800/40 leading-relaxed">{h.commentaire}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Modal Modifier ── */}
      {showEditModal && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[200]"
          onClick={() => setShowEditModal(false)}
        >
          <div
            className="bg-white dark:bg-[#0f1633] border border-slate-200 dark:border-[#1e2749] rounded-2xl p-6 shadow-2xl w-full max-w-md mx-4 animate-slide-up"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-lg font-extrabold text-slate-800 dark:text-slate-100 mb-5 flex items-center gap-2">
              <Edit2 className="w-5 h-5 text-blue-500 dark:text-cyan-400" /> Modifier la commande
            </h3>
            <div className="space-y-4">
              {/* Urgence */}
              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Urgence</label>
                <div className="flex gap-2">
                  {['NORMALE', 'HAUTE', 'CRITIQUE'].map(u => (
                    <button key={u}
                      className={`flex-1 h-9 rounded-lg border text-xs font-bold transition-all cursor-pointer ${
                        editUrgence === u ? 'border-blue-500 dark:border-cyan-500 bg-blue-50 dark:bg-cyan-950/30 text-blue-700 dark:text-cyan-300' : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 text-slate-600 dark:text-slate-400'
                      }`}
                      onClick={() => setEditUrgence(u)}>{u}
                    </button>
                  ))}
                </div>
              </div>
              {/* Date prévisionnelle */}
              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Date prévisionnelle</label>
                <input type="date" value={editDatePrev}
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-blue-500 dark:focus:border-cyan-500 transition-all"
                  onChange={e => setEditDatePrev(e.target.value)}
                />
              </div>
              {/* Groupe d'achat */}
              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Groupe d'achat SAP</label>
                <input type="text" maxLength={3} value={editPurchGroup}
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-blue-500 dark:focus:border-cyan-500 transition-all"
                  placeholder="ex: 001"
                  onChange={e => setEditPurchGroup(e.target.value.toUpperCase())}
                />
              </div>
            </div>
            {editError && (
              <div className="mt-3 flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs font-medium">
                <AlertCircle size={14} className="shrink-0 mt-0.5" /> {editError}
              </div>
            )}
            <div className="flex gap-2 justify-end mt-6 pt-4 border-t border-slate-100 dark:border-slate-800/80">
              <button className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 cursor-pointer transition-all" onClick={() => setShowEditModal(false)}>Annuler</button>
              <button
                id="btn-confirm-edit"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-gradient-to-r from-blue-600 to-sky-500 dark:from-cyan-500 dark:to-blue-600 text-white shadow-sm hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer"
                disabled={editSaving}
                onClick={handleUpdate}
              >
                {editSaving ? <><Loader2 size={12} className="animate-spin" /> Enregistrement…</> : <><CloudUpload size={12} /> Enregistrer &amp; Sync SAP</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Supprimer ── */}
      {showDeleteModal && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[200]"
          onClick={() => setShowDeleteModal(false)}
        >
          <div
            className="bg-white dark:bg-[#0f1633] border border-slate-200 dark:border-[#1e2749] rounded-2xl p-6 shadow-2xl w-full max-w-md mx-4 animate-slide-up"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center shrink-0">
                <Trash2 size={18} className="text-red-500" />
              </div>
              <div>
                <h3 className="text-base font-extrabold text-slate-800 dark:text-slate-100">Supprimer la commande ?</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Cette action est irréversible.</p>
              </div>
            </div>
            <div className="px-4 py-3 rounded-xl bg-red-500/5 border border-red-500/20 mb-4">
              <p className="text-sm text-slate-700 dark:text-slate-300">
                La commande <span className="font-bold text-red-600 dark:text-red-400">{order?.numero_sap}</span> sera :
              </p>
              <ul className="mt-2 text-xs text-slate-500 dark:text-slate-400 space-y-1">
                <li>• Marquée pour suppression dans SAP S/4HANA (logique)</li>
                <li>• Supprimée physiquement de SmartOrder</li>
              </ul>
            </div>
            {deleteError && (
              <div className="mb-3 flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs font-medium">
                <AlertCircle size={14} className="shrink-0 mt-0.5" /> {deleteError}
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 cursor-pointer transition-all" onClick={() => setShowDeleteModal(false)}>Annuler</button>
              <button
                id="btn-confirm-delete"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-red-600 text-white hover:bg-red-700 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer"
                disabled={deleting}
                onClick={handleDelete}
              >
                {deleting ? <><Loader2 size={12} className="animate-spin" /> Suppression…</> : <><Trash2 size={12} /> Confirmer la suppression</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Changer statut (existant) ── */}
      {showModal && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[200]"
          onClick={() => setShowModal(false)}
        >
          <div 
            className="bg-white dark:bg-[#0f1633] border border-slate-200 dark:border-[#1e2749] rounded-2xl p-6 shadow-2xl w-full max-w-md mx-4 animate-slide-up" 
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-lg font-extrabold text-slate-800 dark:text-slate-100 tracking-tight mb-4 flex items-center gap-2">
              <RefreshCw className="w-5 h-5 text-blue-500 dark:text-cyan-400 animate-spin" style={{ animationDuration: '6s' }} /> Changer le statut
            </h3>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Nouveau statut</label>
                <select 
                  className="w-full h-10 px-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-blue-600 dark:focus:border-cyan-400 transition-all cursor-pointer"
                  value={newStatus} 
                  onChange={e => setNewStatus(e.target.value)}
                >
                  <option value="">— Sélectionner —</option>
                  {allowed.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Commentaire (min. 5 caractères)</label>
                <textarea 
                  className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-blue-600 dark:focus:border-cyan-400 transition-all placeholder-slate-400"
                  rows={3} 
                  value={comment} 
                  onChange={e => setComment(e.target.value)} 
                  placeholder="Raison du changement..." 
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-6 pt-4 border-t border-slate-100 dark:border-slate-800/80">
              <button 
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-950 cursor-pointer transition-all duration-200"
                onClick={() => setShowModal(false)}
              >
                Annuler
              </button>
              <button 
                className="inline-flex items-center gap-2 px-4.5 py-2 rounded-lg text-xs font-bold bg-gradient-to-r from-blue-600 to-sky-500 dark:from-cyan-500 dark:to-blue-600 text-white shadow-sm hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer"
                disabled={!newStatus || comment.length < 5 || saving} 
                onClick={handleChangeStatus}
              >
                {saving ? 'En cours...' : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
