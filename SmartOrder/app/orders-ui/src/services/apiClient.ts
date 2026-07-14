const TRANSIENT_STATUSES = new Set([502, 503, 504]);

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function normalizePath(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  return path.startsWith('/') ? path : `/${path}`;
}

export function getApiBaseUrl() {
  const configured = process.env.REACT_APP_API_URL;
  if (configured) return stripTrailingSlash(configured);

  return '';
}

function getDirectBasBackendUrl() {
  // Ne jamais utiliser localhost - toujours passer par l'approuter
  return '';
}

export function toApiUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  const normalizedPath = normalizePath(path);
  const baseUrl = getApiBaseUrl();
  return baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath;
}

function getFetchCandidates(input: string) {
  if (/^https?:\/\//i.test(input)) return [input];

  const normalizedPath = normalizePath(input);
  const configuredUrl = toApiUrl(normalizedPath);

  const candidates = [normalizedPath, configuredUrl];

  if (process.env.REACT_APP_DIRECT_API_FALLBACK !== 'false') {
    const directBasUrl = getDirectBasBackendUrl();
    if (directBasUrl) {
      candidates.push(`${directBasUrl}${normalizedPath}`);
    }
  }

  // Try the relative (AppRouter) path first — CSV fallback handles missing auth.
  // Direct backend URL (port 4004) is the last resort due to BAS CORS restrictions (if enabled).
  return Array.from(new Set(candidates.filter(Boolean)));
}

export async function readErrorMessage(res: Response, fallback: string) {
  const text = await res.text().catch(() => '');
  if (!text) return fallback;

  try {
    const json = JSON.parse(text);
    return json.message || json.error?.message || json.error || fallback;
  } catch {
    return text || fallback;
  }
}

export async function fetchApi(
  input: string,
  init: RequestInit = {},
  options: { timeoutMs?: number; retries?: number } = {}
) {
  const timeoutMs = options.timeoutMs ?? 120000;
  const retries = Math.max(options.retries ?? 1, 1);
  const candidates = getFetchCandidates(input);
  let lastError: unknown;
  let lastResponse: Response | null = null;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    for (let index = 0; index < candidates.length; index += 1) {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(candidates[index], {
          credentials: 'include',
          ...init,
          signal: controller.signal,
        });
        window.clearTimeout(timeoutId);

        lastResponse = response;
        const hasNextCandidate = index < candidates.length - 1;
        const hasNextAttempt = attempt < retries;

        if (response.ok || !TRANSIENT_STATUSES.has(response.status) || (!hasNextCandidate && !hasNextAttempt)) {
          return response;
        }
      } catch (error) {
        window.clearTimeout(timeoutId);
        lastError = error;

        if (error instanceof Error && error.name === 'AbortError') {
          lastError = new Error('La requete a expire. Veuillez reessayer.');
        }
      }
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError instanceof Error ? lastError : new Error('Erreur reseau');
}
