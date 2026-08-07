require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function migrate() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set. Add it to .env.local or the service environment.');
    process.exit(1);
  }

  const files = [
    path.join(__dirname, '../db/schema.sql'),
    path.join(__dirname, '../db/hardening.sql'),
  ];
  const client = new Client({
    connectionString,
    ssl: connectionString.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
  });

  console.log('Running migrations...');
  try {
    await client.connect();
    for (const file of files) {
      if (!fs.existsSync(file)) continue;
      console.log(`Applying ${path.basename(file)}...`);
      await client.query(fs.readFileSync(file, 'utf8'));
    }
    console.log('Migrations complete');
  } catch (err) {
    console.error('Migration error:', err);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

migrate();
