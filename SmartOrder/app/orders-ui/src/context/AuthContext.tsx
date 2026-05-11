import { createContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import type { UserSession } from '../types';

// ---------------------------------------------------------------------------
// Détection automatique de l'environnement
// En production BTP : l'AppRouter gère l'auth XSUAA (JWT injecté automatiquement)
// En développement BAS : on utilise POST /api/login avec username/password
// ---------------------------------------------------------------------------
const IS_PRODUCTION = !window.location.hostname.includes('localhost')
  && !window.location.port;

interface AuthContextType {
  user: UserSession | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<UserSession>;
  logout: () => void;
  getAuthHeaders: () => Record<string, string>;
  hasRole: (role: string) => boolean;
  isProduction: boolean;
}

export const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);

  // -------------------------------------------------------------------------
  // Au démarrage : vérifier si l'utilisateur est déjà authentifié
  //
  // PRODUCTION (BTP) : AppRouter a déjà injecté le JWT → GET /api/me retourne
  //                     les infos user immédiatement (pas besoin de login page)
  //
  // DÉVELOPPEMENT (BAS) : Pas de JWT → GET /api/me retourne 401
  //                        → on vérifie sessionStorage pour session précédente
  //                        → sinon on redirige vers login page
  // -------------------------------------------------------------------------
  useEffect(() => {
    const checkAuth = async () => {
      try {
        // Tentative 1 : GET /api/me (fonctionne en production XSUAA)
        const res = await fetch('/api/me', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          const userData: UserSession = {
            username: data.username || data.id,
            role: data.role || 'USER',
            email: data.email || '',
            credentials: '', // Pas besoin en production (JWT géré par AppRouter)
          };
          setUser(userData);
          sessionStorage.setItem('smartorder_user', JSON.stringify(userData));
          setLoading(false);
          return;
        }
      } catch {
        // /api/me a échoué → mode développement
      }

      // Tentative 2 : Restaurer depuis sessionStorage (mode développement)
      const stored = sessionStorage.getItem('smartorder_user');
      if (stored) {
        try { setUser(JSON.parse(stored)); } catch { /* ignore */ }
      }
      setLoading(false);
    };

    checkAuth();
  }, []);

  // -------------------------------------------------------------------------
  // Login — uniquement en mode développement (BAS)
  // En production, l'AppRouter redirige vers XSUAA automatiquement
  // -------------------------------------------------------------------------
  const login = useCallback(async (username: string, password: string): Promise<UserSession> => {
    // POST avec body — fonctionne sur BAS (le header Authorization est supprimé par BAS)
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw new Error('Identifiants incorrects');

    const data = await res.json();
    const credentials = btoa(`${username}:${password}`);
    const userData: UserSession = {
      username: data.username || username,
      role: data.role || 'USER',
      email: data.email || '',
      credentials,
    };
    setUser(userData);
    sessionStorage.setItem('smartorder_user', JSON.stringify(userData));
    return userData;
  }, []);

  // -------------------------------------------------------------------------
  // Logout
  // PRODUCTION : redirige vers /do/logout (AppRouter XSUAA)
  // DÉVELOPPEMENT : nettoie la session locale
  // -------------------------------------------------------------------------
  const logout = useCallback(() => {
    setUser(null);
    sessionStorage.removeItem('smartorder_user');

    if (IS_PRODUCTION) {
      // Rediriger vers le endpoint de logout AppRouter (xs-app.json → logoutEndpoint)
      // XSUAA invalide le token et redirige vers la page de login SAP
      window.location.href = '/do/logout';
    }
  }, []);

  // -------------------------------------------------------------------------
  // Headers d'authentification pour les requêtes API
  // PRODUCTION : rien à ajouter (JWT injecté automatiquement par AppRouter)
  // DÉVELOPPEMENT : ajouter le header Authorization Basic
  // -------------------------------------------------------------------------
  const getAuthHeaders = useCallback((): Record<string, string> => {
    if (IS_PRODUCTION) return {}; // JWT géré par AppRouter
    if (!user?.credentials) return {};
    return { Authorization: `Basic ${user.credentials}` };
  }, [user]);

  const hasRole = useCallback((role: string): boolean => {
    if (!user) return false;
    const hierarchy: Record<string, number> = { ADMIN: 3, MANAGER: 2, USER: 1 };
    return (hierarchy[user.role] || 0) >= (hierarchy[role] || 0);
  }, [user]);

  return (
    <AuthContext.Provider value={{
      user, loading, login, logout, getAuthHeaders, hasRole,
      isProduction: IS_PRODUCTION,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
