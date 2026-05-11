'use strict';
/**
 * SmartOrder — Analytics Service (CAP version)
 * UC06 : Dashboard KPIs (5 requêtes parallèles)
 * UC11 : Détection anomalies (4 requêtes parallèles)
 *
 * Compatibilité : SQLite (dev) + PostgreSQL (production)
 */

const cds = require('@sap/cds');
const LOG = cds.log('analytics-service');

// ---------------------------------------------------------------------------
// Helper : connexion DB + détection dialecte
// ---------------------------------------------------------------------------
const getDb = () => cds.connect.to('db');

function isPostgres() {
  try {
    const db = cds.env.requires?.db;
    const kind = db?.kind || db?.[process.env.NODE_ENV]?.kind || 'sqlite';
    return kind === 'postgres' || kind === 'postgresql';
  } catch { return false; }
}

// ============================================================
// UC06 — Dashboard KPIs
// ============================================================
async function getKPIs() {
  const db = await getDb();
  const pg = isPostgres();

  const [
    totaux,
    repartitionRisques,
    evolution12Mois,
    topFournisseurs,
    dureesMoyennes,
  ] = await Promise.all([

    // ── KPI 1 — Total, retards, blocages, montant ──────────────────────────
    // COUNT(*) FILTER ne marche pas en SQLite → on utilise SUM(CASE WHEN)
    pg
      ? db.run(`
          SELECT
            COUNT(*)                                                    AS total_commandes,
            COUNT(*) FILTER (WHERE statut NOT IN ('LIVRE','ANNULE')
              AND date_previsionnelle < CURRENT_DATE)                   AS commandes_en_retard,
            COUNT(*) FILTER (WHERE statut = 'BLOQUE')                   AS commandes_bloquees,
            COUNT(*) FILTER (WHERE statut = 'EN_COURS')                 AS commandes_en_cours,
            COUNT(*) FILTER (WHERE statut = 'LIVRE')                    AS commandes_livrees,
            COALESCE(SUM(montant_total), 0)                             AS montant_total_global,
            COALESCE(AVG(montant_total), 0)                             AS montant_moyen
          FROM smartorder_Orders
        `)
      : db.run(`
          SELECT
            COUNT(*)                                                                    AS total_commandes,
            SUM(CASE WHEN statut NOT IN ('LIVRE','ANNULE')
                      AND date_previsionnelle < date('now') THEN 1 ELSE 0 END)         AS commandes_en_retard,
            SUM(CASE WHEN statut = 'BLOQUE'   THEN 1 ELSE 0 END)                      AS commandes_bloquees,
            SUM(CASE WHEN statut = 'EN_COURS' THEN 1 ELSE 0 END)                      AS commandes_en_cours,
            SUM(CASE WHEN statut = 'LIVRE'    THEN 1 ELSE 0 END)                      AS commandes_livrees,
            COALESCE(SUM(montant_total), 0)                                            AS montant_total_global,
            COALESCE(AVG(montant_total), 0)                                            AS montant_moyen
          FROM smartorder_Orders
        `),

    // ── KPI 2 — Répartition risques ────────────────────────────────────────
    // ROUND(AVG()::numeric) → SQLite n'a pas de cast ::
    pg
      ? db.run(`
          SELECT
            p.risque_label,
            COUNT(*)                              AS nombre,
            ROUND(AVG(p.risque_score)::numeric, 4) AS score_moyen
          FROM smartorder_Predictions p
          JOIN smartorder_Orders o ON o.ID = p.commande_ID
          WHERE o.statut NOT IN ('LIVRE','ANNULE')
          GROUP BY p.risque_label
          ORDER BY score_moyen DESC
        `)
      : db.run(`
          SELECT
            p.risque_label,
            COUNT(*)                        AS nombre,
            ROUND(AVG(p.risque_score), 4)   AS score_moyen
          FROM smartorder_Predictions p
          JOIN smartorder_Orders o ON o.ID = p.commande_ID
          WHERE o.statut NOT IN ('LIVRE','ANNULE')
          GROUP BY p.risque_label
          ORDER BY score_moyen DESC
        `),

    // ── KPI 3 — Évolution mensuelle sur 12 mois ────────────────────────────
    // TO_CHAR → strftime, INTERVAL → datetime offset, FILTER → CASE WHEN
    pg
      ? db.run(`
          SELECT
            TO_CHAR(date_creation, 'YYYY-MM')   AS mois,
            COUNT(*)                             AS nombre_commandes,
            COALESCE(SUM(montant_total), 0)      AS montant_total,
            COUNT(*) FILTER (WHERE date_livraison_reelle > date_previsionnelle
              OR (date_livraison_reelle IS NULL
                  AND date_previsionnelle < CURRENT_DATE
                  AND statut NOT IN ('LIVRE','ANNULE')))              AS retards
          FROM smartorder_Orders
          WHERE date_creation >= NOW() - INTERVAL '12 months'
          GROUP BY TO_CHAR(date_creation, 'YYYY-MM')
          ORDER BY mois ASC
        `)
      : db.run(`
          SELECT
            strftime('%Y-%m', date_creation)    AS mois,
            COUNT(*)                            AS nombre_commandes,
            COALESCE(SUM(montant_total), 0)     AS montant_total,
            SUM(CASE WHEN date_livraison_reelle > date_previsionnelle
                       OR (date_livraison_reelle IS NULL
                           AND date_previsionnelle < date('now')
                           AND statut NOT IN ('LIVRE','ANNULE'))
                     THEN 1 ELSE 0 END)         AS retards
          FROM smartorder_Orders
          WHERE date_creation >= datetime('now', '-12 months')
          GROUP BY strftime('%Y-%m', date_creation)
          ORDER BY mois ASC
        `),

    // ── KPI 4 — Top 5 fournisseurs par volume ─────────────────────────────
    // FILTER → CASE WHEN pour SQLite
    pg
      ? db.run(`
          SELECT
            f.code_sap, f.nom, f.pays,
            f.taux_retard_moyen, f.score_performance,
            COUNT(o.ID)                           AS nombre_commandes,
            COALESCE(SUM(o.montant_total), 0)     AS montant_total,
            COUNT(*) FILTER (WHERE o.statut = 'BLOQUE') AS commandes_bloquees
          FROM smartorder_Fournisseurs f
          LEFT JOIN smartorder_Orders o ON o.fournisseur_ID = f.ID
          GROUP BY f.ID, f.code_sap, f.nom, f.pays,
                   f.taux_retard_moyen, f.score_performance
          ORDER BY nombre_commandes DESC
          LIMIT 5
        `)
      : db.run(`
          SELECT
            f.code_sap, f.nom, f.pays,
            f.taux_retard_moyen, f.score_performance,
            COUNT(o.ID)                                                      AS nombre_commandes,
            COALESCE(SUM(o.montant_total), 0)                                AS montant_total,
            SUM(CASE WHEN o.statut = 'BLOQUE' THEN 1 ELSE 0 END)            AS commandes_bloquees
          FROM smartorder_Fournisseurs f
          LEFT JOIN smartorder_Orders o ON o.fournisseur_ID = f.ID
          GROUP BY f.ID, f.code_sap, f.nom, f.pays,
                   f.taux_retard_moyen, f.score_performance
          ORDER BY nombre_commandes DESC
          LIMIT 5
        `),

    // ── KPI 5 — Durées moyennes de traitement par statut ──────────────────
    // EXTRACT(EPOCH FROM ...) → julianday diff * 86400 en SQLite
    pg
      ? db.run(`
          SELECT
            statut,
            ROUND(AVG(
              EXTRACT(EPOCH FROM (
                COALESCE(date_livraison_reelle, CURRENT_DATE)::timestamp
                - date_creation::timestamp
              )) / 86400
            )::numeric, 2) AS duree_moyenne_jours,
            COUNT(*) AS nombre
          FROM smartorder_Orders
          GROUP BY statut
        `)
      : db.run(`
          SELECT
            statut,
            ROUND(AVG(
              julianday(COALESCE(date_livraison_reelle, date('now')))
              - julianday(date_creation)
            ), 2) AS duree_moyenne_jours,
            COUNT(*) AS nombre
          FROM smartorder_Orders
          GROUP BY statut
        `),
  ]);

  return {
    totaux: totaux[0] || {},
    repartitionRisques,
    evolution12Mois,
    topFournisseurs,
    dureesMoyennes,
    generatedAt: new Date().toISOString(),
  };
}

// ============================================================
// UC11 — Détection d'anomalies
// ============================================================
async function getAnomalies() {
  const db = await getDb();
  const pg = isPostgres();

  const [
    categoriesLentes,
    commandesBloquees,
    fournisseursRisque,
    picsHebdomadaires,
  ] = await Promise.all([

    // ── Anomalie 1 — Catégories avec durée > 1.5× la durée moyenne globale ─
    // DISTINCT ON non supporté par SQLite → GROUP BY + MIN(numero_poste)
    pg
      ? db.run(`
          WITH duree_globale AS (
            SELECT AVG(
              EXTRACT(EPOCH FROM (
                COALESCE(date_livraison_reelle, CURRENT_DATE)::timestamp
                - date_creation::timestamp
              )) / 86400
            ) AS moy_globale
            FROM smartorder_Orders WHERE statut = 'LIVRE'
          ),
          order_categories AS (
            SELECT DISTINCT ON (lc.commande_ID)
              lc.commande_ID, lc.categorie_article
            FROM smartorder_LignesCommande lc
            WHERE lc.categorie_article IS NOT NULL
            ORDER BY lc.commande_ID, lc.numero_poste ASC
          )
          SELECT
            oc.categorie_article,
            COUNT(*)             AS nombre_commandes,
            ROUND(AVG(
              EXTRACT(EPOCH FROM (
                COALESCE(o.date_livraison_reelle, CURRENT_DATE)::timestamp
                - o.date_creation::timestamp
              )) / 86400
            )::numeric, 2)       AS duree_moyenne_jours,
            ROUND(dg.moy_globale::numeric, 2) AS seuil_alerte,
            ROUND((AVG(
              EXTRACT(EPOCH FROM (
                COALESCE(o.date_livraison_reelle, CURRENT_DATE)::timestamp
                - o.date_creation::timestamp
              )) / 86400
            ) / NULLIF(dg.moy_globale, 0))::numeric, 2) AS ratio_vs_moyenne
          FROM smartorder_Orders o
          JOIN order_categories oc ON oc.commande_ID = o.ID
          CROSS JOIN duree_globale dg
          WHERE o.statut IN ('LIVRE', 'EN_COURS', 'EN_LIVRAISON')
          GROUP BY oc.categorie_article, dg.moy_globale
          HAVING AVG(
            EXTRACT(EPOCH FROM (
              COALESCE(o.date_livraison_reelle, CURRENT_DATE)::timestamp
              - o.date_creation::timestamp
            )) / 86400
          ) > 1.5 * dg.moy_globale
          ORDER BY ratio_vs_moyenne DESC
        `)
      : db.run(`
          WITH duree_globale AS (
            SELECT AVG(
              julianday(COALESCE(date_livraison_reelle, date('now')))
              - julianday(date_creation)
            ) AS moy_globale
            FROM smartorder_Orders WHERE statut = 'LIVRE'
          ),
          order_categories AS (
            SELECT lc.commande_ID,
                   lc.categorie_article
            FROM smartorder_LignesCommande lc
            WHERE lc.categorie_article IS NOT NULL
              AND lc.numero_poste = (
                SELECT MIN(l2.numero_poste)
                FROM smartorder_LignesCommande l2
                WHERE l2.commande_ID = lc.commande_ID
                  AND l2.categorie_article IS NOT NULL
              )
          )
          SELECT
            oc.categorie_article,
            COUNT(*)                        AS nombre_commandes,
            ROUND(AVG(
              julianday(COALESCE(o.date_livraison_reelle, date('now')))
              - julianday(o.date_creation)
            ), 2)                           AS duree_moyenne_jours,
            ROUND(dg.moy_globale, 2)        AS seuil_alerte,
            ROUND(AVG(
              julianday(COALESCE(o.date_livraison_reelle, date('now')))
              - julianday(o.date_creation)
            ) / MAX(CASE WHEN dg.moy_globale = 0 THEN NULL ELSE dg.moy_globale END), 2)
                                            AS ratio_vs_moyenne
          FROM smartorder_Orders o
          JOIN order_categories oc ON oc.commande_ID = o.ID
          CROSS JOIN duree_globale dg
          WHERE o.statut IN ('LIVRE', 'EN_COURS', 'EN_LIVRAISON')
          GROUP BY oc.categorie_article, dg.moy_globale
          HAVING AVG(
            julianday(COALESCE(o.date_livraison_reelle, date('now')))
            - julianday(o.date_creation)
          ) > 1.5 * dg.moy_globale
          ORDER BY ratio_vs_moyenne DESC
        `),

    // ── Anomalie 2 — Commandes bloquées depuis > 3 jours ──────────────────
    pg
      ? db.run(`
          SELECT
            o.ID, o.numero_sap, o.urgence, o.montant_total, o.devise,
            f.nom AS fournisseur_nom,
            ROUND(
              EXTRACT(EPOCH FROM (NOW() - o.date_modification::timestamp)) / 86400
            , 1) AS jours_bloques,
            p.risque_label, p.score_composite
          FROM smartorder_Orders o
          JOIN smartorder_Fournisseurs f ON f.ID = o.fournisseur_ID
          LEFT JOIN smartorder_Predictions p ON p.commande_ID = o.ID
          WHERE o.statut = 'BLOQUE'
            AND o.date_modification < NOW() - INTERVAL '3 days'
          ORDER BY jours_bloques DESC
          LIMIT 20
        `)
      : db.run(`
          SELECT
            o.ID, o.numero_sap, o.urgence, o.montant_total, o.devise,
            f.nom AS fournisseur_nom,
            ROUND(julianday('now') - julianday(o.date_modification), 1) AS jours_bloques,
            p.risque_label, p.score_composite
          FROM smartorder_Orders o
          JOIN smartorder_Fournisseurs f ON f.ID = o.fournisseur_ID
          LEFT JOIN smartorder_Predictions p ON p.commande_ID = o.ID
          WHERE o.statut = 'BLOQUE'
            AND o.date_modification < datetime('now', '-3 days')
          ORDER BY jours_bloques DESC
          LIMIT 20
        `),

    // ── Anomalie 3 — Fournisseurs avec taux de retard > 20% ───────────────
    // FILTER → CASE WHEN, TRUE → 1 pour SQLite
    pg
      ? db.run(`
          SELECT
            f.code_sap, f.nom, f.pays,
            f.taux_retard_moyen, f.delai_moyen_jours, f.score_performance,
            COUNT(o.ID) AS commandes_actives,
            COUNT(*) FILTER (WHERE o.statut NOT IN ('LIVRE','ANNULE')
              AND o.date_previsionnelle < CURRENT_DATE) AS retards_actuels
          FROM smartorder_Fournisseurs f
          LEFT JOIN smartorder_Orders o ON o.fournisseur_ID = f.ID
            AND o.statut NOT IN ('ANNULE')
          WHERE f.taux_retard_moyen > 0.20
            AND f.actif = TRUE
          GROUP BY f.ID, f.code_sap, f.nom, f.pays,
                   f.taux_retard_moyen, f.delai_moyen_jours, f.score_performance
          ORDER BY f.taux_retard_moyen DESC
        `)
      : db.run(`
          SELECT
            f.code_sap, f.nom, f.pays,
            f.taux_retard_moyen, f.delai_moyen_jours, f.score_performance,
            COUNT(o.ID)                                                             AS commandes_actives,
            SUM(CASE WHEN o.statut NOT IN ('LIVRE','ANNULE')
                      AND o.date_previsionnelle < date('now') THEN 1 ELSE 0 END)   AS retards_actuels
          FROM smartorder_Fournisseurs f
          LEFT JOIN smartorder_Orders o ON o.fournisseur_ID = f.ID
            AND o.statut NOT IN ('ANNULE')
          WHERE f.taux_retard_moyen > 0.20
            AND f.actif = 1
          GROUP BY f.ID, f.code_sap, f.nom, f.pays,
                   f.taux_retard_moyen, f.delai_moyen_jours, f.score_performance
          ORDER BY f.taux_retard_moyen DESC
        `),

    // ── Anomalie 4 — Pics de volume sur les 4 dernières semaines ──────────
    // DATE_TRUNC → strftime('%Y-%W'), INTERVAL → datetime offset
    pg
      ? db.run(`
          SELECT
            DATE_TRUNC('week', date_creation)  AS semaine,
            COUNT(*)                            AS nombre_commandes,
            COALESCE(SUM(montant_total), 0)     AS montant_total
          FROM smartorder_Orders
          WHERE date_creation >= NOW() - INTERVAL '4 weeks'
          GROUP BY DATE_TRUNC('week', date_creation)
          ORDER BY semaine DESC
        `)
      : db.run(`
          SELECT
            strftime('%Y-W%W', date_creation)  AS semaine,
            COUNT(*)                            AS nombre_commandes,
            COALESCE(SUM(montant_total), 0)     AS montant_total
          FROM smartorder_Orders
          WHERE date_creation >= datetime('now', '-28 days')
          GROUP BY strftime('%Y-W%W', date_creation)
          ORDER BY semaine DESC
        `),
  ]);

  return {
    categoriesLentes,
    commandesBloquees,
    fournisseursRisque,
    picsHebdomadaires,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = { getKPIs, getAnomalies };
