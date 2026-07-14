import { useState, useEffect } from 'react';
import { Palette, Globe, Bell, Layout } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { getProfile, updatePreferences, DEFAULT_PREFERENCES } from '../services/profileService';
import type { UserProfile, UserPreferences } from '../types';

export default function PreferencesPage() {
  const { getAuthHeaders, hasRole } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getProfile(getAuthHeaders());
      setProfile(data);
      setPreferences(data.preferences || DEFAULT_PREFERENCES);
    } catch (err: any) {
      setError(err.message || 'Erreur chargement préférences');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(false);

      await updatePreferences(preferences, getAuthHeaders());
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);

      // Appliquer le thème immédiatement
      if (preferences.theme) {
        applyTheme(preferences.theme);
      }
    } catch (err: any) {
      setError(err.message || 'Erreur mise à jour préférences');
    } finally {
      setSaving(false);
    }
  };

  const applyTheme = (theme: 'light' | 'dark' | 'system') => {
    const root = document.documentElement;
    if (theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
      root.setAttribute('data-theme', theme);
    }
  };

  const updatePref = (path: string, value: any) => {
    setPreferences((prev) => {
      const keys = path.split('.');
      const newPrefs = { ...prev };
      let current: any = newPrefs;

      for (let i = 0; i < keys.length - 1; i++) {
        if (!current[keys[i]]) current[keys[i]] = {};
        current[keys[i]] = { ...current[keys[i]] };
        current = current[keys[i]];
      }

      current[keys[keys.length - 1]] = value;
      return newPrefs;
    });
  };

  const toggleNotificationType = (type: string) => {
    const types = preferences.notifications?.types || [];
    const newTypes = types.includes(type as any)
      ? types.filter((t) => t !== type)
      : [...types, type as any];
    updatePref('notifications.types', newTypes);
  };

  if (loading) return <div className="flex items-center justify-center min-h-[300px] w-full"><div className="animate-spin rounded-full h-10 w-10 border-4 border-slate-200 border-t-blue-600 dark:border-slate-800 dark:border-t-cyan-400" /></div>;

  const btnActive = 'px-4 py-2 text-xs font-bold bg-gradient-to-r from-blue-600 to-sky-500 dark:from-cyan-500 dark:to-blue-600 text-white rounded-lg shadow-sm hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer';
  const btnInactive = 'px-4 py-2 text-xs font-bold border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-950 transition-all duration-200 cursor-pointer';

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100 tracking-tight">Préférences</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Personnalisez votre expérience SmartOrder</p>
        </div>
        <button 
          className="px-4.5 py-2 rounded-lg text-xs font-bold bg-gradient-to-r from-blue-600 to-sky-500 dark:from-cyan-500 dark:to-blue-600 text-white shadow-sm hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer" 
          onClick={handleSave} 
          disabled={saving}
        >
          {saving ? 'Enregistrement...' : 'Enregistrer'}
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-xl text-sm font-medium border bg-red-500/10 text-red-600 border-red-500/20 dark:text-red-400">
          {error}
        </div>
      )}

      {success && (
        <div className="p-4 rounded-xl text-sm font-medium border bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400">
          Préférences mises à jour avec succès
        </div>
      )}

      {/* Apparence */}
      <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl p-6 shadow-sm backdrop-blur-md">
        <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800/80 pb-4 mb-5">
          <h3 className="text-base font-extrabold text-slate-800 dark:text-slate-200 tracking-tight flex items-center gap-2">
            <Palette size={18} className="text-blue-500 dark:text-cyan-400" />
            Apparence
          </h3>
        </div>

        <div className="grid grid-cols-1 gap-6">
          {/* Thème */}
          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-450 dark:text-slate-500 uppercase tracking-wider">Thème</label>
            <div className="flex flex-wrap gap-2">
              {['light', 'dark', 'system'].map((theme) => (
                <button
                  key={theme}
                  className={preferences.theme === theme ? btnActive : btnInactive}
                  onClick={() => updatePref('theme', theme)}
                >
                  {theme === 'light' ? '☀️ Clair' : theme === 'dark' ? '🌙 Sombre' : '💻 Système'}
                </button>
              ))}
            </div>
          </div>

          {/* Densité */}
          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-450 dark:text-slate-500 uppercase tracking-wider">Densité d&apos;affichage</label>
            <div className="flex flex-wrap gap-2">
              {['comfortable', 'compact'].map((density) => (
                <button
                  key={density}
                  className={preferences.density === density ? btnActive : btnInactive}
                  onClick={() => updatePref('density', density)}
                >
                  {density === 'comfortable' ? 'Confortable' : 'Compact'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Langue et région */}
      <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl p-6 shadow-sm backdrop-blur-md">
        <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800/80 pb-4 mb-5">
          <h3 className="text-base font-extrabold text-slate-800 dark:text-slate-200 tracking-tight flex items-center gap-2">
            <Globe size={18} className="text-blue-500 dark:text-cyan-400" />
            Langue et région
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Langue */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Langue de l&apos;interface</label>
            <select
              className="w-full h-10 px-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-blue-600 dark:focus:border-cyan-400 transition-all cursor-pointer"
              value={preferences.language}
              onChange={(e) => updatePref('language', e.target.value)}
            >
              <option value="FR">Français</option>
              <option value="EN">English</option>
              <option value="AR">العربية</option>
            </select>
          </div>

          {/* Timezone */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Fuseau horaire</label>
            <select
              className="w-full h-10 px-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-blue-600 dark:focus:border-cyan-400 transition-all cursor-pointer"
              value={preferences.timezone}
              onChange={(e) => updatePref('timezone', e.target.value)}
            >
              <option value="Europe/Paris">Europe/Paris (UTC+1)</option>
              <option value="Europe/London">Europe/London (UTC+0)</option>
              <option value="Africa/Casablanca">Africa/Casablanca (UTC+1)</option>
              <option value="America/New_York">America/New_York (UTC-5)</option>
            </select>
          </div>

          {/* Format de date */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Format de date</label>
            <select
              className="w-full h-10 px-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-blue-600 dark:focus:border-cyan-400 transition-all cursor-pointer"
              value={preferences.dateFormat}
              onChange={(e) => updatePref('dateFormat', e.target.value)}
            >
              <option value="DD/MM/YYYY">DD/MM/YYYY (12/05/2026)</option>
              <option value="MM/DD/YYYY">MM/DD/YYYY (05/12/2026)</option>
              <option value="YYYY-MM-DD">YYYY-MM-DD (2026-05-12)</option>
            </select>
          </div>

          {/* Format d'heure */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Format d&apos;heure</label>
            <select
              className="w-full h-10 px-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-blue-600 dark:focus:border-cyan-400 transition-all cursor-pointer"
              value={preferences.timeFormat}
              onChange={(e) => updatePref('timeFormat', e.target.value)}
            >
              <option value="24h">24h (14:30)</option>
              <option value="12h">12h (2:30 PM)</option>
            </select>
          </div>

          {/* Devise */}
          <div className="space-y-1.5 md:col-span-2">
            <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Devise d&apos;affichage</label>
            <select
              className="w-full h-10 px-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-blue-600 dark:focus:border-cyan-400 transition-all cursor-pointer"
              value={preferences.currency}
              onChange={(e) => updatePref('currency', e.target.value)}
            >
              <option value="EUR">EUR (€)</option>
              <option value="USD">USD ($)</option>
              <option value="MAD">MAD (DH)</option>
              <option value="GBP">GBP (£)</option>
            </select>
            <small className="block text-[10px] text-slate-400 dark:text-slate-500 font-medium">
              ℹ️ La devise réelle dépend de chaque commande SAP
            </small>
          </div>
        </div>
      </div>

      {/* Notifications */}
      <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl p-6 shadow-sm backdrop-blur-md">
        <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800/80 pb-4 mb-5">
          <h3 className="text-base font-extrabold text-slate-800 dark:text-slate-200 tracking-tight flex items-center gap-2">
            <Bell size={18} className="text-blue-500 dark:text-cyan-400" />
            Notifications
          </h3>
        </div>

        <div className="grid grid-cols-1 gap-6">
          {/* Canaux */}
          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-450 dark:text-slate-500 uppercase tracking-wider">Canaux de notification</label>
            <div className="flex flex-col gap-3 mt-1">
              <label className="flex items-center gap-3 cursor-pointer select-none text-sm text-slate-700 dark:text-slate-300 font-semibold group">
                <input
                  type="checkbox"
                  className="h-4.5 w-4.5 rounded border-slate-350 dark:border-slate-700 text-blue-600 focus:ring-blue-500 dark:bg-slate-900 dark:focus:ring-cyan-500 cursor-pointer"
                  checked={preferences.notifications?.email || false}
                  onChange={(e) => updatePref('notifications.email', e.target.checked)}
                />
                <span className="group-hover:text-slate-900 dark:group-hover:text-white transition-colors">Notifications email</span>
              </label>
              {hasRole('MANAGER') && (
                <label className="flex items-center gap-3 cursor-pointer select-none text-sm text-slate-700 dark:text-slate-300 font-semibold group">
                  <input
                    type="checkbox"
                    className="h-4.5 w-4.5 rounded border-slate-350 dark:border-slate-700 text-blue-600 focus:ring-blue-500 dark:bg-slate-900 dark:focus:ring-cyan-500 cursor-pointer"
                    checked={preferences.notifications?.push || false}
                    onChange={(e) => updatePref('notifications.push', e.target.checked)}
                  />
                  <span className="group-hover:text-slate-900 dark:group-hover:text-white transition-colors">Notifications push (navigateur)</span>
                </label>
              )}
            </div>
          </div>

          {/* Types d'alertes */}
          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-450 dark:text-slate-500 uppercase tracking-wider">Types d&apos;alertes à recevoir</label>
            <div className="flex flex-col gap-3 mt-1 w-full">
              {hasRole('MANAGER') && (
                <label className="flex items-center gap-3 cursor-pointer select-none text-sm text-slate-700 dark:text-slate-300 font-semibold group">
                  <input
                    type="checkbox"
                    className="h-4.5 w-4.5 rounded border-slate-350 dark:border-slate-700 text-blue-600 focus:ring-blue-500 dark:bg-slate-900 dark:focus:ring-cyan-500 cursor-pointer"
                    checked={preferences.notifications?.types?.includes('BLOQUE') || false}
                    onChange={() => toggleNotificationType('BLOQUE')}
                  />
                  <span className="group-hover:text-slate-900 dark:group-hover:text-white transition-colors">Commandes bloquées</span>
                  <span className="ml-auto px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider bg-red-500/10 text-red-500 border border-red-500/20">Critique</span>
                </label>
              )}
              <label className="flex items-center gap-3 cursor-pointer select-none text-sm text-slate-700 dark:text-slate-300 font-semibold group">
                <input
                  type="checkbox"
                  className="h-4.5 w-4.5 rounded border-slate-350 dark:border-slate-700 text-blue-600 focus:ring-blue-500 dark:bg-slate-900 dark:focus:ring-cyan-500 cursor-pointer"
                  checked={preferences.notifications?.types?.includes('RETARD') || false}
                  onChange={() => toggleNotificationType('RETARD')}
                />
                <span className="group-hover:text-slate-900 dark:group-hover:text-white transition-colors">Retards de livraison</span>
                <span className="ml-auto px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-500 border border-amber-500/20">Élevé</span>
              </label>
              {hasRole('MANAGER') && (
                <>
                  <label className="flex items-center gap-3 cursor-pointer select-none text-sm text-slate-700 dark:text-slate-300 font-semibold group">
                    <input
                      type="checkbox"
                      className="h-4.5 w-4.5 rounded border-slate-350 dark:border-slate-700 text-blue-600 focus:ring-blue-500 dark:bg-slate-900 dark:focus:ring-cyan-500 cursor-pointer"
                      checked={preferences.notifications?.types?.includes('ANOMALIE_VOLUME') || false}
                      onChange={() => toggleNotificationType('ANOMALIE_VOLUME')}
                    />
                    <span className="group-hover:text-slate-900 dark:group-hover:text-white transition-colors">Anomalies de volume</span>
                    <span className="ml-auto px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider bg-blue-500/10 text-blue-500 border border-blue-500/20">Moyen</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer select-none text-sm text-slate-700 dark:text-slate-300 font-semibold group">
                    <input
                      type="checkbox"
                      className="h-4.5 w-4.5 rounded border-slate-350 dark:border-slate-700 text-blue-600 focus:ring-blue-500 dark:bg-slate-900 dark:focus:ring-cyan-500 cursor-pointer"
                      checked={preferences.notifications?.types?.includes('FOURNISSEUR_RISQUE') || false}
                      onChange={() => toggleNotificationType('FOURNISSEUR_RISQUE')}
                    />
                    <span className="group-hover:text-slate-900 dark:group-hover:text-white transition-colors">Fournisseurs à risque</span>
                    <span className="ml-auto px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-500 border border-amber-500/20">Élevé</span>
                  </label>
                </>
              )}
            </div>
          </div>

          {/* Auto-refresh */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Rafraîchissement automatique</label>
            <select
              className="w-full h-10 px-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-blue-600 dark:focus:border-cyan-400 transition-all cursor-pointer"
              value={preferences.autoRefresh}
              onChange={(e) => updatePref('autoRefresh', Number(e.target.value))}
            >
              <option value={30}>30 secondes</option>
              <option value={60}>1 minute</option>
              <option value={300}>5 minutes</option>
              <option value={0}>Manuel</option>
            </select>
          </div>
        </div>
      </div>

      {/* Affichage des données */}
      <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl p-6 shadow-sm backdrop-blur-md">
        <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800/80 pb-4 mb-5">
          <h3 className="text-base font-extrabold text-slate-800 dark:text-slate-200 tracking-tight flex items-center gap-2">
            <Layout size={18} className="text-blue-500 dark:text-cyan-400" />
            Affichage des données
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Pagination */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Pagination par défaut</label>
            <select
              className="w-full h-10 px-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-blue-600 dark:focus:border-cyan-400 transition-all cursor-pointer"
              value={preferences.display?.pagination}
              onChange={(e) => updatePref('display.pagination', Number(e.target.value))}
            >
              <option value={20}>20 items</option>
              <option value={50}>50 items</option>
              <option value={100}>100 items</option>
            </select>
          </div>

          {/* Tri par défaut */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Tri par défaut</label>
            <select
              className="w-full h-10 px-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-blue-600 dark:focus:border-cyan-400 transition-all cursor-pointer"
              value={preferences.display?.sortBy}
              onChange={(e) => updatePref('display.sortBy', e.target.value)}
            >
              <option value="date_creation">Date de création</option>
              <option value="score_priorite">Score de priorité</option>
              <option value="montant_total">Montant total</option>
              <option value="date_previsionnelle">Date prévisionnelle</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
