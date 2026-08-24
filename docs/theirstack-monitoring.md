# TheirStack employer monitoring

The five `THEIRSTACK_API_KEY*` credentials are **not rotation keys**. Each key is assigned to a fixed employer monitor set. The single authoritative mapping is `config/theirstack-monitors.json`; runtime Company Search, targeted profile refreshes, and the entity-sync script all read that same registry.

## Current runtime behavior

1. `scripts/sync-theirstack-monitors.js` inserts any monitored employer missing from `entities` before the daily ingest enumerates entities.
2. The normal authoritative ingest still runs ATS, official career surfaces, USAJOBS / government sources where applicable, and the other verification layers first. TheirStack never replaces the authoritative inventory.
3. The scheduled cron runs one **credit-aware Company Search sweep per TheirStack workspace** before the per-entity ingest loop. It uses `POST /v1/companies/search`, the configured lookback window, and the workspace's remaining API-credit balance.
4. Company Search costs are guarded by `THEIRSTACK_API_CREDIT_RESERVE`. The default cadence is every 14 days with a 20-credit reserve per workspace.
5. Company Search's `num_jobs_found` value is stored as the recent hiring-volume signal. The limited `jobs_found` sample returned with each company is imported only as gap-filling job evidence and is never treated as a complete inventory.
6. Manual **Refresh Intelligence** performs one targeted, credit-guarded Company Search for that employer before the supplemental/enrichment stage. Newly imported TheirStack sample rows can therefore pass through Keenable reconciliation, Clarifai/Groq occupational-health enrichment, snapshots, and final Algolia indexing in the same refresh.
7. Each workspace is persisted separately in Source Coverage as `theirstack_company:<workspace key>`. This preserves intentional cross-key assignments such as Peraton under key 2 and key 3 rather than letting one workspace overwrite the other.
8. Direct ATS, USAJOBS, GovernmentJobs/NEOGOV, and other authoritative/official rows win when TheirStack or Keenable returns the same apply URL.
9. Company Search is **non-destructive**. A partial sample or a zero Company Search signal never closes authoritative jobs and never pretends it enumerated the full employer inventory.
10. The old `POST /v1/jobs/search` full-job connector remains in `lib/ingest/theirStack.ts` for troubleshooting only. It is disabled by default with `THEIRSTACK_LEGACY_JOB_SEARCH_ENABLED=false` because the API charges one API credit per returned job.

## High-volume gap filling

When Company Search reports substantially more jobs than the returned sample, the app records that employer as a high-volume signal. The supported company-credit **Job Search → Export → Webhook** path can then deliver up to the provider's export cap to:

`POST /api/ingest/theirstack/export?token=<THEIRSTACK_EXPORT_WEBHOOK_SECRET>`

The receiver imports only gap-filling rows, deduplicates against stronger sources, never closes jobs from a capped export, rebuilds affected snapshots, and re-syncs Algolia. The receiver exists and is production-wired; initiating the export itself remains dependent on a supported TheirStack export/dataset mechanism and is not faked by replaying undocumented internal App requests.

## Monitor registry

The supplied registry contains 102 key-to-employer assignments and 101 unique employer names. Peraton is intentionally assigned to both key 2 and key 3. The duplicate State of Maryland assignment within key 4 is collapsed.

The monitor registry is currently a checked-in mapping derived from the employer assignments supplied for the five workspaces. TheirStack's supported APIs expose company-list metadata, but the current integration does **not** claim that later edits to saved lists in the TheirStack UI automatically rewrite `config/theirstack-monitors.json`.
