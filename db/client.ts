import { neon } from '@neondatabase/serverless';

// Lazy singleton — only instantiated on first call, never at module load time.
// This prevents Next.js build from failing when DATABASE_URL is not set.
let _sql: ReturnType<typeof neon> | null = null;

function getClient() {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL is not set. Add it to your environment variables.');
    }
    _sql = neon(url);
  }
  return _sql;
}

// Always returns a plain any[] so callers don't need casts
export async function query(text: string, params?: any[]): Promise<any[]> {
  const sql = getClient();
  const result = params && params.length > 0
    ? await sql(text, params)
    : await sql(text);
  return result as any[];
}

export default { query };
