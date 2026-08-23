# TheirStack one-time Job Search export → Hiring Insights

This receiver is for the **Job Search → Export → Webhook** delivery path documented by TheirStack. It is intentionally different from saved-search webhooks such as `company.new` / `job.new`, which are continuous API-credit webhooks.

TheirStack documents Job Search exports as company-credit exports, with up to **200 jobs per company per export**. The export UI can deliver results by CSV, Excel, or external webhook.

## Receiver

`POST /api/ingest/theirstack/export?token=<THEIRSTACK_EXPORT_WEBHOOK_SECRET>`

Set this secret only on the `hiring-trend-dashboard` Render web service:

```text
THEIRSTACK_EXPORT_WEBHOOK_SECRET=<long-random-value>
```

Do not reuse a TheirStack API key as the webhook secret.

## Behavior

- accepts JSON exports as a single job, an array of jobs, or common envelope shapes (`jobs`, `data`, `results`, `records`, `items`, `payload`)
- scans nested JSON as a fallback so the first real TheirStack export can establish the exact payload shape without losing the delivery
- matches exported company names to active Hiring Insights entity names/aliases
- imports only gap-filling rows under source `theirstack_export`
- skips an export row when the same apply URL is already active from another source, preserving ATS/official/direct-source authority
- never closes jobs or treats a capped export as a complete inventory
- rebuilds affected hiring snapshots and re-syncs Algolia after successful imports
- does not invoke Clarifai/Groq inline; normal enrichment runs can enrich new export rows later
- stores only the first three redacted job rows plus shape/count metadata in `theirstack_export_receipts` for debugging; the full inbound export body is not retained as a receipt

## Inspect recent receipts

`GET /api/ingest/theirstack/export?token=<THEIRSTACK_EXPORT_WEBHOOK_SECRET>&limit=20`

The response shows detected/imported/unmatched/rejected/duplicate counts and the small redacted sample used to verify the live TheirStack payload contract.

## UI path

The screenshots supplied on 2026-08-22 show a **Company Search**, which generates `POST /v1/companies/search` and a `company.new` saved-search webhook. That is not the bulk-job path.

Use:

1. Open the same search.
2. Switch from **Companies** to **Jobs**.
3. Keep the selected company filter and job age filter.
4. Run the job search.
5. Choose **Export** (not the separate Webhooks action).
6. Select **Webhook** as the export delivery method.
7. Paste the receiver URL above.

The first real export is also useful for confirming the exact delivery shape and company-credit charge in TheirStack request history.
