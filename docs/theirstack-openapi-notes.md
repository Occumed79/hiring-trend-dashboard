# TheirStack OpenAPI notes

Source of truth checked: `https://api.theirstack.com/openapi.json` and `https://theirstack.com/en/docs/api-reference`.

Key integration facts:

- `POST /v1/jobs/search`: 1 API credit per returned job.
- `POST /v1/companies/search`: response field `jobs_found` is documented as the last 5 jobs relevant to the search for each company.
- `GET /v1/datasets`: lists bulk datasets available to the authenticated team and exposes `is_accessible`; Jobs dataset access is the preferred bulk route if enabled.
- `POST /v1/datasets/credentials`: generates temporary read-only S3 credentials for accessible datasets; do not expose or persist those credentials in diagnostics.
- `GET /v0/company_lists`: returns saved-list metadata for the authenticated team.
- `GET /v0/company_lists/{list_id}/companies`: returns the actual company membership of a saved list with pagination. Hiring Insights now uses this supported endpoint to keep monitored employers synchronized with the live TheirStack workspaces.
- `GET /v0/company_lists/{list_id}/companies/export`: deprecated; exports company details only, not jobs.
- `POST /v0/app-urls` with `{ type: "job_search", filters: ... }`: returns a supported deep link that opens the TheirStack app with the supplied Job Search filters applied and runs the search automatically. Hiring Insights uses this for the one-click bulk-export handoff.
- TheirStack's public OpenAPI still does not expose a direct endpoint that initiates the company-credit Job Search export itself. The final **Export → Webhook** confirmation remains inside the TheirStack app.
- `GET /v0/requests/`: returns App/API origin, request URL/body, record counts, status, API credits and UI/company credits, which is useful for diagnostics and for confirming export behavior.
- `job_export_key_or`: documented as an internal export lookup key for materialized job batches. It is observable but should not be treated as a public export-initiation API by itself.
