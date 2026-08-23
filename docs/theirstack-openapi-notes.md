# TheirStack OpenAPI notes

Source of truth checked: `https://api.theirstack.com/openapi.json` and `https://theirstack.com/en/docs/api-reference`.

Key integration facts:

- `POST /v1/jobs/search`: 1 API credit per returned job.
- `POST /v1/companies/search`: response field `jobs_found` is documented as the last 5 jobs relevant to the search for each company.
- `GET /v1/datasets`: lists bulk datasets available to the authenticated team and exposes `is_accessible`; Jobs dataset access is the preferred bulk route if enabled.
- `POST /v1/datasets/credentials`: generates temporary read-only S3 credentials for accessible datasets; do not expose or persist those credentials in diagnostics.
- `GET /v0/company_lists`: returns list metadata, including list types such as `REVEALED_COMPANIES` and `EXPORT_SNAPSHOT`.
- `GET /v0/company_lists/{list_id}/companies/export`: deprecated; exports company details only, not jobs.
- `GET /v0/requests/`: returns App/API origin, request URL/body, record counts, status, API credits and UI/company credits, which is useful for discovering how the App performs exports.
- `job_export_key_or`: documented as an internal export lookup key for materialized job batches. It is observable but should not be treated as a public export API by itself.
