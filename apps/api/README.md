# API - Global Tension Map

## 1) Start Postgres + PostGIS

From repository root:

```bash
docker compose up -d
```

## 2) Configure API env

Copy `.env.example` to `.env` in `apps/api` and adjust values if needed.

## 3) Run API

From repository root:

```bash
npm run dev:api
```

## 4) Ingest real data from GDELT

```bash
npm --prefix apps/api run ingest:gdelt
```

## 5) Ingest ACLED

Requires `ACLED_API_KEY` and `ACLED_EMAIL`.

```bash
npm --prefix apps/api run ingest:acled
```

## 6) Ingest live news

Requires `NEWS_API_KEY` or `GNEWS_API_KEY`.
Optional AI extraction uses `OPENAI_API_KEY`.

```bash
npm --prefix apps/api run ingest:news
```

## 7) Ingest all sources

```bash
npm --prefix apps/api run ingest:all
```

## Endpoints

- `GET /health`
- `GET /events?page=1&limit=200&type=war&country=iran&days=7&source=news&bbox=-10,35,40,60`
- `GET /events/top?limit=10&days=7`
- `GET /countries`
- `GET /metrics/summary`
- `POST /admin/ingest` with `x-admin-token: <ADMIN_INGEST_TOKEN>`

## Runtime Activation Checklist (Phase 5)

1. Create `apps/api/.env` from `.env.example`
2. Set real values for:
	- `DATABASE_URL`
	- `NEWS_API_KEY` or `GNEWS_API_KEY`
	- `OPENAI_API_KEY`
	- `ACLED_API_KEY` and `ACLED_EMAIL`
3. Initialize schema:

```bash
psql $DATABASE_URL -f apps/api/db/init.sql
```

4. Trigger ingestion:

```bash
npm --prefix apps/api run ingest:all
```

5. Validate data quality:

```sql
SELECT source, COUNT(*) FROM events GROUP BY source;
SELECT * FROM events ORDER BY date DESC LIMIT 20;
SELECT COUNT(*) FROM events WHERE geom IS NULL;
```

6. Trigger protected admin ingestion:

```bash
curl -X POST http://localhost:4000/admin/ingest \
	-H "Authorization: Bearer <ADMIN_INGEST_TOKEN>"
```

7. Validate runtime metrics:

```bash
curl http://localhost:4000/metrics/summary
```

## Notes

- If `DATABASE_URL` is missing, API falls back to local mock JSON for MVP continuity.
- Country scores are cached in `country_scores` and refreshed every 5 minutes when DB is configured.
- News ingestion can run automatically every 5 minutes when `ENABLE_NEWS_INGEST_CRON=true`.
- Admin manual ingestion endpoint is rate-limited via `ADMIN_INGEST_COOLDOWN_SECONDS`.
- Runtime tuning variables: `NEWS_MAX_AGE_HOURS`, `MAX_NEWS_AGE_HOURS`, `GDELT_MAX_AGE_HOURS`, `ACLED_MAX_AGE_HOURS`, `MIN_EVENT_CONFIDENCE`, `SPIKE_THRESHOLD_MULTIPLIER`.
