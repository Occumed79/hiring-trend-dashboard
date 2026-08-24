import { randomBytes, timingSafeEqual } from 'crypto';
import { query } from '@/db/client';

const SECRET_NAME = 'theirstack_export_webhook';

export async function getTheirStackExportSecret() {
  const configured = String(process.env.THEIRSTACK_EXPORT_WEBHOOK_SECRET || '').trim();
  if (configured) return { secret: configured, source: 'environment' as const };

  await ensureSecretTable();
  const candidate = randomBytes(32).toString('hex');
  await query(
    `INSERT INTO runtime_secrets (name, secret_value, created_at, updated_at)
     VALUES ($1,$2,NOW(),NOW())
     ON CONFLICT (name) DO NOTHING`,
    [SECRET_NAME, candidate],
  );
  const rows = await query(`SELECT secret_value FROM runtime_secrets WHERE name=$1 LIMIT 1`, [SECRET_NAME]);
  const secret = String(rows[0]?.secret_value || '').trim();
  if (!secret) throw new Error('Could not provision TheirStack export receiver token.');
  return { secret, source: 'database_runtime' as const };
}

export async function verifyTheirStackExportSecret(candidate: unknown) {
  const supplied = String(candidate || '').trim();
  if (!supplied) return false;
  const state = await getTheirStackExportSecret();
  return safeEqual(supplied, state.secret);
}

async function ensureSecretTable() {
  await query(`CREATE TABLE IF NOT EXISTS runtime_secrets (
    name TEXT PRIMARY KEY,
    secret_value TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
