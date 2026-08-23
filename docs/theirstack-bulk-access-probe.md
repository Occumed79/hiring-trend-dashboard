# TheirStack bulk-access probe

This repository treats TheirStack as a supplemental source. The free-tier REST Job Search endpoint is not a practical way to mirror large employer inventories because it charges 1 API credit per returned job.

The automatic export-discovery probe now checks the supported account surfaces that can reveal a better bulk path without consuming job-search credits:

- `GET /v0/requests/` for App-origin request history and credit attribution.
- `GET /v0/billing/credit-balance` for API/company credit balances.
- `GET /v1/datasets` for bulk Jobs dataset availability. If the Jobs dataset reports `is_accessible=true`, it is the preferred supported bulk-ingestion path.
- `GET /v0/company_lists` for revealed-company lists and `EXPORT_SNAPSHOT` artifacts.

Important documented limits:

- Company Search `jobs_found` contains only the last 5 relevant jobs per company, so it is not a bulk-job replacement.
- The deprecated company-list export endpoint exports company details, not job records.
- Job Search remains 1 API credit per returned job.
- `job_export_key_or` is an internal lookup filter for materialized job batches; the probe may observe it in App request history but does not replay it automatically.

The probe is read-only, redacts secret-like values, does not return dataset signed URLs/storage prefixes, and cannot block normal hiring ingestion.
