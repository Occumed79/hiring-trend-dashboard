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
