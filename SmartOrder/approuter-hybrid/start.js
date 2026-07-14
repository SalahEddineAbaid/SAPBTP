'use strict';

const approuter = require('@sap/approuter');

process.env.PORT ||= '5000';

async function resolveSrvUrl() {
  // En BAS/CF, utiliser une URL relative ou la variable d'environnement
  if (process.env.BACKEND_URL) {
    return process.env.BACKEND_URL;
  }

  // Détection automatique du backend
  // En local, le backend est sur le même hôte, port 4004
  const port = process.env.BACKEND_PORT || '4004';
  return `http://127.0.0.1:${port}`;
}

async function main() {
  const srvUrl = await resolveSrvUrl();

  // Configure backend destination only - frontend is served as static files
  process.env.destinations = JSON.stringify([
    {
      name: 'srv-api',
      type: 'HTTP',
      url: srvUrl,
      proxyType: 'Internet',
      authentication: 'NoAuthentication',
      forwardAuthToken: true,
    },
  ]);

  console.log(`[approuter-hybrid] srv-api -> ${srvUrl}`);
  console.log(`[approuter-hybrid] serving frontend from ./resources`);

  const ar = approuter();
  ar.start();
}

main().catch((err) => {
  console.error('[approuter-hybrid] startup failed:', err);
  process.exit(1);
});
