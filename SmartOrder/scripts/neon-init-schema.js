'use strict';

const fs = require('fs');
const path = require('path');
const cds = require('@sap/cds');

const ROOT = path.resolve(__dirname, '..');
const RESET = process.argv.includes('--reset');

const SEED_FILES = [
  { table: 'smartorder_Fournisseurs', file: 'smartorder-Fournisseurs.csv' },
  { table: 'smartorder_Utilisateurs', file: 'smartorder-Utilisateurs.csv' },
  { table: 'smartorder_Orders', file: 'smartorder-Orders.csv' },
  { table: 'smartorder_LignesCommande', file: 'smartorder-LignesCommande.csv' },
  { table: 'smartorder_Predictions', file: 'smartorder-Predictions.csv' },
  { table: 'smartorder_Alertes', file: 'smartorder-Alertes.csv' },
  { table: 'smartorder_HistoriqueStatut', file: 'smartorder-HistoriqueStatut.csv' },
  { table: 'smartorder_SyncJobs', file: 'smartorder-SyncJobs.csv' },
  { table: 'smartorder_MlModels', file: 'smartorder-MlModels.csv' },
];

const DROP_TABLES = [
  'smartorder_Alertes',
  'smartorder_Predictions',
  'smartorder_HistoriqueStatut',
  'smartorder_LignesCommande',
  'smartorder_SyncJobs',
  'smartorder_MlModels',
  'smartorder_Orders',
  'smartorder_Utilisateurs',
  'smartorder_Fournisseurs',
];

const SERVICE_VIEWS = [
  { name: 'ordersservice_orders', source: 'smartorder_Orders' },
  { name: 'ordersservice_fournisseurs', source: 'smartorder_Fournisseurs' },
  { name: 'ordersservice_predictions', source: 'smartorder_Predictions' },
  { name: 'ordersservice_alertes', source: 'smartorder_Alertes' },
  { name: 'ordersservice_historiquestatut', source: 'smartorder_HistoriqueStatut' },
  { name: 'ordersservice_utilisateurs', source: 'smartorder_Utilisateurs' },
  { name: 'ordersservice_lignescommande', source: 'smartorder_LignesCommande' },
  { name: 'adminservice_utilisateurs', source: 'smartorder_Utilisateurs' },
  { name: 'adminservice_historiquestatut', source: 'smartorder_HistoriqueStatut' },
  { name: 'adminservice_orders', source: 'smartorder_Orders' },
  { name: 'adminservice_syncjobs', source: 'smartorder_SyncJobs' },
  { name: 'adminservice_mlmodels', source: 'smartorder_MlModels' },
  { name: 'adminservice_lignescommande', source: 'smartorder_LignesCommande' },
  { name: 'adminservice_predictions', source: 'smartorder_Predictions' },
  { name: 'adminservice_alertes', source: 'smartorder_Alertes' },
  { name: 'profileservice_monprofil', source: 'smartorder_Utilisateurs' },
];

function splitSqlStatements(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      value += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(value);
      value = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(value);
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
      value = '';
      continue;
    }

    value += char;
  }

  if (value || row.length) {
    row.push(value);
    if (row.some((cell) => cell !== '')) rows.push(row);
  }

  if (!rows.length) return [];
  const [headers, ...data] = rows;
  return data.map((cells) => {
    const record = {};
    headers.forEach((header, index) => {
      const raw = cells[index] ?? '';
      record[header] = raw === '' ? null : raw;
    });
    return record;
  });
}

async function postgresCreateStatements() {
  const csn = await cds.load(path.join(ROOT, 'db', 'schema.cds'));
  const sql = cds.compile.to.sql(csn, { dialect: 'postgres' }).join('\n');
  return splitSqlStatements(sql).map((statement) => (
    statement.replace(/^CREATE TABLE\s+/i, 'CREATE TABLE IF NOT EXISTS ')
  ));
}

async function applyNonDestructiveMigrations(db) {
  const statements = [
    'ALTER TABLE smartorder_LignesCommande ALTER COLUMN unite TYPE varchar(6)',
    'ALTER TABLE smartorder_LignesCommande ALTER COLUMN categorie_article TYPE varchar(20)',
    'ALTER TABLE smartorder_LignesCommande ALTER COLUMN designation_produit TYPE varchar(80)',
    'ALTER TABLE smartorder_SyncJobs ADD COLUMN IF NOT EXISTS duree_ms integer',
    'ALTER TABLE smartorder_SyncJobs ADD COLUMN IF NOT EXISTS error_message text',
  ];

  console.log('Applying non-destructive schema migrations...');
  for (const statement of statements) {
    await db.run(statement);
  }
}

async function createServiceCompatibilityViews(db) {
  console.log('Creating CAP service compatibility views...');
  for (const view of SERVICE_VIEWS) {
    await db.run(`DROP VIEW IF EXISTS ${view.name} CASCADE`);
    await db.run(`CREATE VIEW ${view.name} AS SELECT * FROM ${view.source}`);
  }

  await db.run('DROP VIEW IF EXISTS analyticsservice_commandesanalytics CASCADE');
  await db.run(`
    CREATE VIEW analyticsservice_commandesanalytics AS
      SELECT
        o.ID,
        o.numero_sap,
        o.statut,
        o.urgence,
        o.montant_total,
        o.devise,
        o.date_creation,
        o.date_commande,
        o.date_previsionnelle,
        o.date_livraison_reelle,
        o.score_priorite,
        o.statut_approbation,
        o.postes_en_retard,
        f.nom AS fournisseur_nom,
        f.taux_retard_moyen,
        f.score_performance,
        p.risque_label,
        p.risque_score,
        p.score_composite,
        p.priorite_action
      FROM smartorder_Orders o
      LEFT JOIN smartorder_Fournisseurs f ON f.ID = o.fournisseur_ID
      LEFT JOIN smartorder_Predictions p ON p.commande_ID = o.ID
  `);
}

async function upsertCsv(db, table, file) {
  const csvPath = path.join(ROOT, 'db', 'data', file);
  const records = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  if (!records.length) {
    console.log(`seed ${table}: 0 row`);
    return;
  }

  const columns = Object.keys(records[0]);
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
  const updates = columns
    .filter((column) => column.toLowerCase() !== 'id')
    .map((column) => `${column} = EXCLUDED.${column}`)
    .join(', ');
  const sql = `
    INSERT INTO ${table} (${columns.join(', ')})
    VALUES (${placeholders})
    ON CONFLICT (ID) DO UPDATE SET ${updates}
  `;

  for (const record of records) {
    const values = columns.map((column) => record[column]);
    await db.run(sql, values);
  }

  console.log(`seed ${table}: ${records.length} row(s)`);
}

async function main() {
  const db = await cds.connect.to('db');
  const info = await db.run(`
    SELECT current_database() AS database, current_schema() AS schema,
           inet_server_addr()::text AS server_addr, inet_server_port() AS server_port
  `);
  const target = info[0] || {};
  console.log(`Neon target: database=${target.database} schema=${target.schema} server=${target.server_addr}:${target.server_port}`);

  if (RESET) {
    console.log('Reset requested: dropping SmartOrder tables...');
    for (const table of DROP_TABLES) {
      await db.run(`DROP TABLE IF EXISTS ${table} CASCADE`);
    }
  }

  console.log('Creating SmartOrder tables...');
  for (const statement of await postgresCreateStatements()) {
    await db.run(statement);
  }
  await applyNonDestructiveMigrations(db);
  await createServiceCompatibilityViews(db);

  console.log('Loading CSV seed data...');
  for (const seed of SEED_FILES) {
    await upsertCsv(db, seed.table, seed.file);
  }

  console.log('Neon schema initialization completed.');
}

main().catch((err) => {
  console.error('Neon schema initialization failed:', err);
  process.exit(1);
});
