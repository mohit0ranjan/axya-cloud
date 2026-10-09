require('dotenv').config({ quiet: true });
const { Client } = require('pg');
const url = new URL(process.env.DATABASE_URL); url.searchParams.set('sslmode', 'verify-full');
const client = new Client({ connectionString: url.toString(), enableChannelBinding: true, connectionTimeoutMillis: 15000 });
(async () => {
  await client.connect();
  const result = await client.query('SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY tablename', ['public']);
  console.log(JSON.stringify({ connected: true, publicTables: result.rows.map(row => row.tablename) }));
  await client.end();
})().catch(async error => { console.error(JSON.stringify({ connected: false, code: error.code || error.name })); await client.end().catch(() => {}); process.exitCode = 1; });
