import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { fetchApi, readErrorMessage } from '../services/apiClient';

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchCurrentUser(token: string) {
  const maxAttempts = 4;
  let lastError = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let res: Response;

    try {
      res = await fetchApi('/api/me', {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
        cache: 'no-store',
      }, { timeoutMs: 20000, retries: 2 });
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Erreur reseau';
      if (attempt < maxAttempts) {
        await wait(600 * attempt);
        continue;
      }
      throw new Error(lastError);
    }

    if (res.ok) return res.json();

    lastError = await readErrorMessage(res, `/api/me a retourne HTTP ${res.status}`);
    if (![502, 503, 504].includes(res.status) || attempt === maxAttempts) {
      throw new Error(lastError);
    }

    await wait(600 * attempt);
  }

  throw new Error(lastError || 'Session XSUAA non validee');
}

function parseCallbackSession(token: string, encodedSession?: string | null) {
  if (!encodedSession) return null;

  try {
    const parsed = JSON.parse(encodedSession);
    return {
      ...parsed,
      access_token: parsed.access_token || token,
    };
  } catch {
    return null;
  }
}

export default function OAuthCallback() {
  const navigate = useNavigate();
  const { setOAuthToken } = useAuth();
  const [error, setError] = useState('');

  useEffect(() => {
    const search = window.location.search.slice(1);
    const params = new URLSearchParams(search);
    const code = params.get('code');
    const oauthError = params.get('error');

    if (oauthError) {
      navigate('/login?error=access_denied', { replace: true });
      return;
    }

    if (!code) {
      // Fallback : essayer le hash (ancien flux backend callback)
      const hash = window.location.hash.slice(1);
      const hashParams = new URLSearchParams(hash);
      const token = hashParams.get('access_token');
      if (token) {
        processToken(token, parseCallbackSession(token, hashParams.get('session')));
        return;
      }

      setError('Aucun code d\'autorisation reçu');
      return;
    }

    // Échanger le code contre un JWT via le backend
    fetchApi('/api/login/exchange-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    }, { timeoutMs: 30000, retries: 2 })
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text().catch(() => ''));
        return res.json();
      })
      .then((data) => {
        if (data.access_token) {
          processToken(data.access_token, data.session || null);
        } else {
          setError('Token manquant dans la réponse');
        }
      })
      .catch((err) => {
        setError('Erreur d\'échange du code : ' + err.message);
      });
  }, [navigate, setOAuthToken]);

  async function processToken(token: string, session?: any) {
    try {
      const me = session || await fetchCurrentUser(token);
      setOAuthToken({
        access_token: token,
        username: me.username || me.id || '',
        email: me.email || '',
        role: me.role || 'USER',
        displayName: me.displayName || me.name || '',
        prenom: me.prenom || me.given_name || '',
        nom: me.nom || me.family_name || '',
        scopes: me.scopes || [],
        groups: me.groups || [],
        roles: me.roles || [],
        authType: me.authType,
        validatedAt: me.validatedAt,
      });
      navigate('/', { replace: true });
    } catch (err) {
      setError(`Session XSUAA non validee par le backend : ${err instanceof Error ? err.message : 'token invalide'}`);
    }
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-white via-slate-50 to-slate-100 dark:from-[#0a0e27] dark:via-[#0f1633] dark:to-[#1a2a52]">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300 max-w-md text-center">
          <p className="text-lg font-semibold">Erreur d'authentification</p>
          <p className="mt-2 text-sm">{error}</p>
          <button
            onClick={() => navigate('/login', { replace: true })}
            className="mt-4 rounded-lg px-4 py-2 bg-gradient-to-r from-sky-400 to-blue-600 text-white font-semibold"
          >
            Retour au login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-white via-slate-50 to-slate-100 dark:from-[#0a0e27] dark:via-[#0f1633] dark:to-[#1a2a52]">
      <div className="flex items-center gap-3 text-slate-600 dark:text-slate-300">
        <div className="h-6 w-6 rounded-full border-2 border-sky-500 border-t-transparent animate-spin" />
        <span className="text-lg font-medium">Authentification en cours...</span>
      </div>
    </div>
  );
}
