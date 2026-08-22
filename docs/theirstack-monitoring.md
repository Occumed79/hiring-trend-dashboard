# TheirStack employer monitoring

The five `THEIRSTACK_API_KEY*` credentials are **not rotation keys**. Each key is assigned to a fixed employer monitor set. The single authoritative mapping is `config/theirstack-monitors.json`; both runtime ingestion and the entity-sync script read that same registry.

Runtime behavior:

1. `scripts/sync-theirstack-monitors.js` inserts any monitored employer missing from `entities` before the daily ingest enumerates entities.
2. The normal protected `/api/ingest` flow runs the existing authoritative source stack and then `runSupplementalIngest`, so scheduled and API-triggered refreshes both include TheirStack + Keenable.
3. Manual entity refreshes also run the same supplemental pipeline.
4. `lib/ingest/theirStack.ts` uses only the key assigned to that employer and calls `POST https://api.theirstack.com/v1/jobs/search` with exact company-name filters and `is_closed: false`.
5. TheirStack jobs use source `jobapi:theirstack`; Keenable uses `web:keenable`. Both pass through employer-evidence filtering, quality checks, normalization, geocoding, role classification, upsert, dedupe, and snapshots.
6. Direct ATS, USAJOBS, and official government rows win when a supplemental source returns the same apply URL.
7. TheirStack open-inventory reconciliation only closes missing TheirStack jobs when every assigned key for that employer completed successfully; key/API failures do not trigger destructive reconciliation.
8. Supplemental health is persisted in Source Coverage rather than replacing the core ingest log shown by the UI.

Cross-key duplicate employers are intentionally queried with every key to which they are assigned, but only one dashboard entity is created. Peraton is intentionally assigned to both key 2 and key 3. The duplicate State of Maryland entry supplied within key 4 is collapsed to one assignment.
