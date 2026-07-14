import { useState, type FormEvent, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
  Eye, EyeOff, AlertCircle, Zap, TrendingUp, BarChart3,
  Lock, Moon, Sun, LogIn, ShieldCheck,
} from 'lucide-react';

// Cohérent avec AuthContext : REACT_APP_AUTH_MODE=xsuaa est injecté par start:xsuaa
const IS_XSUAA_MODE =
  process.env.REACT_APP_AUTH_MODE === 'xsuaa'
  || (typeof window !== 'undefined' && window.location.port === '5000')
  || (typeof window !== 'undefined' && window.location.hostname.startsWith('port5000-'));

type LoginTab = 'ropc' | 'authcode';

export default function LoginPage() {
  const { login, loginWithAuthCode } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [activeTab, setActiveTab]   = useState<LoginTab>(IS_XSUAA_MODE ? 'authcode' : 'ropc');
  const [username,  setUsername]    = useState('');
  const [password,  setPassword]    = useState('');
  const [showPw,    setShowPw]      = useState(false);
  const [error,     setError]       = useState('');
  const [loading,   setLoading]     = useState(false);
  const [isDark,    setIsDark]      = useState(false);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains('dark'));
    const oauthError = searchParams.get('error');
    if (oauthError === 'access_denied')        setError('Connexion annulée par l\'utilisateur');
    else if (oauthError === 'token_exchange_failed') setError('Erreur lors de l\'échange du code XSUAA');
    else if (oauthError === 'server_error')    setError('Erreur serveur — veuillez réessayer');
  }, [searchParams]);

  const toggleTheme = () => {
    const html = document.documentElement;
    const dark = html.classList.toggle('dark');
    setIsDark(dark);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  };

  // ── Password Grant (ROPC) submit ────────────────────────────────────────
  const handleRopcSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      navigate('/');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Identifiants incorrects');
    } finally {
      setLoading(false);
    }
  };

  // ── Authorization Code (popup) ───────────────────────────────────────────
  const handleAuthCode = () => {
    setError('');
    loginWithAuthCode();
    // La navigation se fera automatiquement via setOAuthToken → user non-null → Navigate('/')
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden flex bg-gradient-to-br from-white via-slate-50 to-slate-100 dark:from-[#0a0e27] dark:via-[#0f1633] dark:to-[#1a2a52] transition-colors duration-300">

      {/* Animated Grid Overlay */}
      <div className="absolute inset-0 opacity-5 dark:opacity-10 pointer-events-none bg-[linear-gradient(0deg,transparent_24%,rgba(14,165,233,0.08)_25%,rgba(14,165,233,0.08)_26%,transparent_27%,transparent_74%,rgba(14,165,233,0.08)_75%,rgba(14,165,233,0.08)_76%,transparent_77%,transparent),linear-gradient(90deg,transparent_24%,rgba(14,165,233,0.08)_25%,rgba(14,165,233,0.08)_26%,transparent_27%,transparent_74%,rgba(14,165,233,0.08)_75%,rgba(14,165,233,0.08)_76%,transparent_77%,transparent)] bg-[size:60px_60px] animate-grid-shift" />

      {/* Floating Glow Elements */}
      <div className="absolute rounded-full pointer-events-none blur-[80px] opacity-15 dark:opacity-20 animate-pulse-glow bg-[radial-gradient(circle,rgba(14,165,233,0.3)_0%,transparent_70%)] dark:bg-[radial-gradient(circle,rgba(0,217,255,0.4)_0%,transparent_70%)]" style={{ width: '500px', height: '500px', top: '-200px', right: '-100px' }} />
      <div className="absolute rounded-full pointer-events-none blur-[80px] opacity-10 dark:opacity-15 animate-pulse-glow" style={{ width: '400px', height: '400px', bottom: '100px', left: '-150px' }} />

      {/* Theme Toggle */}
      <button onClick={toggleTheme} className="absolute top-6 right-6 z-50 p-2.5 rounded-lg bg-white/80 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-white dark:hover:bg-slate-900 shadow-sm hover:shadow transition-all duration-300" aria-label="Toggle theme">
        {isDark
          ? <Sun  className="w-5 h-5 text-amber-500 animate-pulse" />
          : <Moon className="w-5 h-5 text-slate-700 hover:text-blue-600 transition-colors" />}
      </button>

      <div className="relative z-10 flex min-h-screen w-full">

        {/* ── LEFT HERO ── */}
        <div className="hidden lg:flex w-1/2 flex-col justify-between p-12 py-20 text-slate-900 dark:text-white overflow-y-auto">
          <div>
            {/* Logo */}
            <div className="mb-12 animate-slide-down">
              <div className="mb-2 flex items-center gap-3 group">
                <div className="relative transition-transform duration-300 group-hover:scale-110">
                  <div className="absolute inset-0 bg-gradient-to-r from-sky-400 to-blue-600 dark:from-cyan-500 dark:to-blue-600 rounded-lg blur opacity-60 group-hover:opacity-80 transition-opacity" />
                  <div className="relative bg-white dark:bg-slate-900 rounded-lg p-2 border border-slate-200/50 dark:border-slate-800 shadow-sm">
                    <Zap className="w-6 h-6 text-blue-600 dark:text-cyan-400 animate-pulse" />
                  </div>
                </div>
                <span className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-sky-500 dark:from-cyan-400 dark:to-blue-400 bg-clip-text text-transparent">SmartOrder</span>
              </div>
              <p className="text-slate-500 dark:text-slate-400 text-xs pl-1 font-semibold uppercase tracking-wider">Powered by SAP BTP</p>
            </div>

            {/* Headline */}
            <div className="space-y-5">
              <h1 className="text-5xl font-extrabold tracking-tight leading-tight text-slate-900 dark:text-white">
                <span className="inline-block animate-slide-down" style={{ animationDelay: '0.1s', animationFillMode: 'both' }}>Commandes SAP</span>
                <span className="block mt-2 bg-gradient-to-r from-blue-600 to-sky-500 dark:from-cyan-400 dark:to-blue-300 bg-clip-text text-transparent animate-slide-down" style={{ animationDelay: '0.2s', animationFillMode: 'both' }}>intelligentes</span>
                <span className="inline-block animate-slide-down" style={{ animationDelay: '0.3s', animationFillMode: 'both' }}>et optimisées</span>
              </h1>
              <p className="text-lg text-slate-600 dark:text-slate-300 leading-relaxed max-w-md animate-slide-down" style={{ animationDelay: '0.4s', animationFillMode: 'both' }}>
                Pilotez vos approvisionnements avec précision grâce à la puissance de l&apos;intelligence artificielle intégrée à SAP BTP.
              </p>
            </div>
          </div>

          {/* Features */}
          <div className="space-y-4">
            {[
              { delay: '0.5s', text: 'Gestion centralisée des commandes SAP' },
              { delay: '0.6s', text: 'Prédiction ML des ruptures de stock' },
              { delay: '0.7s', text: 'Tableaux de bord temps réel & alertes' },
              { delay: '0.8s', text: 'Sécurisé avec SAP BTP Authorization (XSUAA)' },
            ].map(({ delay, text }) => (
              <div key={text} className="flex items-center gap-3 text-slate-600 dark:text-slate-300 text-sm font-medium animate-slide-right" style={{ animationDelay: delay, animationFillMode: 'both' }}>
                <div className="h-1.5 w-1.5 rounded-full bg-sky-500 dark:bg-[#00d9ff] shadow-[0_0_8px_rgba(14,165,233,0.6)] dark:shadow-[0_0_10px_rgba(0,217,255,0.6)] animate-pulse" />
                <span>{text}</span>
              </div>
            ))}
          </div>

          {/* Stats */}
          <div className="hidden 2xl:flex gap-4 mt-8">
            <div className="rounded-xl border border-sky-500/15 dark:border-cyan-500/20 bg-white/80 dark:bg-slate-900/30 backdrop-blur-lg p-4 animate-float">
              <div className="flex items-center gap-3">
                <TrendingUp className="w-5 h-5 text-blue-600 dark:text-cyan-400" />
                <div>
                  <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Efficiency Gain</div>
                  <div className="text-lg font-bold text-blue-600 dark:text-cyan-400">+47%</div>
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-sky-500/15 dark:border-cyan-500/20 bg-white/80 dark:bg-slate-900/30 backdrop-blur-lg p-4 animate-float" style={{ animationDelay: '2s' }}>
              <div className="flex items-center gap-3">
                <BarChart3 className="w-5 h-5 text-blue-600 dark:text-cyan-400" />
                <div>
                  <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Forecast Accuracy</div>
                  <div className="text-lg font-bold text-blue-600 dark:text-cyan-400">94.2%</div>
                </div>
              </div>
            </div>
          </div>

          <div className="text-slate-400 dark:text-slate-500 text-xs">© 2026 SmartOrder — SAP Business Technology Platform</div>
        </div>

        {/* ── RIGHT LOGIN PANEL ── */}
        <div className="w-full lg:w-1/2 flex items-center justify-center p-4 lg:p-12 z-10">
          <div className="w-full max-w-md">
            <div className="rounded-2xl border border-sky-500/15 dark:border-cyan-500/30 bg-white/90 dark:bg-slate-900/50 backdrop-blur-lg p-8 shadow-xl dark:shadow-[0_0_60px_rgba(0,217,255,0.2)] animate-slide-up">

              {/* Header */}
              <div className="mb-6 text-center">
                <p className="text-blue-600 dark:text-cyan-400 text-sm font-semibold uppercase tracking-widest mb-2 animate-pulse">Bienvenue</p>
                <h2 className="text-3xl font-extrabold text-slate-900 dark:text-white mb-2 tracking-tight">Connexion</h2>
                <p className="text-slate-500 dark:text-slate-400 text-sm">
                  Accédez à votre espace de gestion des commandes
                </p>
              </div>

              {/* Error Alert */}
              {error && (
                <div className="mb-5 flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                  <AlertCircle size={18} className="flex-shrink-0" />
                  <span className="text-sm font-medium">{error}</span>
                </div>
              )}

              {/* ── Tabs (uniquement en mode XSUAA) ── */}
              {IS_XSUAA_MODE && (
                <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 mb-6 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => { setActiveTab('authcode'); setError(''); }}
                    className={`flex-1 py-2.5 text-sm font-semibold transition-colors duration-200 flex items-center justify-center gap-2 cursor-pointer
                      ${activeTab === 'authcode'
                        ? 'bg-gradient-to-r from-sky-500 to-blue-600 text-white'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 bg-transparent'}`}
                  >
                    <ShieldCheck size={15} />
                    Authorization Code
                  </button>
                  <button
                    type="button"
                    onClick={() => { setActiveTab('ropc'); setError(''); }}
                    className={`flex-1 py-2.5 text-sm font-semibold transition-colors duration-200 flex items-center justify-center gap-2 cursor-pointer
                      ${activeTab === 'ropc'
                        ? 'bg-gradient-to-r from-sky-500 to-blue-600 text-white'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 bg-transparent'}`}
                  >
                    <LogIn size={15} />
                    Password Grant
                  </button>
                </div>
              )}

              {/* ── Authorization Code Panel ── */}
              {IS_XSUAA_MODE && activeTab === 'authcode' && (
                <div className="space-y-5">
                  <div className="rounded-xl border border-sky-500/20 dark:border-cyan-500/20 bg-sky-50/50 dark:bg-cyan-900/10 p-5 text-center space-y-3">
                    <div className="flex justify-center">
                      <div className="relative">
                        <div className="absolute inset-0 bg-gradient-to-r from-sky-400 to-blue-600 rounded-full blur opacity-40 animate-pulse" />
                        <div className="relative bg-white dark:bg-slate-900 rounded-full p-3 border border-sky-200 dark:border-cyan-800">
                          <ShieldCheck className="w-8 h-8 text-blue-600 dark:text-cyan-400" />
                        </div>
                      </div>
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                      Connexion via le portail SAP BTP.<br />
                      Une fenêtre de login s'ouvrira pour saisir vos identifiants SAP.
                    </p>
                    <ul className="text-xs text-left text-slate-500 dark:text-slate-400 space-y-1 pl-2">
                      <li className="flex items-center gap-2"><span className="text-green-500">✓</span> Token signé par XSUAA</li>
                      <li className="flex items-center gap-2"><span className="text-green-500">✓</span> Rôles & scopes SAP BTP</li>
                      <li className="flex items-center gap-2"><span className="text-green-500">✓</span> Conforme OAuth 2.0 RFC 6749</li>
                    </ul>
                  </div>

                  <button
                    type="button"
                    onClick={handleAuthCode}
                    className="relative w-full rounded-lg px-6 py-3.5 font-semibold text-white bg-gradient-to-r from-sky-400 to-blue-600 dark:from-cyan-400 dark:to-blue-600 shadow-[0_4px_15px_rgba(14,165,233,0.3)] dark:shadow-[0_0_30px_rgba(0,217,255,0.4)] hover:scale-[1.02] active:scale-[0.98] hover:shadow-[0_8px_24px_rgba(14,165,233,0.5)] transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <ShieldCheck size={18} />
                    Se connecter avec SAP XSUAA
                  </button>

                  <p className="text-center text-xs text-slate-400 dark:text-slate-500">
                    Vous serez redirigé vers la page de login SAP dans une nouvelle fenêtre.
                  </p>
                </div>
              )}

              {/* ── Password Grant (ROPC) Panel ── */}
              {(!IS_XSUAA_MODE || activeTab === 'ropc') && (
                <form onSubmit={handleRopcSubmit} className="space-y-5">
                  {IS_XSUAA_MODE && (
                    <div className="rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2">
                      <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                      <span>
                        <strong>Password Grant (ROPC)</strong> — Les identifiants sont transmis directement au serveur.
                        Préférez <button type="button" onClick={() => setActiveTab('authcode')} className="underline cursor-pointer">Authorization Code</button> pour une sécurité maximale.
                      </span>
                    </div>
                  )}

                  {/* Username */}
                  <div>
                    <label htmlFor="username" className="block text-sm font-semibold mb-2 text-slate-700 dark:text-slate-300">
                      {IS_XSUAA_MODE ? 'Identifiant SAP BTP' : 'Nom d\'utilisateur'}
                    </label>
                    <input
                      id="username"
                      type="text"
                      placeholder={IS_XSUAA_MODE ? 'prenom.nom@yaas.ma' : 'Entrez votre identifiant'}
                      className="w-full rounded-lg border border-sky-500/20 dark:border-cyan-500/20 bg-slate-50 dark:bg-slate-800/50 px-4 py-3 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:bg-white dark:focus:bg-slate-800/70 focus:outline-none focus:ring-2 focus:ring-sky-500/50 dark:focus:ring-cyan-500/50 transition-all duration-300"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      autoFocus
                      required
                    />
                  </div>

                  {/* Password */}
                  <div>
                    <label htmlFor="password" className="block text-sm font-semibold mb-2 text-slate-700 dark:text-slate-300">
                      Mot de passe
                    </label>
                    <div className="relative">
                      <input
                        id="password"
                        type={showPw ? 'text' : 'password'}
                        placeholder="••••••••"
                        className="w-full rounded-lg border border-sky-500/20 dark:border-cyan-500/20 bg-slate-50 dark:bg-slate-800/50 px-4 py-3 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:bg-white dark:focus:bg-slate-800/70 focus:outline-none focus:ring-2 focus:ring-sky-500/50 dark:focus:ring-cyan-500/50 transition-all duration-300"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPw(!showPw)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-blue-600 dark:hover:text-cyan-400 transition-colors bg-transparent border-none cursor-pointer p-1"
                        aria-label={showPw ? 'Masquer' : 'Afficher'}
                      >
                        {showPw ? <EyeOff size={20} /> : <Eye size={20} />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="relative w-full rounded-lg px-6 py-3 font-semibold text-white bg-gradient-to-r from-sky-400 to-blue-600 dark:from-cyan-400 dark:to-blue-600 shadow-[0_4px_15px_rgba(14,165,233,0.3)] hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-300 flex items-center justify-center gap-2 mt-6 cursor-pointer"
                  >
                    {loading ? (
                      <>
                        <div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                        Connexion en cours...
                      </>
                    ) : (
                      <>
                        <LogIn size={17} />
                        Se connecter
                      </>
                    )}
                  </button>
                </form>
              )}

              {/* Footer */}
              <div className="mt-6 pt-4 border-t border-slate-200/50 dark:border-slate-700/30">
                <div className="text-center text-xs text-slate-400 dark:text-slate-500 font-medium flex items-center justify-center gap-1">
                  <Lock className="w-3.5 h-3.5 text-blue-600 dark:text-cyan-400" />
                  {IS_XSUAA_MODE
                    ? 'Authentification SAP XSUAA — OAuth 2.0'
                    : 'Connexion sécurisée avec SAP BTP'}
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
