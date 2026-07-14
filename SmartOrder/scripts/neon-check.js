'use strict';

const cds = require('@sap/cds');

const REQUIRED_TABLES = [
  'smartorder_orders',
  'smartorder_fournisseurs',
  'smartorder_alertes',
  'smartorder_predictions',
  'smartorder_utilisateurs',
  'smartorder_lignescommande',
  'smartorder_syncjobs',
  'smartorder_historiquestatut',
  'smartorder_mlmodels',
];

const REQUIRED_SERVICE_RELATIONS = [
  'ordersservice_orders',
  'ordersservice_fournisseurs',
  'ordersservice_alertes',
  'ordersservice_predictions',
  'ordersservice_historiquestatut',
  'ordersservice_utilisateurs',
  'ordersservice_lignescommande',
  'adminservice_utilisateurs',
  'adminservice_historiquestatut',
  'adminservice_orders',
  'adminservice_syncjobs',
  'adminservice_mlmodels',
  'adminservice_lignescommande',
  'adminservice_predictions',
  'adminservice_alertes',
  'analyticsservice_commandesanalytics',
  'profileservice_monprofil',
];

const REQUIRED_COLUMNS = [
  { table: 'smartorder_lignescommande', column: 'unite', minLength: 6 },
  { table: 'smartorder_lignescommande', column: 'categorie_article', minLength: 20 },
  { table: 'smartorder_lignescommande', column: 'designation_produit', minLength: 80 },
  { table: 'smartorder_syncjobs', column: 'duree_ms' },
  { table: 'smartorder_syncjobs', column: 'error_message' },
];

async function main() {
  const db = await cds.connect.to('db');
  const rows = await db.run(`
    SELECT
      current_database() AS database,
      current_schema() AS schema,
      inet_server_addr()::text AS server_addr,
      inet_server_port() AS server_port
  `);

  const dbInfo = rows[0] || {};
  console.log('== Neon/PostgreSQL connection ==');
  console.log(`database=${dbInfo.database || '-'}`);
  console.log(`schema=${dbInfo.schema || '-'}`);
  console.log(`server=${dbInfo.server_addr || '-'}:${dbInfo.server_port || '-'}`);

  const relationRows = await db.run(`
    SELECT table_name, table_type
    FROM information_schema.tables
    WHERE table_schema = current_schema()
    ORDER BY table_name
  `);

  const allRelations = relationRows.map((row) => ({
    name: String(row.table_name),
    type: String(row.table_type),
  }));
  const existing = new Set(allRelations.map((relation) => relation.name.toLowerCase()));
  const missing = REQUIRED_TABLES.filter((table) => !existing.has(table));
  const missingServiceRelations = REQUIRED_SERVICE_RELATIONS.filter((relation) => !existing.has(relation));

  console.log('\n== Relations found in current schema ==');
  if (allRelations.length) {
    for (const relation of allRelations) console.log(`${relation.name} (${relation.type})`);
  } else {
    console.log('(none)');
  }

  console.log('\n== Required SmartOrder tables ==');
  for (const table of REQUIRED_TABLES) {
    console.log(`${existing.has(table) ? 'OK     ' : 'MISSING'} ${table}`);
  }

  if (missing.length) {
    console.error('\nSchema incomplete. Run:');
    console.error('npm run neon:init');
    process.exitCode = 2;
    return;
  }

  console.log('\n== Required CAP service relations ==');
  for (const relation of REQUIRED_SERVICE_RELATIONS) {
    console.log(`${existing.has(relation) ? 'OK     ' : 'MISSING'} ${relation}`);
  }

  if (missingServiceRelations.length) {
    console.error('\nCAP service relations incomplete. Run:');
    console.error('npm run neon:init');
    process.exitCode = 4;
    return;
  }

  const columnRows = await db.run(`
    SELECT table_name, column_name, character_maximum_length
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name IN ('smartorder_lignescommande', 'smartorder_syncjobs')
  `);
  const columnMap = new Map(columnRows.map((row) => [
    `${String(row.table_name).toLowerCase()}.${String(row.column_name).toLowerCase()}`,
    row,
  ]));

  console.log('\n== Required SmartOrder columns ==');
  let invalidColumns = 0;
  for (const requirement of REQUIRED_COLUMNS) {
    const key = `${requirement.table}.${requirement.column}`;
    const row = columnMap.get(key);
    const length = row?.character_maximum_length;
    const ok = row && (!requirement.minLength || Number(length) >= requirement.minLength);
    if (!ok) invalidColumns += 1;
    const suffix = requirement.minLength ? ` length>=${requirement.minLength} actual=${length || '-'}` : '';
    console.log(`${ok ? 'OK     ' : 'INVALID'} ${key}${suffix}`);
  }

  if (invalidColumns) {
    console.error('\nSchema columns incomplete. Run:');
    console.error('npm run neon:init');
    process.exitCode = 3;
    return;
  }

  const counts = [];
  for (const table of REQUIRED_TABLES) {
    const count = await db.run(`SELECT COUNT(*)::int AS count FROM ${table}`);
    counts.push({ table, count: count[0]?.count ?? 0 });
  }

  console.log('\n== Row counts ==');
  for (const row of counts) {
    console.log(`${row.table}=${row.count}`);
  }
}

main().catch((err) => {
  console.error('Neon check failed:', err.message);
  process.exit(1);
});
