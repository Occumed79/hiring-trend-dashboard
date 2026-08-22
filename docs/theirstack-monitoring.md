# TheirStack employer monitoring

The five `THEIRSTACK_API_KEY*` credentials are assigned to fixed employer monitor sets in `lib/ingest/theirStackMonitors.ts`.

Runtime behavior:

1. `scripts/sync-theirstack-monitors.js` inserts any monitored employer missing from `entities` before the daily ingest starts.
2. `lib/ingest/theirStack.ts` uses the key assigned to that employer and calls `POST https://api.theirstack.com/v1/jobs/search` with exact case-insensitive company-name matching and `is_closed: false`.
3. TheirStack jobs use source `jobapi:theirstack`, are employer-evidence filtered, normalized, geocoded, deduplicated, and then pass through the existing job upsert/snapshot pipeline.
4. TheirStack is supplemental. Direct ATS, USAJOBS, official government sources, and other authoritative connectors retain higher source priority.
5. `KEENABLE_API_KEY` powers an additional `web:keenable` direct-job discovery source.

Cross-key duplicate employers are intentionally queried with every key to which they are assigned, but only one dashboard entity is created and duplicate jobs are collapsed by normalized apply URL.
