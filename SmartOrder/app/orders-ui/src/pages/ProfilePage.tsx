import { useState, useEffect } from 'react';
import { User, Mail, Phone, Building2, Shield, Clock, Calendar } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { getProfile, updateProfile } from '../services/profileService';
import type { UserProfile } from '../types';

const DEPARTEMENTS = [
  'ACHATS', 'LOGISTIQUE', 'FINANCE', 
  'QUALITE', 'PRODUCTION', 'IT', 'AUTRE'
];

export default function ProfilePage() {
  const { getAuthHeaders, user, isProduction } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    prenom: '',
    nom: '',
    telephone: '',
    departement: '',
  });

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getProfile(getAuthHeaders());
      setProfile(data);
      setFormData({
        prenom: data.prenom || '',
        nom: data.nom || '',
        telephone: data.telephone || '',
        departement: data.departement || '',
      });
    } catch (err: any) {
      setError(err.message || 'Erreur chargement profil');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(false);

      const updatedProfile = await updateProfile(formData, getAuthHeaders());
      setProfile(updatedProfile);
      setEditing(false);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Erreur mise à jour profil');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditing(false);
    setError(null);
    if (profile) {
      setFormData({
        prenom: profile.prenom || '',
        nom: profile.nom || '',
        telephone: profile.telephone || '',
        departement: profile.departement || '',
      });
    }
  };

  const formatDate = (date?: string) => {
    if (!date) return '—';
    return new Date(date).toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getInitials = () => {
    if (profile?.displayName) {
      return profile.displayName.substring(0, 2).toUpperCase();
    }
    if (profile?.prenom && profile?.nom) {
      return `${profile.prenom[0]}${profile.nom[0]}`.toUpperCase();
    }
    return profile?.username?.substring(0, 2).toUpperCase() || 'U';
  };

  const getRoleBadgeClass = (role: string) => {
    switch (role) {
      case 'ADMIN': return 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20 dark:bg-red-950/10';
      case 'MANAGER': return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 dark:bg-amber-950/10';
      default: return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20 dark:bg-blue-950/10';
    }
  };

  if (loading) return <div className="flex items-center justify-center min-h-[300px] w-full"><div className="animate-spin rounded-full h-10 w-10 border-4 border-slate-200 border-t-blue-600 dark:border-slate-800 dark:border-t-cyan-400" /></div>;

  if (!profile) {
    return (
      <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl p-8 shadow-sm backdrop-blur-md">
        <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500 text-sm font-semibold">
          <User size={48} className="opacity-30 mb-4 animate-float" />
          <p>Profil introuvable</p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100 tracking-tight">Mon Profil</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Gérez vos informations personnelles</p>
        </div>
        {!editing && (
          <button 
            className="px-4.5 py-2 rounded-lg text-xs font-bold bg-gradient-to-r from-blue-600 to-sky-500 dark:from-cyan-500 dark:to-blue-600 text-white shadow-sm hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer" 
            onClick={() => setEditing(true)}
          >
            Modifier
          </button>
        )}
      </div>

      {error && (
        <div className="p-4 rounded-xl text-sm font-medium border bg-red-500/10 text-red-600 border-red-500/20 dark:text-red-400">
          {error}
        </div>
      )}

      {success && (
        <div className="p-4 rounded-xl text-sm font-medium border bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400">
          Profil mis à jour avec succès
        </div>
      )}

      {/* Avatar & Nom */}
      <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl p-6 shadow-sm backdrop-blur-md">
        <div className="flex items-center gap-6">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-600 to-sky-500 text-white flex items-center justify-center text-3xl font-extrabold shadow-md border-2 border-white dark:border-[#0a0e27]">
            {getInitials()}
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-bold text-slate-850 dark:text-white leading-tight">
              {profile.displayName
                || (profile.prenom && profile.nom
                ? `${profile.prenom} ${profile.nom}`
                : profile.username)}
            </h2>
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border mt-2 ${getRoleBadgeClass(profile.role)}`}>
              {profile.role}
            </span>
          </div>
        </div>
      </div>

      {/* Informations de contact */}
      <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl p-6 shadow-sm backdrop-blur-md">
        <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800/80 pb-4 mb-5">
          <h3 className="text-base font-extrabold text-slate-800 dark:text-slate-200 tracking-tight flex items-center gap-2">
            <Mail size={18} className="text-blue-500 dark:text-cyan-400" />
            Informations de contact
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Prénom */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Prénom</label>
            {editing ? (
              <input
                type="text"
                className="w-full h-10 px-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-blue-600 dark:focus:border-cyan-400 transition-all placeholder-slate-400"
                value={formData.prenom}
                onChange={(e) => setFormData({ ...formData, prenom: e.target.value })}
                placeholder="Jean"
              />
            ) : (
              <div className="p-3 bg-slate-50/50 dark:bg-slate-950/30 border border-slate-200/40 dark:border-slate-800/40 rounded-lg text-sm font-semibold text-slate-800 dark:text-slate-200">{profile.prenom || '—'}</div>
            )}
          </div>

          {/* Nom */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Nom</label>
            {editing ? (
              <input
                type="text"
                className="w-full h-10 px-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-blue-600 dark:focus:border-cyan-400 transition-all placeholder-slate-400"
                value={formData.nom}
                onChange={(e) => setFormData({ ...formData, nom: e.target.value })}
                placeholder="Martin"
              />
            ) : (
              <div className="p-3 bg-slate-50/50 dark:bg-slate-950/30 border border-slate-200/40 dark:border-slate-800/40 rounded-lg text-sm font-semibold text-slate-800 dark:text-slate-200">{profile.nom || '—'}</div>
            )}
          </div>

          {/* Email (read-only) */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Email</label>
            <div className="p-3 bg-slate-50/30 dark:bg-slate-950/20 border border-slate-200/30 dark:border-slate-800/30 rounded-lg text-sm font-semibold text-slate-400 dark:text-slate-500">{profile.email}</div>
            <small className="block text-[10px] text-slate-400 dark:text-slate-500 font-medium">
              Modifiable uniquement par un administrateur
            </small>
          </div>

          {/* Téléphone */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Téléphone</label>
            {editing ? (
              <input
                type="tel"
                className="w-full h-10 px-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-blue-600 dark:focus:border-cyan-400 transition-all placeholder-slate-400"
                value={formData.telephone}
                onChange={(e) => setFormData({ ...formData, telephone: e.target.value })}
                placeholder="+33 1 23 45 67 89"
              />
            ) : (
              <div className="p-3 bg-slate-50/50 dark:bg-slate-950/30 border border-slate-200/40 dark:border-slate-800/40 rounded-lg text-sm font-semibold text-slate-800 dark:text-slate-200">{profile.telephone || '—'}</div>
            )}
          </div>

          {/* Département */}
          <div className="space-y-1.5 md:col-span-2">
            <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Département</label>
            {editing ? (
              <select
                className="w-full h-10 px-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-blue-600 dark:focus:border-cyan-400 transition-all cursor-pointer"
                value={formData.departement}
                onChange={(e) => setFormData({ ...formData, departement: e.target.value })}
              >
                <option value="">Sélectionner un département</option>
                {DEPARTEMENTS.map((dept) => (
                  <option key={dept} value={dept}>
                    {dept}
                  </option>
                ))}
              </select>
            ) : (
              <div className="p-3 bg-slate-50/50 dark:bg-slate-950/30 border border-slate-200/40 dark:border-slate-800/40 rounded-lg text-sm font-semibold text-slate-800 dark:text-slate-200">{profile.departement || '—'}</div>
            )}
          </div>
        </div>

        {editing && (
          <div className="flex gap-2 mt-6 pt-4 border-t border-slate-100 dark:border-slate-800/40">
            <button 
              className="inline-flex items-center gap-2 px-4.5 py-2 rounded-lg text-xs font-bold bg-gradient-to-r from-blue-600 to-sky-500 dark:from-cyan-500 dark:to-blue-600 text-white shadow-sm hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 transition-all cursor-pointer" 
              onClick={handleSave} 
              disabled={saving}
            >
              {saving ? 'Enregistrement...' : 'Enregistrer'}
            </button>
            <button 
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-950 cursor-pointer transition-all duration-200" 
              onClick={handleCancel} 
              disabled={saving}
            >
              Annuler
            </button>
          </div>
        )}
      </div>

      {/* Sécurité */}
      <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl p-6 shadow-sm backdrop-blur-md">
        <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800/80 pb-4 mb-4">
          <h3 className="text-base font-extrabold text-slate-800 dark:text-slate-200 tracking-tight flex items-center gap-2">
            <Shield size={18} className="text-blue-500 dark:text-cyan-400" />
            Sécurité
          </h3>
        </div>

        <div className="space-y-0.5">
          <div className="flex justify-between items-center py-3 border-b border-slate-100 dark:border-slate-800/40 last:border-b-0 text-sm">
            <span className="text-slate-400 dark:text-slate-500 font-medium">Authentification</span>
            <span className="font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
              ✓ {isProduction ? 'Connecté via SAP XSUAA' : 'Mode développement'}
            </span>
          </div>

          <div className="flex justify-between items-center py-3 border-b border-slate-100 dark:border-slate-800/40 last:border-b-0 text-sm">
            <span className="text-slate-400 dark:text-slate-500 font-medium">Dernière connexion</span>
            <span className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 tabular-nums">
              <Clock size={14} className="text-slate-400" />
              {formatDate(profile.derniere_connexion)}
            </span>
          </div>

          <div className="flex justify-between items-center py-3 border-b border-slate-100 dark:border-slate-800/40 last:border-b-0 text-sm">
            <span className="text-slate-400 dark:text-slate-500 font-medium">Statut du compte</span>
            <span className={`font-semibold ${profile.actif ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
              {profile.actif ? '✓ Actif' : '✗ Inactif'}
            </span>
          </div>

          {profile.createdAt && (
            <div className="flex justify-between items-center py-3 border-b border-slate-100 dark:border-slate-800/40 last:border-b-0 text-sm">
              <span className="text-slate-400 dark:text-slate-500 font-medium">Compte créé le</span>
              <span className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 tabular-nums">
                <Calendar size={14} className="text-slate-400" />
                {formatDate(profile.createdAt)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Périmètre (MANAGER uniquement) */}
      {profile.role === 'MANAGER' && profile.perimetre && (
        <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl p-6 shadow-sm backdrop-blur-md">
          <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800/80 pb-4 mb-4">
            <h3 className="text-base font-extrabold text-slate-800 dark:text-slate-200 tracking-tight flex items-center gap-2">
              <Building2 size={18} className="text-blue-500 dark:text-cyan-400" />
              Périmètre
            </h3>
          </div>

          <div className="space-y-4">
            {profile.perimetre.company_codes && profile.perimetre.company_codes.length > 0 && (
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Company Codes</label>
                <div className="p-3 bg-slate-50/50 dark:bg-slate-950/30 border border-slate-200/40 dark:border-slate-800/40 rounded-lg text-sm font-semibold text-slate-800 dark:text-slate-200">
                  {profile.perimetre.company_codes.join(', ')}
                </div>
              </div>
            )}

            {profile.perimetre.purchasing_orgs && profile.perimetre.purchasing_orgs.length > 0 && (
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Purchasing Organizations</label>
                <div className="p-3 bg-slate-50/50 dark:bg-slate-950/30 border border-slate-200/40 dark:border-slate-800/40 rounded-lg text-sm font-semibold text-slate-800 dark:text-slate-200">
                  {profile.perimetre.purchasing_orgs.join(', ')}
                </div>
              </div>
            )}

            <small className="block text-[10px] text-slate-400 dark:text-slate-500 font-medium">
              ℹ️ Modifiable uniquement par un administrateur
            </small>
          </div>
        </div>
      )}
    </div>
  );
}
