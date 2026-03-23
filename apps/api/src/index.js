import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dbHealth, dbQuery, isDbConfigured } from "./db.js";
import { listEvents as listEventsFromDb } from "./repositories/eventsRepository.js";
import {
  listCountryScoresCached,
  refreshCountryScoresCache,
} from "./repositories/countryScoresRepository.js";
import { computeCountryScoresInMemory } from "./services/scoring.js";
import { ingestNews } from "./workers/ingestNews.js";
import { ingestAllSources } from "./workers/ingestAllSources.js";

const app = express();
const port = process.env.PORT || 4000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const mockEventsPath = path.join(__dirname, "data", "mock-events.json");

const WEIGHTS = {
  war: 10,
  attack: 9,
  conflict: 8,
  sanction: 6,
  protest: 4,
  tension: 3,
  politic: 1,
};

app.use(cors());
app.use(express.json());

const withDefaults = (event) => ({
  ...event,
  weight: Number.isFinite(event.weight) ? event.weight : WEIGHTS[event.type] || 1,
  confidence: Number.isFinite(event.confidence) ? event.confidence : 0.6,
  source: event.source || "gdelt",
});

const allEvents = JSON.parse(fs.readFileSync(mockEventsPath, "utf-8")).map(withDefaults);
const adminIngestToken = String(process.env.ADMIN_INGEST_TOKEN || process.env.ADMIN_TOKEN || "");
const adminIngestCooldownMs = Math.max(5, Number(process.env.ADMIN_INGEST_COOLDOWN_SECONDS || 60)) * 1000;
let lastAdminIngestAt = 0;

const SOURCE_PRIORITY = {
  news: 1.2,
  acled: 1.15,
  gdelt: 1,
};

function sourcePriority(source) {
  return SOURCE_PRIORITY[String(source || "").toLowerCase()] || 1;
}

function criticalWeight(type, weight) {
  return String(type || "").toLowerCase() === "war" || String(type || "").toLowerCase() === "attack"
    ? Number(weight || 0) * 1.5
    : Number(weight || 0);
}

function recencyBoost(dateIso) {
  const eventTs = new Date(dateIso).getTime();
  if (Number.isNaN(eventTs)) {
    return 0;
  }

  const ageHours = Math.max(0, (Date.now() - eventTs) / (60 * 60 * 1000));
  return Math.exp(-ageHours / 24);
}

function computeImportance(event) {
  const baseWeight = criticalWeight(event.type, event.weight);
  const confidence = Number.isFinite(Number(event.confidence)) ? Number(event.confidence) : 0.6;
  return baseWeight * confidence * recencyBoost(event.date) * sourcePriority(event.source);
}

function toPerSourceObject(rows) {
  const output = { news: 0, gdelt: 0, acled: 0 };
  for (const row of rows) {
    output[String(row.source)] = Number(row.count || 0);
  }
  return output;
}

function isAuthorizedAdminRequest(req) {
  if (!adminIngestToken) {
    return false;
  }

  const headerToken = String(req.headers["x-admin-token"] || "");
  if (headerToken && headerToken === adminIngestToken) {
    return true;
  }

  const auth = String(req.headers.authorization || "");
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim() === adminIngestToken;
  }

  return false;
}

async function runAllIngestions() {
  const startedAt = new Date();
  const result = await ingestAllSources();
  const endedAt = new Date();

  return {
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    ...result,
  };
}

async function getMetricsSummaryFromDb() {
  const [perSourceResult, perMinuteResult] = await Promise.all([
    dbQuery(
      `
        SELECT source, COUNT(*)::int AS count
        FROM events
        WHERE date >= NOW() - INTERVAL '24 hours'
        GROUP BY source
        ORDER BY count DESC
      `
    ),
    dbQuery(
      `
        SELECT ROUND((COUNT(*) / 30.0)::numeric, 2)::float8 AS events_per_minute
        FROM events
        WHERE date >= NOW() - INTERVAL '30 minutes'
      `
    ),
  ]);

  const countries = await listCountryScoresCached({ days: 7 });
  const countriesWithSpikes = (countries || []).filter((row) => row.spike).length;

  return {
    mode: "db",
    eventsPerMinute: Number(perMinuteResult.rows[0]?.events_per_minute || 0),
    eventsPerSource: toPerSourceObject(perSourceResult.rows),
    countriesWithSpikes,
  };
}

function getMetricsSummaryFromFallback() {
  const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;
  const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;

  const recent30m = allEvents.filter((event) => new Date(event.date).getTime() >= thirtyMinutesAgo);
  const recent24h = allEvents.filter((event) => new Date(event.date).getTime() >= twentyFourHoursAgo);

  const perSource = new Map();
  for (const event of recent24h) {
    const source = event.source || "gdelt";
    perSource.set(source, (perSource.get(source) || 0) + 1);
  }

  const countries = computeCountryScoresInMemory(recent24h);
  const countriesWithSpikes = countries.filter((row) => row.spike).length;

  return {
    mode: "fallback",
    eventsPerMinute: Number((recent30m.length / 30).toFixed(2)),
    eventsPerSource: toPerSourceObject(
      Array.from(perSource.entries()).map(([source, count]) => ({ source, count }))
    ),
    countriesWithSpikes,
  };
}

async function listTopEventsFromDb(limit = 10, { days, source, type } = {}) {
  const filters = [];
  const params = [];

  if (days) {
    params.push(days);
    filters.push(`date >= NOW() - ($${params.length}::int * INTERVAL '1 day')`);
  }

  if (source) {
    params.push(source);
    filters.push(`LOWER(source) = LOWER($${params.length})`);
  }

  if (type) {
    params.push(type);
    filters.push(`LOWER(type) = LOWER($${params.length})`);
  }

  const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  params.push(limit);

  const result = await dbQuery(
    `
      SELECT
        id,
        title,
        country,
        lat,
        lon,
        type,
        weight,
        confidence,
        date,
        source,
        ROUND((
          (CASE WHEN LOWER(type) IN ('war', 'attack') THEN weight * 1.5 ELSE weight END)
          * confidence
          * EXP(-(EXTRACT(EPOCH FROM (NOW() - date)) / 3600.0) / 24)
          * (CASE LOWER(source)
              WHEN 'news' THEN 1.2
              WHEN 'acled' THEN 1.15
              ELSE 1.0
             END)
        )::numeric, 2)::float8 AS importance
      FROM events
      ${whereClause}
      ORDER BY importance DESC, date DESC
      LIMIT $${params.length}
    `,
    params
  );

  return result.rows;
}

function listTopEventsFromFallback(limit = 10, { days, source, type } = {}) {
  const dayWindow = Number.isFinite(Number(days)) ? Number(days) : null;
  const maxAgeMs = dayWindow ? dayWindow * 24 * 60 * 60 * 1000 : null;

  return allEvents
    .filter((event) => {
      if (source && String(event.source || "").toLowerCase() !== String(source).toLowerCase()) {
        return false;
      }
      if (type && String(event.type || "").toLowerCase() !== String(type).toLowerCase()) {
        return false;
      }
      if (maxAgeMs !== null && Date.now() - new Date(event.date).getTime() > maxAgeMs) {
        return false;
      }
      return true;
    })
    .map((event) => ({ ...event, importance: Number(computeImportance(event).toFixed(2)) }))
    .sort((a, b) => b.importance - a.importance || new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, limit);
}

app.get("/health", async (_req, res) => {
  const db = await dbHealth();
  res.json({ ok: true, service: "global-tension-map-api", db });
});

app.get("/events", async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
  const countryFilter = req.query.country ? String(req.query.country).toLowerCase() : "";
  const typeFilter = req.query.type ? String(req.query.type).toLowerCase() : "";
  const sourceFilter = req.query.source ? String(req.query.source).toLowerCase() : "";
  const days = req.query.days ? Math.max(1, Number(req.query.days)) : null;
  const bbox = req.query.bbox
    ? String(req.query.bbox)
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isFinite(value))
    : null;

  try {
    const dbPayload = await listEventsFromDb({
      page,
      limit,
      country: countryFilter,
      type: typeFilter,
      days,
      source: sourceFilter,
      bbox,
    });

    if (dbPayload) {
      return res.json(dbPayload);
    }
  } catch (error) {
    console.warn("DB events query failed, using mock fallback", error);
  }

  const filtered = allEvents.filter((event) => {
    if (countryFilter && event.country.toLowerCase() !== countryFilter) {
      return false;
    }

    if (typeFilter && event.type.toLowerCase() !== typeFilter) {
      return false;
    }

    if (sourceFilter && String(event.source || "").toLowerCase() !== sourceFilter) {
      return false;
    }

    if (days) {
      const ageMs = Date.now() - new Date(event.date).getTime();
      const maxAgeMs = days * 24 * 60 * 60 * 1000;
      if (ageMs > maxAgeMs) {
        return false;
      }
    }

    if (bbox && bbox.length === 4) {
      const [west, south, east, north] = bbox;
      if (event.lon < west || event.lon > east || event.lat < south || event.lat > north) {
        return false;
      }
    }

    return true;
  });

  const start = (page - 1) * limit;
  const paginated = filtered.slice(start, start + limit);

  return res.json({
    total: filtered.length,
    page,
    limit,
    items: paginated,
  });
});

app.get("/events/top", async (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
  const days = req.query.days ? Math.max(1, Number(req.query.days)) : null;
  const source = req.query.source ? String(req.query.source).toLowerCase() : "";
  const type = req.query.type ? String(req.query.type).toLowerCase() : "";

  try {
    if (isDbConfigured()) {
      const items = await listTopEventsFromDb(limit, { days, source, type });
      return res.json({ items, limit });
    }
  } catch (error) {
    console.warn("DB top events query failed, using fallback", error);
  }

  const items = listTopEventsFromFallback(limit, { days, source, type });
  return res.json({ items, limit });
});

app.get("/countries", async (_req, res) => {
  const typeFilter = _req.query.type ? String(_req.query.type).toLowerCase() : "";
  const sourceFilter = _req.query.source ? String(_req.query.source).toLowerCase() : "";
  const days = _req.query.days ? Math.max(1, Number(_req.query.days)) : null;

  try {
    const cached = await listCountryScoresCached({
      type: typeFilter,
      source: sourceFilter,
      days,
    });
    if (cached) {
      return res.json(cached);
    }
  } catch (error) {
    console.warn("DB country score query failed, using mock fallback", error);
  }

  const filtered = allEvents.filter((event) => {
    if (typeFilter && event.type.toLowerCase() !== typeFilter) {
      return false;
    }

    if (sourceFilter && String(event.source || "").toLowerCase() !== sourceFilter) {
      return false;
    }

    if (days) {
      const ageMs = Date.now() - new Date(event.date).getTime();
      const maxAgeMs = days * 24 * 60 * 60 * 1000;
      if (ageMs > maxAgeMs) {
        return false;
      }
    }

    return true;
  });

  const scores = computeCountryScoresInMemory(filtered);
  return res.json(scores);
});

app.get("/metrics/summary", async (_req, res) => {
  try {
    if (isDbConfigured()) {
      return res.json(await getMetricsSummaryFromDb());
    }
  } catch (error) {
    console.warn("DB metrics query failed, using fallback metrics", error);
  }

  return res.json(getMetricsSummaryFromFallback());
});

app.post("/admin/ingest", async (req, res) => {
  if (!isAuthorizedAdminRequest(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const now = Date.now();
  if (now - lastAdminIngestAt < adminIngestCooldownMs) {
    return res.status(429).json({
      error: "Too many requests",
      retryAfterSeconds: Math.ceil((adminIngestCooldownMs - (now - lastAdminIngestAt)) / 1000),
    });
  }

  if (!isDbConfigured()) {
    return res.status(503).json({ error: "Database is required for manual ingestion" });
  }

  lastAdminIngestAt = now;
  try {
    const ingestResult = await runAllIngestions();
    return res.json({ ok: true, ingest: ingestResult });
  } catch (error) {
    return res.status(500).json({ error: "Ingestion failed", detail: error.message || String(error) });
  }
});

if (isDbConfigured() && process.env.ENABLE_SCORE_CACHE_CRON !== "false") {
  const refresh = async () => {
    try {
      const upserted = await refreshCountryScoresCache();
      console.log(`country_scores refreshed (${upserted} countries)`);
    } catch (error) {
      console.error("country_scores refresh failed", error);
    }
  };

  refresh();
  setInterval(refresh, 5 * 60 * 1000);
}

if (
  isDbConfigured() &&
  process.env.ENABLE_NEWS_INGEST_CRON === "true" &&
  (process.env.NEWS_API_KEY || process.env.GNEWS_API_KEY)
) {
  const runNewsIngest = async () => {
    try {
      const result = await ingestNews();
      console.log("news ingest completed", result);
    } catch (error) {
      console.error("news ingest failed", error);
    }
  };

  runNewsIngest();
  setInterval(runNewsIngest, 5 * 60 * 1000);
}

app.listen(port, () => {
  console.log(`Global Tension Map API listening on http://localhost:${port}`);
});
