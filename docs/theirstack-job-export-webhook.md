# TheirStack one-time Job Search export → Hiring Insights

This receiver is for the **Job Search → Export → Webhook** delivery path documented by TheirStack. It is intentionally different from saved-search webhooks such as `company.new` / `job.new`, which are continuous API-credit webhooks.

TheirStack documents Job Search exports as company-credit exports, with up to **200 jobs per company per export**. The export UI can deliver results by CSV, Excel, or external webhook.

## Receiver token

Hiring Insights no longer depends on a manually populated Render secret for this workflow.

- If `THEIRSTACK_EXPORT_WEBHOOK_SECRET` exists on the web service, the app uses it.
- Otherwise the app generates a random receiver token and persists it in Neon in `runtime_secrets`.
- The generated token is never committed to GitHub.
- The receiver accepts the token either in the URL query string or the `x-theirstack-export-secret` header.

Receiver shape:

`POST /api/ingest/theirstack/export?token=<receiver-token>`

## One-click handoff

From a monitored employer profile, click **TheirStack Bulk Export**.

Hiring Insights then:

1. resolves the employer's live TheirStack workspace assignment;
2. calls the supported `POST /v0/app-urls` endpoint with `type: job_search` and the employer/open-job/lookback filters;
3. receives a TheirStack app URL that opens and runs that exact Job Search;
4. builds the authenticated Hiring Insights export receiver URL;
5. copies the receiver URL to the clipboard; and
6. opens TheirStack in a new tab on the prepared Job Search.

The only remaining provider-side action is **Export → Webhook → paste**. TheirStack's public OpenAPI does not expose an endpoint that directly confirms/initiates the company-credit Job Search export, so Hiring Insights does not replay undocumented internal app requests to fake that final click.

## Receiver behavior

- accepts JSON exports as a single job, an array of jobs, or common envelope shapes (`jobs`, `data`, `results`, `records`, `items`, `payload`)
- scans nested JSON as a fallback so the first real TheirStack export can establish the exact payload shape without losing the delivery
- matches exported company names to active Hiring Insights entity names/aliases, including common legal-suffix variants
- imports only gap-filling rows under source `theirstack_export`
- skips an export row when the same apply URL is already active from another source, preserving ATS/official/direct-source authority
- persists the export as supplemental Source Coverage evidence
- never closes jobs or treats a capped export as a complete inventory
- rebuilds affected hiring snapshots and re-syncs Algolia after successful imports
- does not invoke Clarifai/Groq inline; normal enrichment runs can enrich new export rows later
- stores only the first three redacted job rows plus shape/count metadata in `theirstack_export_receipts` for debugging; the full inbound export body is not retained as a receipt

## Inspect recent receipts

`GET /api/ingest/theirstack/export?token=<receiver-token>&limit=20`

The response shows detected/imported/unmatched/rejected/duplicate counts and the small redacted sample used to verify the live TheirStack payload contract.
