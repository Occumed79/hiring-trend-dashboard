# Optional Career Page Crawler Sidecar

This repo already prioritizes structured sources first: direct ATS connectors, portal-specific sources, Adzuna, USAJOBS, and rate-limited job API adapters. The crawler sidecar is for the annoying middle category: career pages that clearly list jobs but do not expose a clean Greenhouse, Lever, SmartRecruiters, BambooHR, USAJOBS, or configured API feed.

The goal is not to replace APIs. The goal is to preserve API quota by giving the dashboard a manual/offline fallback for hard career pages.

## What this adds

- A small Scrapy project under `scrapers/`.
- A generic `career_pages` spider that extracts:
  - JobPosting JSON-LD
  - job/career/opening links
  - detail-page-friendly fields such as title, location, city, state, country, remote/overseas flags, URL, parser metadata
- A Node importer that reads the crawler JSONL export and upserts rows into the existing `jobs` table.
- A `runspider` example for quick one-file checks.
- A batch runner that uses Scrapy's crawler API for multiple configured targets.
- A JSONL stats extension and item uniqueness pipeline for easier debugging and cleaner exports.

## Install crawler dependencies

From the repo root:

```bash
python3 -m venv .venv-crawler
source .venv-crawler/bin/activate
pip install -r scrapers/requirements.txt
```

## Run the crawler

Run from the `scrapers/` directory so Scrapy can find `scrapy.cfg`:

```bash
cd scrapers
scrapy crawl career_pages \
  -a start_url=https://example.com/careers \
  -a entity="Example Company" \
  -a max_pages=150 \
  -O output/example-company.jsonl
```

You can also pass multiple entry points:

```bash
scrapy crawl career_pages \
  -a start_urls=https://example.com/careers,https://example.com/jobs \
  -a entity="Example Company" \
  -O output/example-company.jsonl
```

## Quick runspider check

For a fast one-file check without relying on the Scrapy project loader:

```bash
scrapy runspider scrapers/examples/runspider_career_page.py \
  -a start_url=https://example.com/careers \
  -a entity="Example Company" \
  -O scrapers/output/runspider-example.jsonl
```

This is useful when debugging selectors or quickly proving whether a page exposes JSON-LD or parseable job links.

## Batch crawler run

Create a config based on `scrapers/examples/targets.example.json`, then run:

```bash
npm run crawler:batch -- \
  --config scrapers/examples/targets.example.json \
  --output scrapers/output/career-pages-batch.jsonl \
  --stats-file scrapers/output/crawler-stats.jsonl
```

The batch runner uses Scrapy's `CrawlerProcess` API so multiple configured targets can be scheduled in one command while keeping output in JSON Lines format.

## Import crawler output into Neon

Use the dashboard entity UUID from the `entities` table:

```bash
npm run import:crawler -- --entity-id=ENTITY_UUID --file=scrapers/output/example-company.jsonl
```

The importer writes to the existing `jobs` table and records an `ingest_log` entry with source `crawler:career_page`.

## Crawl controls and stats

The Scrapy settings intentionally stay conservative:

- `ROBOTSTXT_OBEY = True`
- per-domain concurrency is capped
- AutoThrottle is enabled
- HTTP cache is enabled
- depth is limited
- duplicate crawler items are filtered before export
- finished crawl stats are written to JSONL

The stats file helps answer questions like how many requests ran, how many items were scraped, whether pages were filtered, and why a spider closed.

## When to use this

Use the sidecar when:

- a company has a career page URL but the normal ingest finds zero jobs;
- a page blocks or hides useful data from simple HTML parsing;
- the paid/rate-limited job APIs should be conserved;
- a target has static job links or JSON-LD but no clean official API.

Do not use it for every entity by default. It is deliberately optional so the dashboard can keep daily ingestion cheap and predictable.

## Existing ingest stays intact

This sidecar is additive. It does not remove or bypass the current app ingest order:

1. direct ATS connectors
2. portal-specific sources
3. Adzuna where configured
4. government fallback sources where configured
5. paid/rate-limited jobs API fallback according to `JOB_API_MODE`
6. manual/offline crawler JSONL import only when explicitly run

## Notes for future hardening

- Add entity-specific spiders for high-value targets with unusual HTML.
- Keep `ROBOTSTXT_OBEY = True` unless there is a deliberate policy decision to change it.
- Prefer `-O` for one-off exports because it overwrites stale output; use `-o` only when intentionally appending JSONL.
- If a spider starts producing duplicates, use the `external_id`, `source`, and URL metadata to tighten deduplication.
