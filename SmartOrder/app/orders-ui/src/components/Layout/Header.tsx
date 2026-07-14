import { useAuth } from '../../hooks/useAuth';
import { Search, Bell, User, Settings, LogOut, ChevronDown, CheckCircle, AlertTriangle } from 'lucide-react';
import { useState, useRef, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchApi } from '../../services/apiClient';

interface HeaderAlert {
  ID: string;
  type: string;
  severite: string;
  message: string;
  acquitte: boolean;
  date_creation: string;
  commande?: {
    numero_sap: string;
  };
}

export default function Header() {
  const { user, logout, getAuthHeaders, hasRole } = useAuth();
  const [search, setSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [alerts, setAlerts] = useState<HeaderAlert[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const displayName = user?.displayName || user?.username || 'admin';
  const initials = displayName.substring(0, 2).toUpperCase();
  const canViewAlerts = hasRole('MANAGER');
  const activeAlerts = alerts.filter((alert) => !alert.acquitte);
  const criticalAlerts = activeAlerts.filter((alert) => alert.severite === 'CRITIQUE' || alert.severite === 'ELEVE');

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    if (search.trim()) {
      navigate(`/orders?search=${encodeURIComponent(search.trim())}`);
      setSearch('');
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
      if (notificationsRef.current && !notificationsRef.current.contains(event.target as Node)) {
        setNotificationsOpen(false);
      }
    };

    if (menuOpen || notificationsOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [menuOpen, notificationsOpen]);

  const fetchAlerts = async () => {
    if (!canViewAlerts) return;
    setAlertsLoading(true);
    try {
      const res = await fetchApi('/api/alerts?top=20', {
        headers: getAuthHeaders(),
      }, { retries: 2, timeoutMs: 30000 });
      if (!res.ok) throw new Error('Erreur chargement notifications');
      const data = await res.json();
      setAlerts(data.value || []);
    } catch (err) {
      console.error(err);
    } finally {
      setAlertsLoading(false);
    }
  };

  useEffect(() => {
    fetchAlerts();
    const interval = window.setInterval(fetchAlerts, 60000);
    return () => window.clearInterval(interval);
  }, [canViewAlerts, getAuthHeaders]);

  const handleOpenNotifications = () => {
    setMenuOpen(false);
    setNotificationsOpen((open) => !open);
    if (!notificationsOpen) fetchAlerts();
  };

  const handleAcknowledgeAlert = async (id: string) => {
    try {
      const res = await fetchApi(`/api/alerts/${encodeURIComponent(id)}/ack`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      }, { retries: 2, timeoutMs: 30000 });
      if (!res.ok) throw new Error('Erreur acquittement');
      await fetchAlerts();
    } catch (err) {
      console.error(err);
    }
  };

  const handleLogout = () => {
    setMenuOpen(false);
    logout();
  };

  const roleLabel = user?.role === 'ADMIN' ? 'Administrateur' : user?.role === 'MANAGER' ? 'Manager' : 'Utilisateur';

  return (
    <header className="sticky top-0 z-40 flex h-[88px] items-center justify-between border-b border-slate-200 bg-white/95 px-8 shadow-[0_2px_12px_rgba(15,23,42,0.045)] backdrop-blur-xl transition-colors duration-300 dark:border-[#1e2749] dark:bg-[#0b1027]/95">
      <form onSubmit={handleSearch} className="relative w-full max-w-[500px]">
        <div className="pointer-events-none absolute left-3.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-xl text-[#456b90]">
          <Search size={18} strokeWidth={2.25} />
        </div>
        <input
          type="text"
          className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50/80 pl-14 pr-5 text-[14px] font-medium text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.03),inset_0_1px_0_rgba(255,255,255,0.9)] placeholder:text-[#7d94ad] outline-none transition-all duration-200 hover:border-slate-300 hover:bg-white focus:border-[#2f64f5] focus:bg-white focus:shadow-[0_8px_24px_rgba(47,100,245,0.10)] focus:ring-4 focus:ring-blue-600/10 dark:border-[#263254] dark:bg-[#0f1734] dark:text-white dark:shadow-none dark:placeholder:text-slate-500 dark:focus:border-cyan-400 dark:focus:ring-cyan-400/10"
          placeholder="Rechercher un numéro SAP..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </form>

      <div className="ml-8 flex items-center gap-5">
        {canViewAlerts && (
          <div className="relative" ref={notificationsRef}>
            <button
              className={`relative flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-600/20 active:scale-95 dark:focus:ring-cyan-400/20 ${notificationsOpen
                  ? 'bg-blue-50 text-[#1554d1] ring-1 ring-blue-200 dark:bg-cyan-400/10 dark:text-cyan-300 dark:ring-cyan-400/20'
                  : 'text-[#456b90] hover:bg-slate-50 hover:text-[#1554d1] dark:text-slate-400 dark:hover:bg-[#111a3a] dark:hover:text-cyan-300'
                }`}
              title="Notifications"
              aria-label="Notifications"
              aria-expanded={notificationsOpen}
              aria-haspopup="true"
              onClick={handleOpenNotifications}
            >
              <Bell size={20} strokeWidth={2.25} />
              {activeAlerts.length > 0 && (
                <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black text-white ring-2 ring-white dark:ring-[#0b1027]">
                  {activeAlerts.length > 9 ? '9+' : activeAlerts.length}
                </span>
              )}
            </button>

            {notificationsOpen && (
              <div className="absolute right-0 top-full mt-3 w-[360px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_60px_rgba(15,23,42,0.14)] animate-slide-down dark:border-[#263254] dark:bg-[#0f1734]">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-[#263254]">
                  <div>
                    <p className="text-sm font-black text-slate-950 dark:text-white">Notifications</p>
                    <p className="text-xs font-medium text-[#456b90] dark:text-slate-400">
                      {activeAlerts.length} alerte(s) active(s)
                    </p>
                  </div>
                  {criticalAlerts.length > 0 && (
                    <span className="rounded-full bg-red-50 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-red-600 ring-1 ring-red-100 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/20">
                      {criticalAlerts.length} critique
                    </span>
                  )}
                </div>

                <div className="max-h-80 overflow-y-auto p-2">
                  {alertsLoading ? (
                    <div className="flex items-center justify-center py-8 text-xs font-semibold text-slate-400">
                      Chargement...
                    </div>
                  ) : activeAlerts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                      <CheckCircle size={26} className="mb-2 text-emerald-500" />
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Aucune alerte active</p>
                      <p className="mt-1 text-xs text-slate-400">La supply chain est sous contrôle.</p>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {activeAlerts.slice(0, 5).map((alert) => (
                        <div key={alert.ID} className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 transition-colors hover:bg-white dark:border-[#263254] dark:bg-[#101936] dark:hover:bg-[#111a3a]">
                          <div className="flex items-start gap-3">
                            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 ring-1 ring-amber-100 dark:bg-amber-400/10 dark:text-amber-300 dark:ring-amber-400/20">
                              <AlertTriangle size={16} />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="rounded-md bg-white px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-[#2f64f5] ring-1 ring-slate-200 dark:bg-[#0f1734] dark:ring-[#263254]">
                                  {alert.type}
                                </span>
                                <span className="text-[10px] font-bold uppercase text-slate-400">{alert.severite}</span>
                              </div>
                              <p className="mt-1 line-clamp-2 text-xs font-semibold leading-relaxed text-slate-700 dark:text-slate-200">
                                {alert.message}
                              </p>
                              {alert.commande?.numero_sap && (
                                <p className="mt-1 text-[11px] font-bold text-[#2f64f5] dark:text-cyan-300">
                                  Commande {alert.commande.numero_sap}
                                </p>
                              )}
                            </div>
                            <button
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-300"
                              onClick={() => handleAcknowledgeAlert(alert.ID)}
                              title="Acquitter"
                              aria-label="Acquitter"
                            >
                              <CheckCircle size={16} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="border-t border-slate-100 p-2 dark:border-[#263254]">
                  <button
                    className="flex w-full items-center justify-center rounded-xl bg-[#2f64f5] px-3 py-2.5 text-xs font-black text-white shadow-sm transition-all hover:bg-[#1554d1] active:scale-[0.98]"
                    onClick={() => {
                      setNotificationsOpen(false);
                      navigate('/alerts');
                    }}
                  >
                    Voir toutes les alertes
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="h-10 w-px bg-slate-200 dark:bg-[#263254]" />

        <div className="relative" ref={menuRef}>
          <button
            className="group flex items-center gap-3 rounded-2xl px-2 py-1.5 transition-all duration-200 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-600/20 dark:hover:bg-[#111a3a]"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-expanded={menuOpen}
            aria-haspopup="true"
          >
            <div className="hidden min-w-0 text-right sm:block">
              <p className="truncate text-[14px] font-black leading-5 text-slate-950 dark:text-white">
                {displayName}
              </p>
              <p className="truncate text-[12px] font-medium text-[#456b90] dark:text-slate-400">
                {roleLabel}
              </p>
            </div>
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#2f64f5] text-xs font-black text-white shadow-lg shadow-blue-600/18">
              {initials}
            </div>
            <ChevronDown
              size={16}
              className="text-[#456b90] transition-transform duration-200 group-hover:text-[#1554d1] dark:text-slate-400 dark:group-hover:text-cyan-300"
              style={{ transform: menuOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
            />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-3 w-72 rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_24px_60px_rgba(15,23,42,0.14)] animate-slide-down dark:border-[#263254] dark:bg-[#0f1734]">
              <div className="flex items-center gap-3 border-b border-slate-100 p-3 dark:border-[#263254]">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#2f64f5] text-sm font-black text-white">
                  {initials}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-slate-950 dark:text-white">{displayName}</p>
                  <p className="truncate text-xs font-medium text-[#456b90] dark:text-slate-400">{user?.email || 'admin@smartorder.com'}</p>
                </div>
              </div>

              <div className="space-y-1 p-1.5">
                <button
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-slate-700 transition-all duration-150 hover:bg-slate-50 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-[#111a3a] dark:hover:text-white"
                  onClick={() => {
                    setMenuOpen(false);
                    navigate('/profile');
                  }}
                >
                  <User size={18} />
                  <span>Profil</span>
                </button>
                <button
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-slate-700 transition-all duration-150 hover:bg-slate-50 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-[#111a3a] dark:hover:text-white"
                  onClick={() => {
                    setMenuOpen(false);
                    navigate('/preferences');
                  }}
                >
                  <Settings size={18} />
                  <span>Préférences</span>
                </button>
              </div>

              <div className="border-t border-slate-100 p-1.5 dark:border-[#263254]">
                <button
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold text-rose-600 transition-all duration-150 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-500/10"
                  onClick={handleLogout}
                >
                  <LogOut size={18} />
                  <span>Déconnexion</span>
                </button>
              </div>
            </div>
          )}
        </div>

        <button
          className="hidden h-10 w-10 items-center justify-center rounded-xl text-[#456b90] transition-all duration-200 hover:bg-slate-50 hover:text-[#1554d1] focus:outline-none focus:ring-2 focus:ring-blue-600/20 active:scale-95 dark:text-slate-400 dark:hover:bg-[#111a3a] dark:hover:text-cyan-300 lg:flex"
          onClick={logout}
          title="Déconnexion"
          aria-label="Déconnexion"
        >
          <LogOut size={20} strokeWidth={2.25} />
        </button>
      </div>
    </header>
  );
}
