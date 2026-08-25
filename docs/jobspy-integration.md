# JobSpy integration

Hiring Insights uses `ts-jobspy` directly inside the existing Node/Next runtime. It does **not** depend on the older Python/Scrapy batch crawler, a Docker sidecar, MCP transport, or a second Render service.

## Why this architecture

The previous optional career-page crawler lives under `scrapers/` and is a separate Python batch workflow. JobSpy is instead part of `runSupplementalIngest`, so normal scheduled ingest and manual employer refreshes can use it without a separate deployment.

JobSpy is supplemental evidence only. It can add jobs, but it never proves an employer inventory is complete and never closes authoritative ATS/career-page jobs.

## Boards

Only the two boards that the current TypeScript JobSpy project marks as working are enabled:

- Indeed
- LinkedIn

Each board is called independently. A failure, timeout, 403, or 429 on one board cannot discard successful results from the other board or fail the main ingest.

Hiring Insights respects board access controls. A 403/429 causes backoff; the connector does not add proxy rotation or CAPTCHA/access-control bypass behavior.

## When it runs

Default `JOBSPY_MODE=gap` avoids blindly scraping every tracked employer.

A JobSpy check is triggered when either:

1. the employer has fewer than `JOBSPY_MIN_ACTIVE_JOBS` stored active jobs (default 25), or
2. TheirStack Company Search reports a materially larger recent-job signal than the inventory stored in Hiring Insights (default gap ratio 1.25x).

This makes JobSpy most useful for cases such as TheirStack reporting hundreds or thousands of jobs while Company Search only returns five sample rows.

Each board also has a per-entity cadence so repeated manual refreshes do not hammer it. Successful/zero checks default to 24 hours; errors retry after 6 hours.

## Defaults

No API key is required. All settings are optional.

- `JOBSPY_ENABLED=true`
- `JOBSPY_MODE=gap` (`gap`, `always`, `off`)
- `JOBSPY_SITES=indeed,linkedin`
- `JOBSPY_HOURS_OLD=240` (10 days)
- `JOBSPY_RESULTS_WANTED=75` per board
- `JOBSPY_INTERVAL_HOURS=24`
- `JOBSPY_ERROR_RETRY_HOURS=6`
- `JOBSPY_SITE_TIMEOUT_MS=25000`
- `JOBSPY_GAP_RATIO=1.25`
- `JOBSPY_MIN_ACTIVE_JOBS=25`
- `JOBSPY_INDEED_COUNTRY=USA`
- `JOBSPY_LINKEDIN_FETCH_DESCRIPTION=false`

## Employer safety

Search results are not trusted merely because they match a text query. The returned JobSpy `company` value must match the tracked employer or one of its aliases after legal-suffix normalization. Reasonable company-unit prefixes are accepted (for example, `Amentum Services` for `Amentum`). Off-target jobs are rejected before shared quality checks and deduplication.

## Dedupe and authority

JobSpy rows use source names `jobspy:indeed` and `jobspy:linkedin`.

Source priority is deliberately below ATS/official/NLx/Adzuna rows. If the same normalized apply URL already exists from a stronger source, the stronger source remains canonical. The `source_preference()` database helper makes duplicate cleanup deterministic across refreshes.

## Operational visibility

The employer Intelligence Integrations panel exposes JobSpy as `JobSpy Boards`. Individual board results appear in Source Coverage after an attempted check, including employer-rejected counts, elapsed time, trigger context, and errors.
