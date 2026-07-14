import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  User, Mail, Phone, Building2, Shield, Clock, Calendar, 
  Check, Edit3, Key, Lock, Bell, Activity, Award, Settings, 
  Globe, MapPin, Eye, CheckCircle2, ChevronRight, AlertCircle, 
  RefreshCw, LogOut, ArrowUpRight, ShieldCheck, CheckCircle
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { getProfile, updateProfile, updatePreferences } from '../services/profileService';
import type { UserProfile, UserPreferences } from '../types';

// Import sub-components
import ProfileHero from '../components/Profile/ProfileHero';
import ProfileScore from '../components/Profile/ProfileScore';
import SecurityCenter from '../components/Profile/SecurityCenter';
import SkillsCard from '../components/Profile/SkillsCard';
import ActivityTimeline from '../components/Profile/ActivityTimeline';
import NotificationSettings from '../components/Profile/NotificationSettings';
import QuickActions from '../components/Profile/QuickActions';

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
  const [success, setSuccess] = useState<string | null>(null);

  // Custom modals state
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    oldPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);

  // Local storage keys for mock profile details not stored on BTP schema
  const localAddrKey = `smartorder_profile_addr_${user?.username || 'default'}`;
  const localCityKey = `smartorder_profile_city_${user?.username || 'default'}`;

  // Form state
  const [formData, setFormData] = useState({
    prenom: '',
    nom: '',
    telephone: '',
    departement: '',
    address: localStorage.getItem(localAddrKey) || '12 Avenue Hassan II, Bureau 4B',
    city: localStorage.getItem(localCityKey) || 'Casablanca, Maroc',
  });

  // Security and preference states
  const [mfaEnabled, setMfaEnabled] = useState(() => {
    return localStorage.getItem(`smartorder_mfa_${user?.username || 'default'}`) === 'true';
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
        address: localStorage.getItem(localAddrKey) || '12 Avenue Hassan II, Bureau 4B',
        city: localStorage.getItem(localCityKey) || 'Casablanca, Maroc',
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
      setSuccess(null);

      // Save standard fields to backend
      const updatedProfile = await updateProfile({
        prenom: formData.prenom,
        nom: formData.nom,
        telephone: formData.telephone,
        departement: formData.departement,
      }, getAuthHeaders());

      // Save custom fields locally
      localStorage.setItem(localAddrKey, formData.address);
      localStorage.setItem(localCityKey, formData.city);

      setProfile(updatedProfile);
      setEditing(false);
      setSuccess('Profil mis à jour avec succès');
      setTimeout(() => setSuccess(null), 3000);
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
        address: localStorage.getItem(localAddrKey) || '12 Avenue Hassan II, Bureau 4B',
        city: localStorage.getItem(localCityKey) || 'Casablanca, Maroc',
      });
    }
  };

  const handleTogglePreference = async (prefKey: 'email' | 'push') => {
    if (!profile) return;
    try {
      setError(null);
      const currentPrefs = profile.preferences || {};
      const newPrefs: UserPreferences = {
        ...currentPrefs,
        notifications: {
          ...currentPrefs.notifications,
          [prefKey]: !currentPrefs.notifications?.[prefKey],
        }
      };
      
      const updatedProfile = await updatePreferences(newPrefs, getAuthHeaders());
      setProfile(updatedProfile);
      setSuccess('Préférences de notification mises à jour');
      setTimeout(() => setSuccess(null), 2500);
    } catch (err: any) {
      setError(err.message || 'Erreur mise à jour préférences');
    }
  };

  const handleToggleMfa = () => {
    const nextState = !mfaEnabled;
    setMfaEnabled(nextState);
    localStorage.setItem(`smartorder_mfa_${user?.username || 'default'}`, String(nextState));
    setSuccess(nextState ? 'Double authentification activée' : 'Double authentification désactivée');
    setTimeout(() => setSuccess(null), 2500);
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(false);

    if (!passwordForm.oldPassword) {
      setPasswordError('Veuillez saisir votre mot de passe actuel.');
      return;
    }
    if (passwordForm.newPassword.length < 8) {
      setPasswordError('Le nouveau mot de passe doit contenir au moins 8 caractères.');
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError('Les mots de passe ne correspondent pas.');
      return;
    }

    try {
      setPasswordLoading(true);
      // Mock API password update
      await new Promise(resolve => setTimeout(resolve, 1500));
      setPasswordSuccess(true);
      setPasswordForm({ oldPassword: '', newPassword: '', confirmPassword: '' });
      setTimeout(() => {
        setShowPasswordModal(false);
        setPasswordSuccess(false);
      }, 2000);
    } catch (err) {
      setPasswordError('Erreur lors de la modification du mot de passe.');
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleExportProfile = () => {
    if (!profile) return;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(profile, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `profile_${profile.username}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const getJobTitle = () => {
    if (profile?.role === 'ADMIN') return 'Administrateur Principal';
    if (profile?.role === 'MANAGER') return 'Directeur Approvisionnements';
    return 'Acheteur Technique';
  };

  const getSecurityScore = () => {
    let score = 70;
    if (profile?.role === 'ADMIN') score += 12;
    if (profile?.role === 'MANAGER') score += 8;
    if (mfaEnabled) score += 15;
    return Math.min(score, 98);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[500px] w-full space-y-4">
        <div className="relative w-16 h-16">
          <div className="absolute inset-0 rounded-full border-4 border-slate-100 dark:border-slate-800" />
          <div className="absolute inset-0 rounded-full border-4 border-t-blue-600 dark:border-t-cyan-400 animate-spin" />
        </div>
        <p className="text-sm font-semibold text-slate-500 dark:text-slate-400 animate-pulse">Chargement de votre profil sécurisé...</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl p-8 shadow-sm backdrop-blur-md">
        <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500 text-sm font-semibold">
          <User size={48} className="opacity-30 mb-4 animate-bounce" />
          <p>Profil de l'agent introuvable ou session expirée.</p>
        </div>
      </div>
    );
  }

  const securityScore = getSecurityScore();

  return (
    <div className="animate-fade-in space-y-8 max-w-7xl mx-auto pb-16 px-4 sm:px-6">
      
      {/* Messages */}
      <AnimatePresence>
        {error && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="p-4 rounded-2xl text-sm font-semibold border bg-red-500/10 text-red-600 border-red-500/20 dark:text-red-400 flex items-center gap-2"
          >
            <AlertCircle size={16} />
            {error}
          </motion.div>
        )}

        {success && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="p-4 rounded-2xl text-sm font-semibold border bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400 flex items-center gap-2 shadow-sm"
          >
            <CheckCircle2 size={16} className="text-emerald-500" />
            {success}
          </motion.div>
        )}
      </AnimatePresence>

      {/* SECTION 1 : HERO BANNER */}
      <ProfileHero 
        profile={profile}
        editing={editing}
        isProduction={isProduction}
        onEditClick={() => setEditing(true)}
        onChangePasswordClick={() => setShowPasswordModal(true)}
        onExportClick={handleExportProfile}
      />

      {/* Main Grid: Columns layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        
        {/* Main Panel Column (Span 2) */}
        <div className="lg:col-span-2 space-y-8">
          
          {/* SECTION 5 : INFORMATIONS PERSONNELLES */}
          <motion.div 
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-[24px] p-6 shadow-xl backdrop-blur-md"
          >
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800/80 pb-4 mb-6">
              <h3 className="text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-widest flex items-center gap-2">
                <User size={16} className="text-blue-500" />
                Informations personnelles
              </h3>
              {!editing && (
                <button
                  onClick={() => setEditing(true)}
                  className="p-2 text-slate-400 hover:text-blue-600 dark:hover:text-cyan-400 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors"
                >
                  <Edit3 size={15} />
                </button>
              )}
            </div>

            {editing ? (
              // Form Editing Mode Inputs
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 animate-fade-in">
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Prénom</label>
                  <input
                    type="text"
                    className="w-full h-10 px-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-sm font-semibold outline-none focus:border-blue-600 dark:focus:border-cyan-400 transition-all text-slate-800 dark:text-slate-100"
                    value={formData.prenom}
                    onChange={(e) => setFormData({ ...formData, prenom: e.target.value })}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Nom</label>
                  <input
                    type="text"
                    className="w-full h-10 px-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-sm font-semibold outline-none focus:border-blue-600 dark:focus:border-cyan-400 transition-all text-slate-800 dark:text-slate-100"
                    value={formData.nom}
                    onChange={(e) => setFormData({ ...formData, nom: e.target.value })}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Téléphone</label>
                  <input
                    type="tel"
                    className="w-full h-10 px-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-sm font-semibold outline-none focus:border-blue-600 dark:focus:border-cyan-400 transition-all text-slate-800 dark:text-slate-100"
                    value={formData.telephone}
                    onChange={(e) => setFormData({ ...formData, telephone: e.target.value })}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Département</label>
                  <select
                    className="w-full h-10 px-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-sm font-semibold outline-none focus:border-blue-600 dark:focus:border-cyan-400 transition-all cursor-pointer text-slate-800 dark:text-slate-100"
                    value={formData.departement}
                    onChange={(e) => setFormData({ ...formData, departement: e.target.value })}
                  >
                    <option value="">Sélectionner un département</option>
                    {DEPARTEMENTS.map((dept) => (
                      <option key={dept} value={dept}>{dept}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Adresse bureau</label>
                  <input
                    type="text"
                    className="w-full h-10 px-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-sm font-semibold outline-none focus:border-blue-600 dark:focus:border-cyan-400 transition-all text-slate-800 dark:text-slate-100"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Ville & Pays</label>
                  <input
                    type="text"
                    className="w-full h-10 px-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-sm font-semibold outline-none focus:border-blue-600 dark:focus:border-cyan-400 transition-all text-slate-800 dark:text-slate-100"
                    value={formData.city}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                  />
                </div>
              </div>
            ) : (
              // Premium Enterprise Style Information Cards
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Item 1: Prénom */}
                <div className="p-4 bg-slate-50/50 dark:bg-slate-950/20 border border-slate-200/50 dark:border-slate-800/50 rounded-2xl flex items-center justify-between group">
                  <div className="flex items-center space-x-3.5">
                    <div className="p-2.5 bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800 text-slate-400 rounded-xl">
                      <User size={15} />
                    </div>
                    <div>
                      <p className="text-[9px] font-black text-slate-450 dark:text-slate-550 uppercase tracking-wider">Prénom</p>
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-100 mt-0.5">{profile.prenom || '—'}</p>
                    </div>
                  </div>
                </div>

                {/* Item 2: Nom */}
                <div className="p-4 bg-slate-50/50 dark:bg-slate-950/20 border border-slate-200/50 dark:border-slate-800/50 rounded-2xl flex items-center justify-between group">
                  <div className="flex items-center space-x-3.5">
                    <div className="p-2.5 bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800 text-slate-400 rounded-xl">
                      <User size={15} />
                    </div>
                    <div>
                      <p className="text-[9px] font-black text-slate-450 dark:text-slate-550 uppercase tracking-wider">Nom de famille</p>
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-100 mt-0.5">{profile.nom || '—'}</p>
                    </div>
                  </div>
                </div>

                {/* Item 3: Email */}
                <div className="p-4 bg-slate-50/50 dark:bg-slate-950/20 border border-slate-200/50 dark:border-slate-800/50 rounded-2xl flex items-center justify-between group">
                  <div className="flex items-center space-x-3.5">
                    <div className="p-2.5 bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800 text-slate-400 rounded-xl">
                      <Mail size={15} />
                    </div>
                    <div>
                      <p className="text-[9px] font-black text-slate-450 dark:text-slate-550 uppercase tracking-wider">Email Pro</p>
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-100 mt-0.5">{profile.email}</p>
                    </div>
                  </div>
                  <Lock size={12} className="opacity-30" />
                </div>

                {/* Item 4: Phone */}
                <div className="p-4 bg-slate-50/50 dark:bg-slate-950/20 border border-slate-200/50 dark:border-slate-800/50 rounded-2xl flex items-center justify-between group">
                  <div className="flex items-center space-x-3.5">
                    <div className="p-2.5 bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800 text-slate-400 rounded-xl">
                      <Phone size={15} />
                    </div>
                    <div>
                      <p className="text-[9px] font-black text-slate-450 dark:text-slate-550 uppercase tracking-wider">Téléphone direct</p>
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-100 mt-0.5">{profile.telephone || '—'}</p>
                    </div>
                  </div>
                </div>

                {/* Item 5: Department */}
                <div className="p-4 bg-slate-50/50 dark:bg-slate-950/20 border border-slate-200/50 dark:border-slate-800/50 rounded-2xl flex items-center justify-between group">
                  <div className="flex items-center space-x-3.5">
                    <div className="p-2.5 bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800 text-slate-400 rounded-xl">
                      <Building2 size={15} />
                    </div>
                    <div>
                      <p className="text-[9px] font-black text-slate-450 dark:text-slate-550 uppercase tracking-wider">Département assigné</p>
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-100 mt-0.5">{profile.departement || '—'}</p>
                    </div>
                  </div>
                </div>

                {/* Item 6: Function */}
                <div className="p-4 bg-slate-50/50 dark:bg-slate-950/20 border border-slate-200/50 dark:border-slate-800/50 rounded-2xl flex items-center justify-between group">
                  <div className="flex items-center space-x-3.5">
                    <div className="p-2.5 bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800 text-slate-400 rounded-xl">
                      <Shield size={15} />
                    </div>
                    <div>
                      <p className="text-[9px] font-black text-slate-450 dark:text-slate-550 uppercase tracking-wider">Fonction SAP</p>
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-100 mt-0.5">{getJobTitle()}</p>
                    </div>
                  </div>
                  <Lock size={12} className="opacity-30" />
                </div>

                {/* Item 7: Address */}
                <div className="p-4 bg-slate-50/50 dark:bg-slate-950/20 border border-slate-200/50 dark:border-slate-800/50 rounded-2xl flex items-center justify-between group">
                  <div className="flex items-center space-x-3.5">
                    <div className="p-2.5 bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800 text-slate-400 rounded-xl">
                      <MapPin size={15} />
                    </div>
                    <div>
                      <p className="text-[9px] font-black text-slate-450 dark:text-slate-550 uppercase tracking-wider">Adresse administrative</p>
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-100 mt-0.5">{formData.address}</p>
                    </div>
                  </div>
                </div>

                {/* Item 8: City */}
                <div className="p-4 bg-slate-50/50 dark:bg-slate-950/20 border border-slate-200/50 dark:border-slate-800/50 rounded-2xl flex items-center justify-between group">
                  <div className="flex items-center space-x-3.5">
                    <div className="p-2.5 bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800 text-slate-400 rounded-xl">
                      <Globe size={15} />
                    </div>
                    <div>
                      <p className="text-[9px] font-black text-slate-450 dark:text-slate-550 uppercase tracking-wider">Ville & Pays</p>
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-100 mt-0.5">{formData.city}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {editing && (
              <div className="flex gap-3 mt-8 pt-5 border-t border-slate-100 dark:border-slate-800/40 justify-end">
                <button 
                  className="px-5 py-2.5 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-950 cursor-pointer transition-all duration-200" 
                  onClick={handleCancel} 
                  disabled={saving}
                >
                  Annuler
                </button>
                <button 
                  className="px-5 py-2.5 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-sm hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 transition-all cursor-pointer" 
                  onClick={handleSave} 
                  disabled={saving}
                >
                  {saving ? 'Enregistrement...' : 'Enregistrer'}
                </button>
              </div>
            )}
          </motion.div>

          {/* SECTION 3 : SECURITY CENTER */}
          <SecurityCenter 
            profile={profile}
            mfaEnabled={mfaEnabled}
            securityScore={securityScore}
            onToggleMfa={handleToggleMfa}
            onChangePasswordClick={() => setShowPasswordModal(true)}
          />

          {/* SECTION 6 : COMPÉTENCES & CERTIFICATIONS */}
          <SkillsCard />
        </div>

        {/* Right Sidebar Columns (Span 1) */}
        <div className="space-y-8">
          
          {/* SECTION 2 : PROFILE SCORE */}
          <ProfileScore 
            profile={profile}
            formData={formData}
          />

          {/* SECTION 8 : NOTIFICATIONS */}
          <NotificationSettings 
            profile={profile}
            onTogglePreference={handleTogglePreference}
          />

          {/* SECTION 7 : TIMELINE ACTIVITÉS */}
          <ActivityTimeline />

          {/* SECTION 9 : QUICK ACTIONS */}
          <QuickActions 
            profile={profile}
            onExportClick={handleExportProfile}
          />
        </div>

      </div>

      {/* PASSWORD CHANGE MODAL */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-[#0f1633] border border-slate-200 dark:border-[#1e2749] w-full max-w-md rounded-[20px] shadow-2xl p-6 relative animate-scale-in">
            <h3 className="text-lg font-black text-slate-800 dark:text-white mb-2 flex items-center gap-2">
              <Lock className="text-blue-500" size={18} />
              Modifier le mot de passe
            </h3>
            <p className="text-xs text-slate-400 mb-6">Mettez à jour vos identifiants pour sécuriser votre compte YAAS Enterprise.</p>

            {passwordError && (
              <div className="p-3 mb-4 rounded-xl text-xs font-semibold bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400">
                {passwordError}
              </div>
            )}

            {passwordSuccess && (
              <div className="p-3 mb-4 rounded-xl text-xs font-semibold bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                <CheckCircle size={14} />
                Mot de passe mis à jour avec succès.
              </div>
            )}

            <form onSubmit={handlePasswordChange} className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5">Mot de passe actuel</label>
                <input 
                  type="password" 
                  value={passwordForm.oldPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, oldPassword: e.target.value })}
                  className="w-full h-10 px-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-sm outline-none focus:border-blue-600 dark:focus:border-cyan-400 text-slate-800 dark:text-slate-100" 
                  required
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5">Nouveau mot de passe</label>
                <input 
                  type="password" 
                  value={passwordForm.newPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                  className="w-full h-10 px-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-sm outline-none focus:border-blue-600 dark:focus:border-cyan-400 text-slate-800 dark:text-slate-100" 
                  required
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5">Confirmer le nouveau mot de passe</label>
                <input 
                  type="password" 
                  value={passwordForm.confirmPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                  className="w-full h-10 px-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-sm outline-none focus:border-blue-600 dark:focus:border-cyan-400 text-slate-800 dark:text-slate-100" 
                  required
                />
              </div>

              <div className="flex gap-2.5 pt-4 justify-end">
                <button 
                  type="button"
                  onClick={() => setShowPasswordModal(false)}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-950 cursor-pointer"
                  disabled={passwordLoading}
                >
                  Annuler
                </button>
                <button 
                  type="submit"
                  className="px-4 py-2.5 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  disabled={passwordLoading || passwordSuccess}
                >
                  {passwordLoading ? 'Mise à jour...' : 'Mettre à jour'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
