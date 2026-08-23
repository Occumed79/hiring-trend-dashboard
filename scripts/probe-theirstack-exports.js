require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const appUrl = String(process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
const secret = String(process.env.CRON_SECRET || '').trim();

if (!appUrl) {
  console.error('NEXT_PUBLIC_APP_URL is required for TheirStack export discovery.');
  process.exit(1);
}
if (!secret) {
  console.error('CRON_SECRET is required for TheirStack export discovery.');
  process.exit(1);
}

(async () => {
  const response = await fetch(`${appUrl}/api/ingest/theirstack/export-discovery`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-cron-secret': secret,
    },
    body: JSON.stringify({
      lookback_days: Number(process.env.THEIRSTACK_EXPORT_DISCOVERY_LOOKBACK_DAYS || 90),
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    console.error('TheirStack export discovery failed:', payload || response.statusText);
    process.exit(1);
  }

  console.log('[theirstack-export-discovery]', JSON.stringify(payload));
})().catch(error => {
  console.error('TheirStack export discovery probe failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
