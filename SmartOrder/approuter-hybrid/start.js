'use strict';

process.env.XS_APP_LOG_LEVEL = 'debug';
process.env.XS_APP_TRACER_LEVEL = 'debug';

const approuter = require('@sap/approuter');

process.env.PORT ||= '5000';

function normalizeLoopbackUrl(url) {
  return String(url || '')
    .replace('://localhost:', '://127.0.0.1:')
    .replace('://[::1]:', '://127.0.0.1:');
}

async function canReachBackend(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const res = await fetch(`${url}/api/health`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    return res.ok || res.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveSrvUrl() {
  if (process.env.SMARTORDER_SRV_URL) {
    const normalized = normalizeLoopbackUrl(process.env.SMARTORDER_SRV_URL);
    if (normalized !== process.env.SMARTORDER_SRV_URL) {
      console.warn(`[approuter-hybrid] SMARTORDER_SRV_URL normalized to ${normalized}`);
    }
    return normalized;
  }

  const candidates = ['http://127.0.0.1:4004', 'http://localhost:4004'];
  for (const candidate of candidates) {
    if (await canReachBackend(candidate)) return candidate;
  }

  console.warn('[approuter-hybrid] backend health probe failed; using http://127.0.0.1:4004');
  return 'http://127.0.0.1:4004';
}

function resolveUiUrl() {
  const normalized = normalizeLoopbackUrl(process.env.SMARTORDER_UI_URL || 'http://127.0.0.1:3002');
  if (process.env.SMARTORDER_UI_URL && normalized !== process.env.SMARTORDER_UI_URL) {
    console.warn(`[approuter-hybrid] SMARTORDER_UI_URL normalized to ${normalized}`);
  }
  return normalized;
}

async function main() {
  const srvUrl = await resolveSrvUrl();
  const uiUrl = resolveUiUrl();

  // In BAS hybrid mode we must own these local destinations. `cds bind` can
  // inject a destinations env var, and keeping it would make the AppRouter
  // target stale or cloud destinations instead of the local dev servers.
  // IMPORTANT: Ne PAS utiliser forwardAuthToken:true avec
  // authentication:NoAuthentication. Ce combination fait que l'AppRouter
  // supprime le header Authorization de la requete originale, ce qui empeche
  // le backend de valider le JWT XSUAA et cause des erreurs 503.
  // Avec authentication:NoAuthentication, le header Authorization est
  // transmis tel quel au backend, qui le decode via resolveXsuaaUserFromBearerToken().
  process.env.destinations = JSON.stringify([
    {
      name: 'srv-api',
      type: 'HTTP',
      url: srvUrl,
      proxyType: 'Internet',
      authentication: 'NoAuthentication',
      healthCheckType: 'none',
    },
    {
      name: 'ui-local',
      type: 'HTTP',
      url: uiUrl,
      proxyType: 'Internet',
      authentication: 'NoAuthentication',
    },
  ]);

  console.log(`[approuter-hybrid] srv-api -> ${srvUrl}`);
  console.log(`[approuter-hybrid] ui-local -> ${uiUrl}`);

  const ar = approuter();
  ar.start();
}

main().catch((err) => {
  console.error('[approuter-hybrid] startup failed:', err);
  process.exit(1);
});
