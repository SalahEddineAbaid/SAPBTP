import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, CheckCircle, Package, Plus, Trash2,
  Building2, ShoppingCart, AlertCircle, Loader2, CloudUpload, Sparkles
} from 'lucide-react';
import { createOrder, getFournisseurs } from '../services/orderService';
import type { Fournisseur, CreateOrderPayload, LigneCommandeInput } from '../types';

// ============================================================
// Constantes
// ============================================================

const URGENCE_OPTIONS = [
  { value: 'NORMALE',  label: 'Normale',   color: 'text-slate-500 dark:text-slate-400',  dot: 'bg-slate-400' },
  { value: 'HAUTE',    label: 'Haute',     color: 'text-amber-600 dark:text-amber-400',  dot: 'bg-amber-500' },
  { value: 'CRITIQUE', label: 'Critique',  color: 'text-red-600 dark:text-red-400',      dot: 'bg-red-500'   },
];

const TYPE_OPTIONS = [
  { value: 'NB', label: 'NB — Commande standard' },
  { value: 'UB', label: 'UB — Transfert de stock' },
  { value: 'KB', label: 'KB — Consignation' },
  { value: 'LP', label: 'LP — Sous-traitance' },
  { value: 'FO', label: 'FO — Commande cadre' },
];

const DEVISE_OPTIONS = ['EUR', 'MAD', 'USD', 'GBP', 'CHF', 'JPY'];

const EMPTY_LIGNE: LigneCommandeInput = {
  code_produit: '',
  designation_produit: '',
  quantite_commandee: 1,
  prix_unitaire: 0,
  unite: 'PC',
  plant: '',
};

// ============================================================
// Composants utilitaires
// ============================================================

function StepIndicator({ step, current }: { step: number; current: number }) {
  const done    = current > step;
  const active  = current === step;
  return (
    <div className={`flex items-center justify-center w-8 h-8 rounded-full border-2 text-xs font-bold transition-all duration-300 ${
      done   ? 'bg-emerald-500 border-emerald-500 text-white shadow-[0_0_10px_rgba(16,185,129,0.5)]'
             : active ? 'bg-blue-600 dark:bg-cyan-500 border-blue-600 dark:border-cyan-500 text-white shadow-[0_0_10px_rgba(59,130,246,0.5)] dark:shadow-[0_0_10px_rgba(0,229,255,0.4)]'
             : 'border-slate-300 dark:border-slate-700 text-slate-400 dark:text-slate-600 bg-white dark:bg-slate-900'
    }`}>
      {done ? <CheckCircle size={14} /> : step}
    </div>
  );
}

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
      {children} {required && <span className="text-red-500">*</span>}
    </label>
  );
}

function inputCls(error?: boolean) {
  return `w-full h-10 px-3 rounded-lg text-sm text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-900/60 outline-none transition-all duration-200 border ${
    error
      ? 'border-red-400 dark:border-red-600 focus:ring-1 focus:ring-red-400/30'
      : 'border-slate-200 dark:border-slate-800 focus:border-blue-500 dark:focus:border-cyan-500 focus:ring-1 focus:ring-blue-500/20 dark:focus:ring-cyan-500/20'
  } placeholder-slate-400 dark:placeholder-slate-600`;
}

// ============================================================
// Page principale
// ============================================================

export default function CreateOrderPage() {
  const navigate = useNavigate();
  const [step, setStep]             = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [success, setSuccess]       = useState<{ numero_sap: string; orderId: string } | null>(null);
  const [fournisseurs, setFournisseurs] = useState<Fournisseur[]>([]);
  const [loadingFrs, setLoadingFrs] = useState(true);
  const [errors, setErrors]         = useState<Record<string, string>>({});

  // ── Étape 1 : Informations générales ──
  const [type,           setType]            = useState('NB');
  const [fournisseurId,  setFournisseurId]   = useState('');
  const [companyCode,    setCompanyCode]     = useState('');
  const [purchasingOrg,  setPurchasingOrg]  = useState('');
  const [purchasingGroup, setPurchasingGroup] = useState('');
  const [devise,         setDevise]          = useState('EUR');
  const [urgence,        setUrgence]         = useState<'NORMALE' | 'HAUTE' | 'CRITIQUE'>('NORMALE');
  const [datePrev,       setDatePrev]        = useState('');
  const [dateCommande,   setDateCommande]    = useState(new Date().toISOString().split('T')[0]);

  // ── Étape 2 : Lignes de commande ──
  const [lignes, setLignes] = useState<LigneCommandeInput[]>([{ ...EMPTY_LIGNE }]);

  // Charger les fournisseurs
  useEffect(() => {
    getFournisseurs({ top: 200 })
      .then(r => setFournisseurs(r.items))
      .catch(() => setFournisseurs([]))
      .finally(() => setLoadingFrs(false));
  }, []);

  // ── Calculs ──
  const montantTotal = lignes.reduce((sum, l) =>
    sum + (l.prix_unitaire || 0) * (l.quantite_commandee || 0), 0
  );

  const selectedFrs = fournisseurs.find(f => f.ID === fournisseurId);

  // ── Validation Étape 1 ──
  function validateStep1(): boolean {
    const errs: Record<string, string> = {};
    if (!fournisseurId)   errs.fournisseurId  = 'Veuillez sélectionner un fournisseur.';
    if (!companyCode)     errs.companyCode    = 'Le code société est obligatoire (CompanyCode SAP).';
    if (!purchasingOrg)   errs.purchasingOrg  = 'L\'organisation d\'achat est obligatoire (PurchasingOrganization SAP).';
    if (!purchasingGroup) errs.purchasingGroup = 'Le groupe d\'achat est obligatoire (PurchasingGroup SAP).';
    if (!devise)          errs.devise         = 'La devise est obligatoire (Currency SAP).';
    if (!datePrev)        errs.datePrev       = 'La date prévisionnelle de livraison est obligatoire.';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ── Validation Étape 2 ──
  function validateStep2(): boolean {
    const errs: Record<string, string> = {};
    lignes.forEach((l, i) => {
      if (!l.code_produit.trim())              errs[`ligne_${i}_produit`] = 'Code produit (Material) requis pour la création SAP.';
      if (!l.quantite_commandee || l.quantite_commandee <= 0) errs[`ligne_${i}_qte`] = 'La quantité doit être supérieure à 0.';
      if (l.prix_unitaire <= 0)                errs[`ligne_${i}_prix`]   = 'Le prix unitaire doit être > 0 (requis par SAP pour le type NB).';
      if (!l.plant || !l.plant.trim())         errs[`ligne_${i}_plant`]  = 'Le site (Plant) est recommandé pour une PO valide dans SAP.';
    });
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleNext() {
    if (step === 1 && validateStep1()) setStep(2);
    else if (step === 2 && validateStep2()) setStep(3);
  }

  function handleBack() { setStep(s => Math.max(1, s - 1)); }

  // ── Lignes helpers ──
  function addLigne()       { setLignes(l => [...l, { ...EMPTY_LIGNE }]); }
  function removeLigne(i: number) { setLignes(l => l.filter((_, idx) => idx !== i)); }
  function updateLigne(i: number, field: keyof LigneCommandeInput, val: string | number) {
    setLignes(l => l.map((ligne, idx) => idx === i ? { ...ligne, [field]: val } : ligne));
  }

  // ── Soumission ──
  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError('');
    try {
      const payload: CreateOrderPayload = {
        type,
        fournisseur_ID: fournisseurId,
        company_code: companyCode,
        purchasing_org: purchasingOrg,
        purchasing_group: purchasingGroup || undefined,
        devise,
        urgence,
        date_previsionnelle: datePrev,
        date_commande: dateCommande,
        lignes: lignes.filter(l => l.code_produit.trim()),
      };

      const result = await createOrder(payload);
      setSuccess({
        numero_sap: result.sap?.numero_sap_provisoire || result.order?.numero_sap || '—',
        orderId: result.order?.ID || '',
      });
      setStep(4);
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Erreur lors de la création.');
    } finally {
      setSubmitting(false);
    }
  }

  // ============================================================
  // Render
  // ============================================================

  return (
    <div className="animate-fade-in max-w-3xl mx-auto space-y-6">

      {/* ── En-tête ── */}
      <div className="flex items-center gap-3">
        <button
          className="w-10 h-10 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 flex items-center justify-center hover:bg-slate-50 dark:hover:bg-slate-950 transition-all cursor-pointer shadow-sm"
          onClick={() => navigate('/orders')}
          id="btn-back-to-list"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100 tracking-tight">
            Nouvelle commande
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Créée dans SmartOrder et synchronisée automatiquement avec SAP S/4HANA
          </p>
        </div>
      </div>

      {/* ── Progress Steps ── */}
      {step < 4 && (
        <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl p-5 shadow-sm backdrop-blur-md">
          <div className="flex items-center gap-0">
            {[
              { n: 1, label: 'Informations' },
              { n: 2, label: 'Lignes' },
              { n: 3, label: 'Récapitulatif' },
            ].map(({ n, label }, idx, arr) => (
              <div key={n} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center gap-1">
                  <StepIndicator step={n} current={step} />
                  <span className={`text-[10px] font-bold uppercase tracking-wider ${
                    step === n ? 'text-blue-600 dark:text-cyan-400' : 'text-slate-400 dark:text-slate-600'
                  }`}>{label}</span>
                </div>
                {idx < arr.length - 1 && (
                  <div className={`flex-1 h-0.5 mx-2 mb-4 rounded transition-all duration-500 ${
                    step > n ? 'bg-emerald-400' : 'bg-slate-200 dark:bg-slate-800'
                  }`} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
          ÉTAPE 1 — Informations générales
      ═══════════════════════════════════════════════════════ */}
      {step === 1 && (
        <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl p-6 shadow-sm backdrop-blur-md space-y-5 animate-slide-up">
          <div className="flex items-center gap-2 pb-4 border-b border-slate-100 dark:border-slate-800/80">
            <Building2 size={18} className="text-blue-500 dark:text-cyan-400" />
            <h2 className="text-base font-extrabold text-slate-800 dark:text-slate-200">Informations générales</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

            {/* Fournisseur */}
            <div className="sm:col-span-2">
              <FieldLabel required>Fournisseur</FieldLabel>
              {loadingFrs ? (
                <div className="flex items-center gap-2 h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 text-slate-400 text-sm">
                  <Loader2 size={14} className="animate-spin" /> Chargement…
                </div>
              ) : (
                <select
                  id="select-fournisseur"
                  className={inputCls(!!errors.fournisseurId)}
                  value={fournisseurId}
                  onChange={e => { setFournisseurId(e.target.value); setErrors(er => ({ ...er, fournisseurId: '' })); }}
                >
                  <option value="">— Sélectionner un fournisseur —</option>
                  {fournisseurs.map(f => (
                    <option key={f.ID} value={f.ID}>{f.nom} ({f.code_sap})</option>
                  ))}
                </select>
              )}
              {errors.fournisseurId && <p className="mt-1 text-xs text-red-500">{errors.fournisseurId}</p>}
              {selectedFrs && (
                <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400 font-semibold">
                  ✓ {selectedFrs.nom} · Pays: {selectedFrs.pays || '—'} · Performance: {((selectedFrs.score_performance || 0) * 100).toFixed(0)}%
                </p>
              )}
            </div>

            {/* Type de commande */}
            <div>
              <FieldLabel required>Type de commande SAP</FieldLabel>
              <select id="select-type" className={inputCls()} value={type} onChange={e => setType(e.target.value)}>
                {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* Urgence */}
            <div>
              <FieldLabel>Urgence</FieldLabel>
              <div className="flex gap-2 mt-1">
                {URGENCE_OPTIONS.map(o => (
                  <button
                    key={o.value}
                    type="button"
                    id={`btn-urgence-${o.value.toLowerCase()}`}
                    className={`flex-1 flex items-center justify-center gap-1.5 h-10 rounded-lg border text-xs font-bold transition-all cursor-pointer ${
                      urgence === o.value
                        ? 'border-blue-500 dark:border-cyan-500 bg-blue-50 dark:bg-cyan-950/30 text-blue-700 dark:text-cyan-300 shadow-sm'
                        : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                    }`}
                    onClick={() => setUrgence(o.value as 'NORMALE' | 'HAUTE' | 'CRITIQUE')}
                  >
                    <div className={`w-2 h-2 rounded-full ${o.dot}`} />
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Code société */}
            <div>
              <FieldLabel required>Code société (CompanyCode)</FieldLabel>
              <input
                id="input-company-code"
                type="text"
                className={inputCls(!!errors.companyCode)}
                placeholder="ex: 1000"
                maxLength={4}
                value={companyCode}
                onChange={e => { setCompanyCode(e.target.value.toUpperCase()); setErrors(er => ({ ...er, companyCode: '' })); }}
              />
              {errors.companyCode && <p className="mt-1 text-xs text-red-500">{errors.companyCode}</p>}
            </div>

            {/* Organisation d'achat */}
            <div>
              <FieldLabel required>Organisation d'achat</FieldLabel>
              <input
                id="input-purchasing-org"
                type="text"
                className={inputCls(!!errors.purchasingOrg)}
                placeholder="ex: 1000"
                maxLength={4}
                value={purchasingOrg}
                onChange={e => { setPurchasingOrg(e.target.value.toUpperCase()); setErrors(er => ({ ...er, purchasingOrg: '' })); }}
              />
              {errors.purchasingOrg && <p className="mt-1 text-xs text-red-500">{errors.purchasingOrg}</p>}
            </div>

            {/* Groupe d'achat */}
            <div>
              <FieldLabel required>Groupe d'achat (PurchasingGroup) SAP</FieldLabel>
              <input
                id="input-purchasing-group"
                type="text"
                className={inputCls(!!errors.purchasingGroup)}
                placeholder="ex: 001"
                maxLength={3}
                value={purchasingGroup}
                onChange={e => { setPurchasingGroup(e.target.value.toUpperCase()); setErrors(er => ({ ...er, purchasingGroup: '' })); }}
              />
              {errors.purchasingGroup && <p className="mt-1 text-xs text-red-500">{errors.purchasingGroup}</p>}
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-600">Obligatoire dans SAP S/4HANA (champ *)</p>
            </div>

            {/* Devise */}
            <div>
              <FieldLabel required>Devise (Currency) SAP</FieldLabel>
              <select
                id="select-devise"
                className={inputCls(!!errors.devise)}
                value={devise}
                onChange={e => { setDevise(e.target.value); setErrors(er => ({ ...er, devise: '' })); }}
              >
                {DEVISE_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              {errors.devise && <p className="mt-1 text-xs text-red-500">{errors.devise}</p>}
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-600">Obligatoire dans SAP S/4HANA (champ *)</p>
            </div>

            {/* Date prévisionnelle */}
            <div>
              <FieldLabel required>Date prévisionnelle de livraison</FieldLabel>
              <input
                id="input-date-prev"
                type="date"
                className={inputCls(!!errors.datePrev)}
                min={new Date().toISOString().split('T')[0]}
                value={datePrev}
                onChange={e => { setDatePrev(e.target.value); setErrors(er => ({ ...er, datePrev: '' })); }}
              />
              {errors.datePrev && <p className="mt-1 text-xs text-red-500">{errors.datePrev}</p>}
            </div>

            {/* Date commande */}
            <div>
              <FieldLabel>Date de commande</FieldLabel>
              <input
                id="input-date-commande"
                type="date"
                className={inputCls()}
                value={dateCommande}
                onChange={e => setDateCommande(e.target.value)}
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              id="btn-step1-next"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-gradient-to-r from-blue-600 to-sky-500 dark:from-cyan-500 dark:to-blue-600 text-white shadow-md hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer"
              onClick={handleNext}
            >
              Lignes de commande <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
          ÉTAPE 2 — Lignes de commande
      ═══════════════════════════════════════════════════════ */}
      {step === 2 && (
        <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl p-6 shadow-sm backdrop-blur-md space-y-5 animate-slide-up">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800/80">
            <div className="flex items-center gap-2">
              <ShoppingCart size={18} className="text-blue-500 dark:text-cyan-400" />
              <h2 className="text-base font-extrabold text-slate-800 dark:text-slate-200">Lignes de commande</h2>
              <span className="ml-1 px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                {lignes.length} poste{lignes.length > 1 ? 's' : ''}
              </span>
            </div>
            <button
              id="btn-add-ligne"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 transition-all cursor-pointer"
              onClick={addLigne}
            >
              <Plus size={14} /> Ajouter un poste
            </button>
          </div>

          <div className="space-y-4">
            {lignes.map((ligne, i) => (
              <div key={i} className="relative p-4 rounded-xl border border-slate-200 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/20 animate-slide-up">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Poste {(i + 1) * 10}
                  </span>
                  {lignes.length > 1 && (
                    <button
                      id={`btn-remove-ligne-${i}`}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-red-400 hover:bg-red-500/10 hover:text-red-500 transition-all cursor-pointer"
                      onClick={() => removeLigne(i)}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-1">
                    <FieldLabel required>Code produit (Material)</FieldLabel>
                    <input
                      id={`input-ligne-${i}-produit`}
                      type="text"
                      className={inputCls(!!errors[`ligne_${i}_produit`])}
                      placeholder="ex: MAT-A001"
                      maxLength={40}
                      value={ligne.code_produit}
                      onChange={e => { updateLigne(i, 'code_produit', e.target.value.toUpperCase()); setErrors(er => ({ ...er, [`ligne_${i}_produit`]: '' })); }}
                    />
                    {errors[`ligne_${i}_produit`] && <p className="mt-1 text-xs text-red-500">{errors[`ligne_${i}_produit`]}</p>}
                  </div>

                  <div className="sm:col-span-2">
                    <FieldLabel>Désignation</FieldLabel>
                    <input
                      id={`input-ligne-${i}-designation`}
                      type="text"
                      className={inputCls()}
                      placeholder="Description du produit…"
                      maxLength={40}
                      value={ligne.designation_produit || ''}
                      onChange={e => updateLigne(i, 'designation_produit', e.target.value)}
                    />
                  </div>

                  <div>
                    <FieldLabel required>Quantité</FieldLabel>
                    <input
                      id={`input-ligne-${i}-qte`}
                      type="number"
                      className={inputCls(!!errors[`ligne_${i}_qte`])}
                      min="0.001"
                      step="0.001"
                      value={ligne.quantite_commandee}
                      onChange={e => { updateLigne(i, 'quantite_commandee', parseFloat(e.target.value) || 0); setErrors(er => ({ ...er, [`ligne_${i}_qte`]: '' })); }}
                    />
                    {errors[`ligne_${i}_qte`] && <p className="mt-1 text-xs text-red-500">{errors[`ligne_${i}_qte`]}</p>}
                  </div>

                  <div>
                    <FieldLabel required>Prix unitaire (Net Order Price)</FieldLabel>
                    <input
                      id={`input-ligne-${i}-prix`}
                      type="number"
                      className={inputCls(!!errors[`ligne_${i}_prix`])}
                      min="0.01"
                      step="0.01"
                      value={ligne.prix_unitaire}
                      onChange={e => updateLigne(i, 'prix_unitaire', parseFloat(e.target.value) || 0)}
                    />
                    {errors[`ligne_${i}_prix`] && <p className="mt-1 text-xs text-red-500">{errors[`ligne_${i}_prix`]}</p>}
                  </div>

                  <div>
                    <FieldLabel required>Unité / Plant SAP</FieldLabel>
                    <div className="flex gap-2">
                      <input
                        id={`input-ligne-${i}-unite`}
                        type="text"
                        className={`${inputCls()} w-16`}
                        placeholder="PC"
                        maxLength={6}
                        value={ligne.unite || 'PC'}
                        onChange={e => updateLigne(i, 'unite', e.target.value.toUpperCase())}
                      />
                      <input
                        id={`input-ligne-${i}-plant`}
                        type="text"
                        className={`${inputCls(!!errors[`ligne_${i}_plant`])} flex-1`}
                        placeholder="Plant SAP *"
                        maxLength={4}
                        value={ligne.plant || ''}
                        onChange={e => { updateLigne(i, 'plant', e.target.value.toUpperCase()); setErrors(er => ({ ...er, [`ligne_${i}_plant`]: '' })); }}
                      />
                    </div>
                    {errors[`ligne_${i}_plant`] && <p className="mt-1 text-xs text-amber-500">{errors[`ligne_${i}_plant`]}</p>}
                  </div>
                </div>

                {/* Sous-total ligne */}
                <div className="mt-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400">
                  Sous-total: <span className="text-slate-800 dark:text-slate-200 tabular-nums">
                    {((ligne.prix_unitaire || 0) * (ligne.quantite_commandee || 0)).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {devise}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Montant total */}
          <div className="flex justify-between items-center px-4 py-3 rounded-xl bg-blue-500/5 dark:bg-blue-950/20 border border-blue-500/20">
            <span className="text-sm font-bold text-slate-600 dark:text-slate-400">Montant total estimé</span>
            <span className="text-lg font-extrabold tabular-nums text-blue-700 dark:text-cyan-300">
              {montantTotal.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {devise}
            </span>
          </div>

          <div className="flex justify-between pt-2">
            <button
              id="btn-step2-back"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-950 cursor-pointer transition-all"
              onClick={handleBack}
            >
              <ArrowLeft size={16} /> Retour
            </button>
            <button
              id="btn-step2-next"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-gradient-to-r from-blue-600 to-sky-500 dark:from-cyan-500 dark:to-blue-600 text-white shadow-md hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer"
              onClick={handleNext}
            >
              Récapitulatif <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
          ÉTAPE 3 — Récapitulatif
      ═══════════════════════════════════════════════════════ */}
      {step === 3 && (
        <div className="space-y-4 animate-slide-up">
          {/* Résumé commande */}
          <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl p-6 shadow-sm backdrop-blur-md">
            <div className="flex items-center gap-2 pb-4 border-b border-slate-100 dark:border-slate-800/80 mb-4">
              <Package size={18} className="text-blue-500 dark:text-cyan-400" />
              <h2 className="text-base font-extrabold text-slate-800 dark:text-slate-200">Récapitulatif</h2>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Fournisseur',    value: selectedFrs?.nom || '—' },
                { label: 'Code SAP',       value: selectedFrs?.code_sap || '—' },
                { label: 'Type',           value: type },
                { label: 'Urgence',        value: urgence },
                { label: 'Code société',   value: companyCode },
                { label: 'Org. d\'achat',  value: purchasingOrg },
                { label: 'Devise',         value: devise },
                { label: 'Date prévue',    value: datePrev ? new Date(datePrev).toLocaleDateString('fr-FR') : '—' },
              ].map(({ label, value }) => (
                <div key={label} className="flex flex-col gap-0.5">
                  <span className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider">{label}</span>
                  <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Lignes */}
          <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl p-6 shadow-sm backdrop-blur-md overflow-hidden">
            <h3 className="text-sm font-extrabold text-slate-700 dark:text-slate-300 mb-3">
              Lignes de commande ({lignes.filter(l => l.code_produit).length})
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider">
                    <th className="pb-2 pr-4">Poste</th>
                    <th className="pb-2 pr-4">Produit</th>
                    <th className="pb-2 pr-4">Désignation</th>
                    <th className="pb-2 pr-4 text-right">Qté</th>
                    <th className="pb-2 text-right">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {lignes.filter(l => l.code_produit).map((l, i) => (
                    <tr key={i} className="border-t border-slate-100 dark:border-slate-800/50">
                      <td className="py-2 pr-4 text-slate-500 dark:text-slate-400 tabular-nums">{(i + 1) * 10}</td>
                      <td className="py-2 pr-4 font-bold text-slate-800 dark:text-slate-200">{l.code_produit}</td>
                      <td className="py-2 pr-4 text-slate-600 dark:text-slate-400">{l.designation_produit || '—'}</td>
                      <td className="py-2 pr-4 tabular-nums text-right text-slate-700 dark:text-slate-300">{l.quantite_commandee} {l.unite || 'PC'}</td>
                      <td className="py-2 tabular-nums text-right font-bold text-slate-800 dark:text-slate-100">
                        {((l.prix_unitaire || 0) * (l.quantite_commandee || 0)).toLocaleString('fr-FR', { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 dark:border-slate-700">
                    <td colSpan={4} className="pt-3 text-sm font-bold text-slate-600 dark:text-slate-400">Total</td>
                    <td className="pt-3 text-right text-base font-extrabold text-blue-700 dark:text-cyan-300 tabular-nums">
                      {montantTotal.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {devise}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Indicateur SAP */}
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-emerald-500/5 dark:bg-emerald-950/20 border border-emerald-500/20">
            <CloudUpload size={18} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
            <div>
              <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">Synchronisation automatique avec SAP S/4HANA</p>
              <p className="text-xs text-emerald-600/70 dark:text-emerald-400/70">
                La commande sera créée dans SAP immédiatement après la soumission.
                Un numéro SAP provisoire sera attribué puis remplacé par le numéro SAP confirmé.
              </p>
            </div>
          </div>

          {/* Erreur */}
          {submitError && (
            <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400">
              <AlertCircle size={18} className="shrink-0 mt-0.5" />
              <p className="text-sm font-medium">{submitError}</p>
            </div>
          )}

          <div className="flex justify-between">
            <button
              id="btn-step3-back"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-950 cursor-pointer transition-all"
              onClick={handleBack}
            >
              <ArrowLeft size={16} /> Retour
            </button>
            <button
              id="btn-submit-order"
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold bg-gradient-to-r from-emerald-600 to-teal-500 dark:from-emerald-500 dark:to-teal-600 text-white shadow-md hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed transition-all cursor-pointer"
              disabled={submitting}
              onClick={handleSubmit}
            >
              {submitting
                ? <><Loader2 size={16} className="animate-spin" /> Création en cours…</>
                : <><CloudUpload size={16} /> Créer &amp; Synchroniser SAP</>
              }
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
          ÉTAPE 4 — Succès
      ═══════════════════════════════════════════════════════ */}
      {step === 4 && success && (
        <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl p-10 shadow-sm backdrop-blur-md text-center space-y-6 animate-slide-up">
          <div className="relative inline-flex">
            <div className="w-20 h-20 rounded-full bg-emerald-500/10 dark:bg-emerald-950/30 flex items-center justify-center mx-auto">
              <CheckCircle size={40} className="text-emerald-500 dark:text-emerald-400" />
            </div>
            <Sparkles size={16} className="absolute -top-1 -right-1 text-amber-400 animate-bounce" />
          </div>

          <div>
            <h2 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100 tracking-tight mb-1">
              Commande créée avec succès !
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Synchronisation SAP S/4HANA en cours en arrière-plan
            </p>
          </div>

          <div className="inline-flex flex-col items-center gap-1 px-6 py-4 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800">
            <span className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider">Numéro provisoire SAP</span>
            <span className="text-xl font-extrabold font-mono text-blue-600 dark:text-cyan-400 tracking-widest">
              {success.numero_sap}
            </span>
            <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
              ⏳ Le numéro SAP définitif sera assigné dans quelques secondes
            </span>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              id="btn-view-order"
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-gradient-to-r from-blue-600 to-sky-500 dark:from-cyan-500 dark:to-blue-600 text-white shadow-md hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer"
              onClick={() => navigate(success.orderId ? `/orders/${success.orderId}` : '/orders')}
            >
              <Package size={16} /> Voir la commande
            </button>
            <button
              id="btn-create-another"
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-950 cursor-pointer transition-all"
              onClick={() => { setStep(1); setSuccess(null); setSubmitError(''); setFournisseurId(''); setCompanyCode(''); setPurchasingOrg(''); setPurchasingGroup(''); setDatePrev(''); setLignes([{ ...EMPTY_LIGNE }]); }}
            >
              <Plus size={16} /> Nouvelle commande
            </button>
            <button
              id="btn-back-list"
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-50 cursor-pointer transition-all"
              onClick={() => navigate('/orders')}
            >
              <ArrowLeft size={16} /> Liste des commandes
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
