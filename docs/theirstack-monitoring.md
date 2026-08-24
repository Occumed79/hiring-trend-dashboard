# TheirStack employer monitoring

The five `THEIRSTACK_API_KEY*` credentials are **not rotation keys**. Each key maps to its own TheirStack workspace. `config/theirstack-monitors.json` is now the bootstrap/fallback registry; live runtime monitoring prefers the actual saved-list membership discovered from TheirStack and persisted in Neon.

## Live saved-list synchronization

TheirStack's supported API now exposes both list metadata and list membership:

- `GET /v0/company_lists`
- `GET /v0/company_lists/{list_id}/companies`

Before the daily ingest enumerates entities, `scripts/sync-theirstack-monitors.js` now:

1. Reads the company lists available to each configured TheirStack key.
2. Excludes system/history lists such as `REVEALED_COMPANIES` and `EXPORT_SNAPSHOT`.
3. Compares candidate list membership with the bootstrap employer set for that workspace and selects the strongest safe overlap. This avoids accidentally adopting a broad unrelated list.
4. Persists the selected live membership in `theirstack_monitor_assignments` and the per-workspace sync state in `theirstack_monitor_sync_state`.
5. Inserts or reactivates newly monitored employers in `entities` so new saved-list additions can enter the normal Hiring Insights ingest automatically.
6. Marks removed live-list assignments inactive without deleting the dashboard entity or its historical hiring data.
7. Falls back to the checked-in bootstrap registry if the key is missing, TheirStack is unavailable, or no safe live list can be identified.

Runtime Company Search sweeps and manual profile refreshes call `loadTheirStackMonitors()` / `monitorsForEntityLive()`, so they use the live saved-list assignment table when it exists rather than remaining frozen to the JSON file.

Optional explicit overrides are supported with `THEIRSTACK_MONITOR_LIST_ID`, `THEIRSTACK_MONITOR_LIST_ID_2`, ... `THEIRSTACK_MONITOR_LIST_ID_5` if a workspace ever contains multiple highly overlapping custom lists and automatic selection needs to be pinned.

## Current runtime behavior

1. The normal authoritative ingest still runs ATS, official career surfaces, USAJOBS / government sources where applicable, and the other verification layers first. TheirStack never replaces the authoritative inventory.
2. The scheduled cron runs one **credit-aware Company Search sweep per TheirStack workspace** before the per-entity ingest loop. It uses `POST /v1/companies/search`, the configured lookback window, and the workspace's remaining API-credit balance.
3. Company Search costs are guarded by `THEIRSTACK_API_CREDIT_RESERVE`. The default cadence is every 14 days with a 20-credit reserve per workspace.
4. Company Search's `num_jobs_found` value is stored as the recent hiring-volume signal. The limited `jobs_found` sample returned with each company is imported only as gap-filling job evidence and is never treated as a complete inventory.
5. Manual **Refresh Intelligence** performs one targeted, credit-guarded Company Search for that employer before the supplemental/enrichment stage. Newly imported TheirStack sample rows can therefore pass through Keenable reconciliation, Clarifai/Groq occupational-health enrichment, snapshots, and final Algolia indexing in the same refresh.
6. Each workspace is persisted separately in Source Coverage as `theirstack_company:<workspace key>`. This preserves intentional cross-key assignments such as Peraton under key 2 and key 3 rather than letting one workspace overwrite the other.
7. Direct ATS, USAJOBS, GovernmentJobs/NEOGOV, and other authoritative/official rows win when TheirStack or Keenable returns the same apply URL.
8. Company Search is **non-destructive**. A partial sample or a zero Company Search signal never closes authoritative jobs and never pretends it enumerated the full employer inventory.
9. The old `POST /v1/jobs/search` full-job connector remains in `lib/ingest/theirStack.ts` for troubleshooting only. It is disabled by default with `THEIRSTACK_LEGACY_JOB_SEARCH_ENABLED=false` because the API charges one API credit per returned job.

## High-volume gap filling

TheirStack documents one-time Job Search exports as company-credit exports, capped at 200 jobs per company per export. Their public API still does not expose a `POST` endpoint that directly initiates that export, but it **does** expose `POST /v0/app-urls` for opening an exact prefiltered Job Search in the TheirStack app.

Hiring Insights now uses that supported App URL endpoint for a one-click handoff from an entity profile:

1. Click **TheirStack Bulk Export**.
2. Hiring Insights requests a TheirStack `job_search` App URL using the monitored employer, open-job filter, and configured lookback window.
3. Hiring Insights copies its export receiver URL to the clipboard.
4. TheirStack opens directly on the correct Job Search.
5. Choose **Export → Webhook** and paste. TheirStack delivers the company-credit export back into Hiring Insights.

Receiver:

`POST /api/ingest/theirstack/export?token=<THEIRSTACK_EXPORT_WEBHOOK_SECRET>`

The receiver imports only gap-filling rows, deduplicates against stronger sources, never closes jobs from a capped export, rebuilds affected snapshots, and re-syncs Algolia. This is the maximum supported automation boundary without replaying undocumented internal App export requests.

## Bootstrap registry

The checked-in bootstrap registry contains the original 102 key-to-employer assignments and 101 unique employer names. Peraton is intentionally assigned to both key 2 and key 3. It remains useful for first deploys, outage fallback, and safe live-list discovery, but it is no longer the runtime source of truth after a successful saved-list sync.
