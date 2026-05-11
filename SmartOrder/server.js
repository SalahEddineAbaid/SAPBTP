'use strict';
const path = require('path');
/**
 * SmartOrder — Extension du serveur CAP
 * Projet PFE SAP BTP — YAAS "Run It Best"
 *
 * Ce fichier étend le serveur Express CAP avec :
 * 1. /api/me — Endpoint info utilisateur (pour AuthService Angular)
 * 2. Role middleware — Contrôle d'accès RBAC avec héritage ADMIN→MANAGER→USER
 * 3. Socket.io (WebSocket rooms par rôle)
 * 4. Routes custom REST (analytics, export CSV, admin, sync SAP, ML)
 * 5. Cron jobs (sync 15min + alertes 5min)
 *
 * Utilisé par CAP via package.json : "cds": { "server": "./server.js" }
 */

const cds = require('@sap/cds');
const LOG = cds.log('server');

// ---------------------------------------------------------------------------
// Middleware : Héritage de rôles  ADMIN → MANAGER → USER
// ---------------------------------------------------------------------------
const ROLE_HIERARCHY = { ADMIN: 3, MANAGER: 2, USER: 1 };

/**
 * Extrait le rôle effectif depuis le contexte CAP req.user
 * Compatible mode mocked (dev) et XSUAA (production)
 */
function getUserRole(req) {
  if (!req.user) return null;
  if (req.user.is('ADMIN')) return 'ADMIN';
  if (req.user.is('MANAGER')) return 'MANAGER';
  if (req.user.is('USER') || req.user.is('authenticated-user')) return 'USER';
  return null;
}

/**
 * Middleware Express : vérifie que l'utilisateur possède au moins le rôle requis.
 * Grâce à l'héritage, un ADMIN accède aux routes MANAGER et USER.
 * Renvoie HTTP 401 si non authentifié, 403 si rôle insuffisant.
 */
function requireRole(...requiredRoles) {
  return (req, res, next) => {
    const userRole = getUserRole(req);

    // Non authentifié
    if (!userRole) {
      LOG.warn('Accès refusé (401) — aucun utilisateur authentifié sur %s', req.path);
      return res.status(401).json({
        error: 'Non authentifié',
        message: 'Vous devez être connecté pour accéder à cette ressource.',
      });
    }

    // Vérifier l'héritage : le rôle de l'utilisateur doit être ≥ au rôle minimum requis
    const userLevel = ROLE_HIERARCHY[userRole] || 0;
    const hasAccess = requiredRoles.some(
      (role) => userLevel >= (ROLE_HIERARCHY[role] || 0)
    );

    if (!hasAccess) {
      LOG.warn(
        'Accès refusé (403) — user=%s role=%s required=%s path=%s',
        req.user.id, userRole, requiredRoles.join('|'), req.path
      );
      return res.status(403).json({
        error: 'Accès interdit',
        message: `Rôle requis : ${requiredRoles.join(' ou ')}. Votre rôle : ${userRole}.`,
        requiredRoles,
        currentRole: userRole,
      });
    }

    // Injecter le rôle résolu dans la requête pour usage ultérieur
    req.userRole = userRole;
    next();
  };
}

// ---------------------------------------------------------------------------
// Serveur CAP étendu
// ---------------------------------------------------------------------------
module.exports = async (options) => {
  // Démarrer le serveur CAP standard et récupérer le serveur HTTP
  const server = await cds.server(options);

  // Récupérer l'app Express depuis CAP
  const app = cds.app;

  // -----------------------------------------------------------------------
  // 1a. POST /api/login — Authentification (mode développement)
  //     Utilise le BODY (pas le header Authorization) car BAS reverse proxy
  //     supprime les headers Authorization. Le body passe sans problème.
  // -----------------------------------------------------------------------
  app.use(require('express').json()); // Parse JSON body

  app.post('/api/login', (req, res) => {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ error: 'Username et password requis' });
    }

    // Lire les utilisateurs mockés depuis la config CDS
    const mockedUsers = cds.env.requires?.auth?.users || {};
    const mockUser = mockedUsers[username];

    if (!mockUser || mockUser.password !== password) {
      LOG.warn('Login échoué pour user=%s', username);
      return res.status(401).json({ error: 'Identifiants incorrects' });
    }

    const attrs = mockUser.attributes || {};
    // CDS stocke les rôles soit comme un tableau ["ADMIN"], soit comme un objet {"ADMIN": true}
    const rawRoles = mockUser.roles || [];
    const roles = Array.isArray(rawRoles) ? rawRoles : Object.keys(rawRoles);
    let role = 'USER';
    if (roles.includes('ADMIN'))   role = 'ADMIN';
    else if (roles.includes('MANAGER')) role = 'MANAGER';

    LOG.info('Login réussi : user=%s role=%s', username, role);
    return res.json({
      id:       username,
      username: attrs.username || username,
      email:    attrs.email    || `${username}@yaas.ma`,
      role,
      prenom:   attrs.prenom   || '',
      nom:      attrs.nom      || '',
    });
  });

  // -----------------------------------------------------------------------
  // 1b. GET /api/me — Info utilisateur (production XSUAA + fallback dev)
  // -----------------------------------------------------------------------
  app.get('/api/me', (req, res) => {
    // En production : req.user est rempli par XSUAA
    if (req.user && req.user.id) {
      const role = getUserRole(req);
      const attrs = req.user.attr || {};
      return res.json({
        id:       req.user.id,
        username: attrs.username || req.user.id,
        email:    attrs.email    || `${req.user.id}@yaas.ma`,
        role:     role || 'USER',
        prenom:   attrs.prenom   || '',
        nom:      attrs.nom      || '',
      });
    }
    return res.status(401).json({ error: 'Non authentifié' });
  });
  LOG.info('Routes /api/login (POST) et /api/me (GET) montées');

  // -----------------------------------------------------------------------
  // 2. Socket.io — WebSocket avec auth XSUAA
  // -----------------------------------------------------------------------
  try {
    const { initSocket } = require('./srv/websocket/socketManager');
    const httpServer = app.server || cds.server;
    const io = initSocket(httpServer);
    global._socketIO = io;
    LOG.info('Socket.io initialisé (rooms: USER, MANAGER, ADMIN)');
  } catch (err) {
    LOG.warn('Socket.io non disponible :', err.message);
  }

  // -----------------------------------------------------------------------
  // 3. Routes custom REST (en plus des routes OData CAP)
  //    Chaque route est protégée par requireRole() avec héritage
  // -----------------------------------------------------------------------

  // Analytics KPIs + Anomalies (UC06, UC11) — MANAGER + ADMIN
  try {
    const analyticsRouter = require('./srv/routes/analytics');
    app.use('/api/analytics', requireRole('MANAGER'), analyticsRouter);
    LOG.info('Routes /api/analytics montées (MANAGER+)');
  } catch (err) {
    LOG.warn('Routes analytics non disponibles :', err.message);
  }

  // Export CSV (UC10) — MANAGER + ADMIN
  try {
    const exportRouter = require('./srv/routes/export');
    app.use('/api/orders/export', requireRole('MANAGER'), exportRouter);
    LOG.info('Route /api/orders/export montée (MANAGER+)');
  } catch (err) {
    LOG.warn('Route export non disponible :', err.message);
  }

  // Admin — Users, Logs, Sync SAP, ML (UC12-UC16) — ADMIN seul
  try {
    const adminUsersRouter = require('./srv/routes/admin/users');
    const adminLogsRouter = require('./srv/routes/admin/logs');
    const adminSyncRouter = require('./srv/routes/admin/sync');
    const adminMlRouter = require('./srv/routes/admin/ml');
    app.use('/api/admin/users', requireRole('ADMIN'), adminUsersRouter);
    app.use('/api/admin/logs', requireRole('ADMIN'), adminLogsRouter);
    app.use('/api/admin/sync', requireRole('ADMIN'), adminSyncRouter);
    app.use('/api/admin/ml', requireRole('ADMIN'), adminMlRouter);
    LOG.info('Routes /api/admin/* montées (ADMIN)');
  } catch (err) {
    LOG.warn('Routes admin non disponibles :', err.message);
  }

  // Health check custom (public)
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'smartorder-backend',
      timestamp: new Date().toISOString(),
      env: process.env.NODE_ENV || 'development',
    });
  });

  // -----------------------------------------------------------------------
  // 5. Servir le frontend React (SPA)
  //
  //  MODE DÉVELOPPEMENT (BAS / local) :
  //    → build/index.html n'existe PAS
  //    → Cette section est ignorée automatiquement (pas d'erreur)
  //    → Le frontend est géré par "npm start" sur port 3001/3002
  //    → Le proxy CRA redirige /api et /odata vers ce serveur (:4004)
  //
  //  MODE PRODUCTION (après "npm run build" + cf deploy) :
  //    → build/index.html existe
  //    → Ce serveur sert directement les fichiers React buildés
  //    → Une seule URL publique pour tout (frontend + backend)
  // -----------------------------------------------------------------------
  const fs      = require('fs');
  const express = require('express');
  const REACT_DIST = path.join(__dirname, 'app', 'orders-ui', 'build');

  if (fs.existsSync(path.join(REACT_DIST, 'index.html'))) {
    // ✅ MODE PRODUCTION — build/ trouvé → on sert les fichiers React
    app.use(express.static(REACT_DIST));

    // SPA fallback : toute URL inconnue → index.html (React Router gère)
    // Exemple : /orders/123 → renvoie index.html → React Router affiche la page
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/odata') || req.path.startsWith('/api')) {
        return next(); // Laisser CAP gérer les routes API
      }
      res.sendFile(path.join(REACT_DIST, 'index.html'));
    });
    LOG.info('🚀 MODE PRODUCTION — Frontend React servi depuis %s', REACT_DIST);
  } else {
    // ℹ️ MODE DÉVELOPPEMENT — build/ absent → aucune action, pas d'erreur
    LOG.info('🛠️  MODE DÉVELOPPEMENT — Frontend non buildé');
    LOG.info('👉  Lancez "npm start" dans app/orders-ui (port 3001 ou 3002)');
  }

  // -----------------------------------------------------------------------
  // 4. Cron Jobs
  // -----------------------------------------------------------------------
  if (process.env.NODE_ENV !== 'test') {
    try {
      const { startCronJobs } = require('./srv/jobs/cronJobs');
      startCronJobs();
      LOG.info('Cron jobs démarrés (sync 15min, alertes 5min)');
    } catch (err) {
      LOG.warn('Cron jobs non démarrés :', err.message);
    }
  }

  LOG.info('SmartOrder Server prêt');
  return server;
};
