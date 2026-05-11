'use strict';
/**
 * Routes Admin — Logs système fusionnés (UC14)
 * Compatibilité : SQLite (dev) + PostgreSQL (production)
 */
const express = require('express');
const cds = require('@sap/cds');

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
  if (!req.user?.is?.('ADMIN') && !req.user?.roles?.includes('ADMIN')) {
    return res.status(403).json({ error: 'Accès réservé aux administrateurs.' });
  }
  next();
}
router.use(requireAdmin);

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
      limitPlaceholder  = `$${idx++}`;
      offsetPlaceholder = `$${idx++}`;
    } else {
      limitPlaceholder  = '?';
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
        total:  parseInt(countRes[0]?.total || 0),
        page:   parseInt(page),
        limit:  parseInt(limit),
        pages:  Math.ceil((countRes[0]?.total || 0) / parseInt(limit)),
      },
    });
  } catch (err) {
    LOG.error('Erreur logs : %s', err.message);
    next(err);
  }
});

module.exports = router;
