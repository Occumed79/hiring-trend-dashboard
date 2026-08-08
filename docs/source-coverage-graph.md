# Hiring source coverage graph

Hiring Insights treats hiring coverage as a graph of independent source surfaces rather than one ATS field per entity.

## Source authority

1. **Authoritative** — employer/government-owned ATS, official careers system, USAJOBS organization inventory, authorized NEOGOV/GovernmentJobs, official legislative/judicial/USPS exception sources.
2. **Verified** — NLx and equivalent vetted mirrors, verified official directory discoveries, contractor identity sources.
3. **Supplemental** — association and public-sector boards that must pass employer evidence before contributing jobs.

## Source directories

The existing daily job cron refreshes, without a new service:

- Census Government Units Registry
- NASPE state government job links
- National League of Cities state municipal leagues
- NACo state county associations
- federal exception sources
- discovered association job-board URLs

Directory/enrichment failures do not block the main job ingest.

## Multi-source entities

`entity_job_sources` allows one tracked entity to own multiple independent hiring surfaces. Sources run independently and merge through canonical job deduplication. Shared inventories (statewide boards, municipal/county association boards, intelligence-community aggregations) must pass employer evidence before jobs are accepted.

## Official-site discovery

Verified employer/government sites are inspected for ATS links, `robots.txt`, XML sitemaps and JSON-LD `JobPosting` records. Sitemap ingestion requires structured `JobPosting` data and never creates job titles from URL slugs.

## Contractor identity

USAspending recipient autocomplete is used without credentials. When `SAM_API_KEY` is configured, SAM Entity API v4 contributes legal name, DBA, UEI, CAGE and corporate relationship identifiers. Parent/owner identities are retained as graph metadata and are not automatically promoted into broad employer aliases.

## Lineage and completeness

Coverage scoring is based on expected-source health, authoritative-source health, first-party availability and independent upstream lineages. Identity lookups, generic web discovery and job API mirrors do not inflate independent-lineage counts. CareerOneStop is treated as an NLx resilience mirror and shares the NLx lineage.

The UI displays a compact confidence score, checked/expected source count, healthy authoritative count, independent-lineage count and current source gaps.
