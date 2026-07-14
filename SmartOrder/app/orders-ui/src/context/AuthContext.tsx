import { createContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import type { UserSession } from '../types';
import { fetchApi } from '../services/apiClient';

// ---------------------------------------------------------------------------
// Détection automatique de l'environnement
//
// Priorité de détection (ordre décroissant) :
//   1. REACT_APP_AUTH_MODE=xsuaa  → injecté par `npm run start:xsuaa`
//   2. port :5000                 → AppRouter hybride local
//   3. hostname port5000-*        → AppRouter BAS (SAP Business Application Studio)
//   4. NODE_ENV=production        → déploiement CF / BTP
//
// IMPORTANT : même via AppRouter (:5000), la page de login est toujours affichée.
// L'AppRouter est configuré en authenticationType=none sur les routes frontend :
// c'est le React qui gère l'auth via Authorization Code (popup) ou Password Grant (ROPC).
// Le JWT obtenu est stocké dans sessionStorage et envoyé en Bearer sur chaque requête API.
// ---------------------------------------------------------------------------
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const IS_XSUAA_ENV_MODE = process.env.REACT_APP_AUTH_MODE === 'xsuaa';
const IS_APPR_OUTER_RUNTIME = typeof window !== 'undefined'
  && (window.location.port === '5000' || window.location.hostname.startsWith('port5000-'));
const USE_XSUAA_AUTH = IS_PRODUCTION || IS_XSUAA_ENV_MODE || IS_APPR_OUTER_RUNTIME;
const USE_XSUAA_HYBRID = !IS_PRODUCTION && USE_XSUAA_AUTH;

function roleFromScopes(scopes: string[] = []) {
  if (scopes.some((s) => s === 'ADMIN' || s.endsWith('.ADMIN') || s.endsWith('.admin.users'))) return 'ADMIN';
  if (scopes.some((s) => s === 'MANAGER' || s.endsWith('.MANAGER') || s.endsWith('.analytics.read'))) return 'MANAGER';
  return 'USER';
}

function normalizeRole(role?: string, scopes: string[] = []) {
  const normalized = String(role || '').toUpperCase();
  if (['ADMIN', 'MANAGER', 'USER'].includes(normalized)) return normalized;
  return roleFromScopes(scopes);
}

function collectScopes(data: any): string[] {
  const candidates = [
    data?.scopes,
    data?.scope,
    data?.identity?.scopes,
    data?.claims?.scope,
  ];
  return Array.from(new Set(candidates.flatMap((v) => {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') return v.split(/\s+/).filter(Boolean);
    return [];
  })));
}

function toUserSession(data: any): UserSession {
  const scopes = collectScopes(data);
  const groups = Array.isArray(data?.groups) ? data.groups
    : (Array.isArray(data?.identity?.groups) ? data.identity.groups : []);
  const roles = Array.isArray(data?.roles) ? data.roles
    : (Array.isArray(data?.identity?.roles) ? data.identity.roles : []);

  const displayName = data?.displayName
    || data?.name
    || [data?.prenom || data?.firstName || data?.given_name,
        data?.nom   || data?.lastName  || data?.family_name]
        .filter(Boolean).join(' ').trim()
    || data?.username || data?.email || 'xsuaa-user';

  return {
    username:    data?.username || data?.name || data?.id || data?.email || 'xsuaa-user',
    displayName,
    role:        normalizeRole(data?.role, scopes),
    email:       data?.email || '',
    credentials: '',
    scopes, groups, roles,
    prenom: data?.prenom || data?.firstName || data?.given_name || '',
    nom:    data?.nom    || data?.lastName  || data?.family_name  || '',
  };
}

function isFreshBackendValidatedSession(data: any) {
  const validatedAt = Number(data?.validatedAt || 0);
  return validatedAt > 0 && Date.now() - validatedAt < 2 * 60 * 1000;
}

// ---------------------------------------------------------------------------
// fetchMeWithBearer — Appelle /api/me avec le JWT Bearer explicitement.
// Utilisé pour valider un token stocké en sessionStorage.
// ---------------------------------------------------------------------------
async function fetchMeWithBearer(token: string): Promise<UserSession | null> {
  const res = await fetchApi('/api/me', {
    credentials: 'include',
    headers: { Authorization: `Bearer ${token}` },
  }, { retries: 3, timeoutMs: 20000 });
  if (!res.ok) return null;
  return toUserSession(await res.json());
}

interface AuthContextType {
  user: UserSession | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<UserSession>;
  loginWithAuthCode: () => void;
  setOAuthToken: (data: {
    access_token: string;
    username: string;
    email: string;
    role: string;
    displayName?: string;
    prenom?: string;
    nom?: string;
    scopes?: string[];
    groups?: string[];
    roles?: string[];
    authType?: string;
    validatedAt?: number;
  }) => void;
  logout: () => void;
  getAuthHeaders: () => Record<string, string>;
  hasRole: (role: string) => boolean;
  hasScope: (scope: string) => boolean;
  isProduction: boolean;
  isHybridMode: boolean;
}

export const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);

  // -------------------------------------------------------------------------
  // Au démarrage : restaurer la session depuis sessionStorage si un JWT valide
  // est présent — quel que soit le mode (mock, hybrid, prod).
  //
  // MODE XSUAA (start:xsuaa / AppRouter :5000 / production) :
  //   - Chercher un access_token dans sessionStorage
  //   - Le valider via GET /api/me avec Bearer → si OK : auto-login
  //   - Sinon → user=null → LoginPage affichée (Authorization Code ou ROPC)
  //   ⚠ On ne repose plus sur les cookies de session AppRouter pour auto-connecter :
  //     l'utilisateur DOIT passer par la page de login pour obtenir un token explicite.
  //
  // MODE MOCK (cds watch) :
  //   - Chercher des credentials Basic Auth dans sessionStorage → auto-login
  //   - Sinon → user=null → LoginPage affichée (formulaire mock)
  // -------------------------------------------------------------------------
  useEffect(() => {
    const checkAuth = async () => {
      const stored = sessionStorage.getItem('smartorder_user');

      if (stored) {
        try {
          const parsed = JSON.parse(stored);

          if (USE_XSUAA_AUTH) {
            // Mode XSUAA : la session doit avoir un access_token (pas de Basic Auth)
            if (parsed?.credentials && !parsed?.access_token) {
              // Session mock périmée → purger
              sessionStorage.removeItem('smartorder_user');
            } else if (parsed?.access_token) {
              if (isFreshBackendValidatedSession(parsed)) {
                const userData = toUserSession(parsed);
                const restored = { ...parsed, ...userData, access_token: parsed.access_token };
                setUser(restored);
                sessionStorage.setItem('smartorder_user', JSON.stringify(restored));
                setLoading(false);
                return;
              }
              // Valider le token auprès du backend
              const userData = await fetchMeWithBearer(parsed.access_token).catch(() => null);
              if (userData) {
                // Fusionner les données enrichies du backend avec le token stocké
                setUser({ ...userData, access_token: parsed.access_token });
                sessionStorage.setItem('smartorder_user', JSON.stringify({ ...userData, access_token: parsed.access_token }));
                setLoading(false);
                return;
              }
              // Token expiré → purger → login requis
              sessionStorage.removeItem('smartorder_user');
            }
          } else {
            // Mode mock : restaurer si credentials Basic Auth présents
            if (parsed?.credentials) {
              setUser(parsed);
              setLoading(false);
              return;
            }
            sessionStorage.removeItem('smartorder_user');
          }
        } catch {
          sessionStorage.removeItem('smartorder_user');
        }
      }

      // Aucune session valide → user reste null → LoginPage affichée
      setLoading(false);
    };

    checkAuth();
  }, []);

  // -------------------------------------------------------------------------
  // login — Formulaire username/password (Password Grant ROPC)
  //   Mode XSUAA : POST /api/login → backend appelle XSUAA → retourne JWT
  //   Mode mock  : POST /api/login → backend lit les users mock → retourne infos
  // -------------------------------------------------------------------------
  const login = useCallback(async (username: string, password: string): Promise<UserSession> => {
    const res = await fetchApi('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }, { retries: 2, timeoutMs: 30000 });
    if (!res.ok) throw new Error('Identifiants incorrects');

    const data = await res.json();
    let userData: UserSession;

    if (data.access_token) {
      // XSUAA ROPC : token JWT reçu
      userData = {
        username:    data.username || username,
        displayName: [data.prenom, data.nom].filter(Boolean).join(' ').trim() || data.username || username,
        role:        data.role || 'USER',
        email:       data.email || '',
        credentials: '',
        access_token: data.access_token,
        prenom:      data.prenom || '',
        nom:         data.nom    || '',
      };
    } else {
      // Mock auth : pas de JWT → Basic Auth
      userData = {
        username:    data.username || username,
        role:        data.role || 'USER',
        email:       data.email || '',
        credentials: btoa(`${username}:${password}`),
        access_token: undefined,
        prenom:      data.prenom || '',
        nom:         data.nom    || '',
      };
    }

    setUser(userData);
    sessionStorage.setItem('smartorder_user', JSON.stringify(userData));
    return userData;
  }, []);

  // -------------------------------------------------------------------------
  // loginWithAuthCode — Authorization Code Flow (redirect pleine page)
  //
  // Flux OAuth 2.0 standard :
  //   1. Redirect vers /api/login/authorize
  //   2. Backend redirige vers la page login XSUAA
  //   3. L'utilisateur saisit ses identifiants SAP
  //   4. XSUAA callback → backend échange le code contre un JWT
  //   5. Backend redirige vers /oauth/callback#access_token=xxx
  //   6. OAuthCallback (React) lit le token dans le hash → setOAuthToken → dashboard
  //
  // Note : on utilise un redirect pleine page (pas une popup) car en BAS,
  // le callback doit rester derrière l'AppRouter (port5000) pour éviter
  // les appels cross-origin directs vers le backend CAP (port4004).
  // -------------------------------------------------------------------------
  const loginWithAuthCode = useCallback(() => {
    window.location.href = '/api/login/authorize';
  }, []);

  // -------------------------------------------------------------------------
  // setOAuthToken — Appelé par OAuthCallback après le retour de XSUAA
  // (flux redirect classique, sans popup)
  // -------------------------------------------------------------------------
  const setOAuthToken = useCallback((data: {
    access_token: string;
    username: string;
    email: string;
    role: string;
    displayName?: string;
    prenom?: string;
    nom?: string;
    scopes?: string[];
    groups?: string[];
    roles?: string[];
    authType?: string;
    validatedAt?: number;
  }) => {
    const userData: UserSession = {
      username:    data.username,
      displayName: data.displayName
        || [data.prenom, data.nom].filter(Boolean).join(' ').trim()
        || data.username,
      role:        data.role,
      email:       data.email,
      credentials: '',
      access_token: data.access_token,
      authType:     data.authType,
      validatedAt:  data.validatedAt,
      scopes:       data.scopes || [],
      groups:       data.groups || [],
      roles:        data.roles || [],
      prenom:      data.prenom,
      nom:         data.nom,
    };
    setUser(userData);
    sessionStorage.setItem('smartorder_user', JSON.stringify(userData));
  }, []);

  // -------------------------------------------------------------------------
  // logout
  // -------------------------------------------------------------------------
  const logout = useCallback(() => {
    setUser(null);
    sessionStorage.removeItem('smartorder_user');
    if (IS_PRODUCTION) {
      // Production CF/BTP : AppRouter gère la session → invalider via /do/logout
      window.location.href = '/do/logout';
    } else if (USE_XSUAA_HYBRID) {
      // Hybride local : AppRouter en mode none → pas de session AppRouter à invalider
      // Simple retour à la page de login
      window.location.href = '/login';
    }
    // Mode mock : pas de redirection, le composant React gère le retour
  }, []);

  // -------------------------------------------------------------------------
  // Refresh automatique du token XSUAA (toutes les 50 min)
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!USE_XSUAA_AUTH || !user?.access_token) return;

    const id = setInterval(async () => {
      try {
        const userData = await fetchMeWithBearer(user.access_token!);
        if (!userData) {
          console.warn('[SmartOrder] Token expiré — déconnexion automatique');
          logout();
        } else {
          const refreshed = { ...userData, access_token: user.access_token };
          setUser(refreshed);
          sessionStorage.setItem('smartorder_user', JSON.stringify(refreshed));
        }
      } catch {
        logout();
      }
    }, 50 * 60 * 1000);

    return () => clearInterval(id);
  }, [user?.access_token, logout]);

  // -------------------------------------------------------------------------
  // getAuthHeaders — Headers d'authentification pour les requêtes API
  //   Priorité : Bearer JWT (XSUAA) > Basic (mock)
  // -------------------------------------------------------------------------
  const getAuthHeaders = useCallback((): Record<string, string> => {
    if (!user) return {};
    if (user.access_token) return { Authorization: `Bearer ${user.access_token}` };
    if (user.credentials)  return { Authorization: `Basic ${user.credentials}` };
    return {};
  }, [user]);

  const hasRole = useCallback((role: string): boolean => {
    if (!user) return false;
    const h: Record<string, number> = { ADMIN: 3, MANAGER: 2, USER: 1 };
    return (h[user.role] || 0) >= (h[role] || 0);
  }, [user]);

  const hasScope = useCallback((scope: string): boolean => {
    if (!user) return false;

    if (!USE_XSUAA_AUTH) {
      const map: Record<string, string[]> = {
        ADMIN:   ['orders.read','orders.write','dashboard.read','predictions.view',
                  'analytics.read','export.csv','admin.users','admin.roles',
                  'admin.logs','admin.sync','admin.ml'],
        MANAGER: ['orders.read','orders.write','dashboard.read','predictions.view',
                  'analytics.read','export.csv'],
        USER:    ['orders.read'],
      };
      return map[user.role]?.includes(scope) || false;
    }

    if (user.scopes?.length) {
      return user.scopes.some((s) => s === scope || s.endsWith(`.${scope}`));
    }
    return hasRole('ADMIN');
  }, [user, hasRole]);

  return (
    <AuthContext.Provider value={{
      user, loading,
      login, loginWithAuthCode,
      setOAuthToken, logout,
      getAuthHeaders, hasRole, hasScope,
      isProduction: USE_XSUAA_AUTH,
      isHybridMode: USE_XSUAA_HYBRID,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
