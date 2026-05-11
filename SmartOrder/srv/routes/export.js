'use strict';
/**
 * Route /api/orders/export — Export CSV UC10
 * Compatibilité : SQLite (dev) + PostgreSQL (production)
 */
const express = require('express');
const cds = require('@sap/cds');
const { stringify } = require('csv-stringify');

const router = express.Router();
const LOG = cds.log('export-route');

function isPostgres() {
  try {
    const db = cds.env.requires?.db;
    const kind = db?.kind || db?.[process.env.NODE_ENV]?.kind || 'sqlite';
    return kind === 'postgres' || kind === 'postgresql';
  } catch { return false; }
}

// GET /api/orders/export?statut=...&risk=...
router.get('/', async (req, res, next) => {
  try {
    const { statut, risk, fournisseur_id, q } = req.query;
    const db = await cds.connect.to('db');
    const pg = isPostgres();

    // Construction du filtre WHERE de façon compatible
    const conditions = [];
    const params = [];

    if (statut) {
      conditions.push(pg ? `o.statut = $${params.length + 1}` : 'o.statut = ?');
      params.push(statut);
    }
    if (risk) {
      conditions.push(pg ? `p.risque_label = $${params.length + 1}` : 'p.risque_label = ?');
      params.push(risk);
    }
    if (fournisseur_id) {
      conditions.push(pg ? `o.fournisseur_ID = $${params.length + 1}` : 'o.fournisseur_ID = ?');
      params.push(fournisseur_id);
    }
    if (q) {
      if (pg) {
        const idx = params.length + 1;
        conditions.push(`(o.numero_sap ILIKE $${idx} OR f.nom ILIKE $${idx})`);
      } else {
        conditions.push(`(o.numero_sap LIKE ? OR f.nom LIKE ?)`);
        params.push(`%${q}%`);
      }
      params.push(`%${q}%`);
    }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    // Colonnes formatées selon le dialecte
    const dateCol = pg
      ? (col) => `TO_CHAR(${col}, 'DD/MM/YYYY')`
      : (col) => `strftime('%d/%m/%Y', ${col})`;

    const scoreCol = pg
      ? `COALESCE(p.score_composite::text, 'N/A')`
      : `COALESCE(CAST(p.score_composite AS TEXT), 'N/A')`;

    const rows = await db.run(`
      SELECT
        o.numero_sap           AS "Numéro SAP",
        o.type                 AS "Type",
        o.statut               AS "Statut",
        o.urgence              AS "Urgence",
        (SELECT lc.categorie_article FROM smartorder_LignesCommande lc
         WHERE lc.commande_ID = o.ID ORDER BY lc.numero_poste LIMIT 1)
                               AS "Catégorie",
        f.code_sap             AS "Code Fournisseur",
        f.nom                  AS "Fournisseur",
        o.montant_total        AS "Montant",
        o.devise               AS "Devise",
        ${dateCol('o.date_creation')}         AS "Date Création",
        ${dateCol('o.date_previsionnelle')}   AS "Date Prévisionnelle",
        ${dateCol('o.date_livraison_reelle')} AS "Date Livraison Réelle",
        COALESCE(p.risque_label, 'N/A')       AS "Risque ML",
        ${scoreCol}                           AS "Score Composite",
        COALESCE(p.priorite_action, 'N/A')   AS "Priorité Action"
      FROM smartorder_Orders o
      JOIN smartorder_Fournisseurs f ON f.ID = o.fournisseur_ID
      LEFT JOIN smartorder_Predictions p ON p.commande_ID = o.ID
      ${where}
      ORDER BY o.date_creation DESC
    `, params);

    LOG.info('Export CSV — %d lignes', rows.length);

    // En-tête CSV avec BOM UTF-8 pour Excel
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',
      `attachment; filename="SmartOrder_Export_${new Date().toISOString().slice(0,10)}.csv"`
    );

    // BOM UTF-8 pour compatibilité Excel
    res.write('\uFEFF');

    // Streamer le CSV
    const stringifier = stringify({
      header: true,
      delimiter: ';',
      cast: {
        number: (v) => String(v).replace('.', ','), // format européen
      },
    });
    stringifier.pipe(res);
    rows.forEach(row => stringifier.write(row));
    stringifier.end();

  } catch (err) {
    LOG.error('Erreur export CSV : %s', err.message);
    next(err);
  }
});

module.exports = router;
