# Hiring Trend Dashboard

Real-time hiring intelligence dashboard for tracking job trends across clients, prospects, private companies, federal agencies, state agencies, and city/municipal agencies.

## Stack
- **Frontend**: Next.js 14, React, Tailwind CSS, Recharts, Leaflet
- **Backend**: Next.js API Routes
- **Database**: Neon Postgres with PostGIS
- **Deployment**: Render (web + cron)

## Data Sources
- Greenhouse Job Board API (public ATS)
- Lever Postings API (public ATS)
- Adzuna API (job counts + regional trends)
- USAJOBS API (federal/government hiring)
- Optional career-page crawler sidecar for pages that do not expose a clean ATS/API feed

## Quick Start

### 1. Set up Neon Database
1. Create a project at [neon.tech](https://neon.tech)
2. Copy your connection string
3. Enable PostGIS: run `CREATE EXTENSION IF NOT EXISTS postgis;` in the Neon SQL editor

### 2. Get API Keys
- **Adzuna**: Register at [developer.adzuna.com](https://developer.adzuna.com) — free tier available
- **USAJOBS**: Register at [developer.usajobs.gov](https://developer.usajobs.gov)

### 3. Configure environment
```bash
cp .env.example .env.local
# Fill in your values
```

### 4. Run migrations
```bash
npm run db:migrate
```

### 5. Start development
```bash
npm install
npm run dev
```

### 6. Trigger initial ingest
```bash
# With the app running:
curl -X POST http://localhost:3000/api/ingest \
  -H "x-cron-secret: YOUR_CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{}'
```

## Optional Career-Page Crawler

For companies/agencies where the normal ATS/API ingest returns too little, use the optional crawler sidecar instead of burning paid/rate-limited job API quota. This is additive and does not remove or bypass the existing ingest flow.

```bash
python3 -m venv .venv-crawler
source .venv-crawler/bin/activate
pip install -r scrapers/requirements.txt

cd scrapers
scrapy crawl career_pages \
  -a start_url=https://example.com/careers \
  -a entity="Example Company" \
  -O output/example-company.jsonl

cd ..
npm run import:crawler -- --entity-id=ENTITY_UUID --file=scrapers/output/example-company.jsonl
```

For quick one-off selector checks, use the included `scrapy runspider` example:

```bash
scrapy runspider scrapers/examples/runspider_career_page.py \
  -a start_url=https://example.com/careers \
  -a entity="Example Company" \
  -O scrapers/output/runspider-example.jsonl
```

For multiple configured targets, use the Scrapy API batch runner:

```bash
npm run crawler:batch -- \
  --config scrapers/examples/targets.example.json \
  --output scrapers/output/career-pages-batch.jsonl
```

See [`docs/career-crawler-sidecar.md`](docs/career-crawler-sidecar.md) for usage details and guardrails.

## Deployment on Render

1. Push to GitHub
2. Connect repo in Render dashboard
3. Render will detect `render.yaml` and create both the web service and daily cron job
4. Add all environment variables in Render settings

## Adding Entities

Use the **+** button in any portal to add a new entity. Fields:
- **Name** (required)
- **Known Aliases** (comma separated)
- **Career Page URL** (manual entry — required)
- **ATS Provider** + Board ID (for Greenhouse/Lever auto-ingestion)
- **Industry/Category**

Hiring data ingestion starts automatically after adding.

## Portal Types
| Portal | Description |
|--------|-------------|
| Current Clients | Active paying clients |
| Prospects | Sales pipeline targets |
| Private Companies | General market intelligence |
| Federal Agencies | Federal government hiring (USAJOBS + Adzuna) |
| State Agencies | State-level government entities |
| City & Municipal Agencies | Local government and municipalities |
