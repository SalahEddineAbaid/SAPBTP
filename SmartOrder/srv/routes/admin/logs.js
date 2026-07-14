'use strict';

const express = require('express');
const cds = require('@sap/cds');
const {
  csvFallbackEnabled,
  isRecoverableDbError,
  readHistoryFallback,
} = require('../../utils/csvFallback');

const router = express.Router();
const LOG = cds.log('admin-logs');

function isPostgres() {
  try {
    const db = cds.env.requires?.db;
    const kind = db?.kind || db?.[process.env.NODE_ENV]?.kind || 'sqlite';
    return kind === 'postgres' || kind === 'postgresql';
  } catch { return false; }
}

function requireAdmin(req, res, next) {
  if (req.userRole === 'ADMIN' || req.user?.is?.('ADMIN') || req.user?.roles?.includes('ADMIN')) {
    return next();
  }
  const scopes = [
    ...(Array.isArray(req.user?.scopes) ? req.user.scopes : []),
    ...(Array.isArray(req.user?.scope) ? req.user.scope : []),
  ];
  if (scopes.some((scope) => scope === 'ADMIN' || scope.endsWith('.ADMIN') || scope.endsWith('.admin.logs'))) {
    return next();
  }
  return res.status(403).json({ error: 'Accès réservé aux administrateurs.' });
}
router.use(requireAdmin);

router.get('/history', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit || '100', 10), 1), 500);
    const db = await cds.connect.to('db');
    const pg = isPostgres();
    const rows = await db.run(`
      SELECT
        hs.ID,
        hs.commande_ID,
        hs.user_ID,
        hs.ancien_statut,
        hs.nouveau_statut,
        hs.commentaire,
        hs.source_changement,
        hs.createdAt,
        u.username AS user_username,
        u.email AS user_email,
        o.numero_sap AS commande_numero_sap
      FROM smartorder_HistoriqueStatut hs
      LEFT JOIN smartorder_Utilisateurs u ON u.ID = hs.user_ID
      LEFT JOIN smartorder_Orders o ON o.ID = hs.commande_ID
      ORDER BY hs.createdAt DESC
      LIMIT ${pg ? '$1' : '?'}
    `, [limit]);

    res.json({
      value: rows.map((row) => ({
        ID: row.ID,
        commande_ID: row.commande_ID,
        user_ID: row.user_ID,
        ancien_statut: row.ancien_statut,
        nouveau_statut: row.nouveau_statut,
        commentaire: row.commentaire,
        source_changement: row.source_changement,
        createdAt: row.createdAt,
        user: row.user_ID ? {
          ID: row.user_ID,
          username: row.user_username,
          email: row.user_email,
        } : null,
        commande: row.commande_ID ? {
          ID: row.commande_ID,
          numero_sap: row.commande_numero_sap,
        } : null,
      })),
    });
  } catch (err) {
    LOG.error('Erreur historique logs : %s', err.message);
    if (csvFallbackEnabled() && isRecoverableDbError(err)) {
      const limit = Math.min(Math.max(parseInt(req.query.limit || '100', 10), 1), 500);
      res.set('x-smartorder-data-source', 'csv-fallback');
      return res.json(readHistoryFallback({ top: limit }));
    }
    next(err);
  }
});

// GET /api/admin/logs
router.get('/', async (req, res, next) => {
  try {
    const { depuis, jusqu, limit = 100, page = 1 } = req.query;
    const db = await cds.connect.to('db');
    const pg = isPostgres();

    const conditions = [];
    const params = [];
    let idx = 1;

    if (depuis) {
      conditions.push(pg ? `hs.createdAt >= $${idx++}` : 'hs.createdAt >= ?');
      params.push(new Date(depuis).toISOString());
    }
    if (jusqu) {
      conditions.push(pg ? `hs.createdAt <= $${idx++}` : 'hs.createdAt <= ?');
      params.push(new Date(jusqu).toISOString());
    }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Concaténation compatible SQLite et PG
    const concatExpr = pg
      ? `CONCAT('Statut changé : ', hs.ancien_statut, ' → ', hs.nouveau_statut)`
      : `'Statut changé : ' || hs.ancien_statut || ' → ' || hs.nouveau_statut`;

    // Pagination : LIMIT/OFFSET avec paramètres compatibles
    const queryParams = [...params];
    let limitPlaceholder, offsetPlaceholder;

    if (pg) {
      limitPlaceholder = `$${idx++}`;
      offsetPlaceholder = `$${idx++}`;
    } else {
      limitPlaceholder = '?';
      offsetPlaceholder = '?';
    }
    queryParams.push(parseInt(limit), offset);

    const auditLogs = await db.run(`
      SELECT
        hs.ID,
        'AUDIT'                              AS source,
        'INFO'                               AS niveau,
        hs.createdAt                         AS timestamp,
        u.username                           AS utilisateur,
        u.email                              AS email_utilisateur,
        o.numero_sap                         AS reference,
        ${concatExpr}                        AS message,
        hs.commentaire,
        hs.source_changement
      FROM smartorder_HistoriqueStatut hs
      LEFT JOIN smartorder_Utilisateurs u ON u.ID = hs.user_ID
      LEFT JOIN smartorder_Orders o ON o.ID = hs.commande_ID
      ${where}
      ORDER BY hs.createdAt DESC
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}
    `, queryParams);

    // Total pour pagination (sans LIMIT/OFFSET)
    const countRes = await db.run(`
      SELECT COUNT(*) AS total
      FROM smartorder_HistoriqueStatut hs
      ${where}
    `, params);

    LOG.info('GET /api/admin/logs — %d entrées', auditLogs.length);
    res.json({
      logs: auditLogs,
      pagination: {
        total: parseInt(countRes[0]?.total || 0),
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil((countRes[0]?.total || 0) / parseInt(limit)),
      },
    });
  } catch (err) {
    LOG.error('Erreur logs : %s', err.message);
    if (csvFallbackEnabled() && isRecoverableDbError(err)) {
      const limit = Math.min(Math.max(parseInt(req.query.limit || '100', 10), 1), 500);
      const history = readHistoryFallback({ top: limit }).value;
      const logs = history.map((row) => ({
        ID: row.ID,
        source: 'AUDIT',
        niveau: 'INFO',
        timestamp: row.createdAt,
        utilisateur: row.user?.username || null,
        email_utilisateur: row.user?.email || null,
        reference: row.commande?.numero_sap || null,
        message: `Statut change : ${row.ancien_statut || '-'} -> ${row.nouveau_statut || '-'}`,
        commentaire: row.commentaire,
        source_changement: row.source_changement,
      }));
      res.set('x-smartorder-data-source', 'csv-fallback');
      return res.json({
        logs,
        pagination: {
          total: logs.length,
          page: parseInt(req.query.page || '1', 10),
          limit,
          pages: 1,
        },
      });
    }
    next(err);
  }
});

module.exports = router;
