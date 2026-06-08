require('dotenv').config({ path: '.env.local' });
const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

async function migrate() {
  const sql = neon(process.env.DATABASE_URL);
  const schemaPath = path.join(__dirname, '../db/schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  
  console.log('Running migrations...');
  try {
    // Split by statement and run each
    const statements = schema.split(';').filter(s => s.trim().length > 0);
    for (const statement of statements) {
      await sql(statement);
    }
    console.log('✅ Migrations complete');
  } catch (err) {
    console.error('❌ Migration error:', err);
    process.exit(1);
  }
}

migrate();
