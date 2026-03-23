import { insertEvents } from "../repositories/eventsRepository.js";
import { refreshCountryScoresCache } from "../repositories/countryScoresRepository.js";
import {
  clampCoordinate,
  deterministicUuid,
  mapTypeAndWeight,
  safeText,
  toIsoDate,
} from "./lib/eventSchema.js";

const GDELT_CONFIDENCE = 0.6;
const ONE_HOUR_MS = 60 * 60 * 1000;

function isRecentEnough(isoDate, maxAgeHours = 24) {
  const ts = new Date(isoDate).getTime();
  if (Number.isNaN(ts)) {
    return false;
  }
  return Date.now() - ts <= maxAgeHours * ONE_HOUR_MS;
}

function resolveMinConfidence() {
  const raw = Number(process.env.MIN_EVENT_CONFIDENCE);
  if (!Number.isFinite(raw)) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, raw));
}

function extractRows(payload) {
  if (Array.isArray(payload?.articles)) {
    return payload.articles;
  }
  if (Array.isArray(payload?.features)) {
    return payload.features;
  }
  if (Array.isArray(payload?.data)) {
    return payload.data;
  }
  return [];
}

export async function fetchEvents({ maxRecords = 250, query = "(war OR conflict OR attack OR protest OR sanction OR tension)" } = {}) {
  const encodedQuery = encodeURIComponent(query);
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodedQuery}&mode=ArtList&maxrecords=${maxRecords}&format=json&sort=DateDesc`;

  const response = await fetch(url, {
    headers: { "User-Agent": "global-tension-map/0.1" },
  });

  if (!response.ok) {
    throw new Error(`GDELT request failed with status ${response.status}`);
  }

  const payload = await response.json();
  return extractRows(payload);
}

export function normalizeEvents(rawRows) {
  const normalized = [];
  const maxAgeHours = Math.max(1, Number(process.env.GDELT_MAX_AGE_HOURS || 24));
  const minConfidence = resolveMinConfidence();

  for (const row of rawRows) {
    const title = safeText(row.title || row.name || row.headline || "Untitled event");
    const country = safeText(row.sourcecountry || row.country || row.location || "Unknown");

    const lat = clampCoordinate(Number(row.lat || row.latitude || row.locationlat || row.actiongeo_lat), -90, 90);
    const lon = clampCoordinate(Number(row.lon || row.lng || row.longitude || row.locationlon || row.actiongeo_long), -180, 180);

    const date = toIsoDate(row.seendate || row.date || row.datetime || row.createdAt);
    const sourceUrl = safeText(row.url || row.sourceurl || row.link);

    if (!title || !country || lat === null || lon === null || !date) {
      continue;
    }

    if (!isRecentEnough(date, maxAgeHours)) {
      continue;
    }

    const signalText = [title, row.themes, row.persons, row.organizations, row.v2themes]
      .filter(Boolean)
      .join(" ");

    const { type, weight } = mapTypeAndWeight(signalText);

    normalized.push({
      title,
      country,
      lat,
      lon,
      type,
      weight,
      confidence: GDELT_CONFIDENCE,
      date,
      source: "gdelt",
      externalId: row.id ? String(row.id) : sourceUrl || `${title}-${date}`,
      sourceUrl,
    });
  }

  return normalized.filter((event) => (Number(event.confidence) || 0) >= minConfidence);
}

export function mapToSchema(normalizedEvents) {
  return normalizedEvents.map((event) => {
    const fingerprint = `${event.source}:${event.externalId}`;

    return {
      id: deterministicUuid(fingerprint),
      title: event.title,
      country: event.country,
      lat: event.lat,
      lon: event.lon,
      type: event.type,
      weight: event.weight,
      confidence: event.confidence,
      date: event.date,
      source: event.source,
      externalId: event.externalId,
    };
  });
}

export async function saveToDB(mappedEvents) {
  return insertEvents(mappedEvents);
}

export async function ingestGdelt(options = {}) {
  const startedAt = new Date();
  const rawRows = await fetchEvents(options);
  const normalized = normalizeEvents(rawRows);
  const mapped = mapToSchema(normalized);
  const inserted = await saveToDB(mapped);
  const deduped = Math.max(0, mapped.length - inserted);
  const endedAt = new Date();

  console.log({
    source: "gdelt",
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    eventsFetched: rawRows.length,
    eventsSaved: inserted,
    eventsDeduped: deduped,
  });

  await refreshCountryScoresCache();

  return {
    fetched: rawRows.length,
    normalized: normalized.length,
    deduped,
    inserted,
  };
}

if (process.argv[1] && process.argv[1].includes("ingestGdelt.js")) {
  ingestGdelt()
    .then((result) => {
      console.log("GDELT ingestion completed", result);
      process.exit(0);
    })
    .catch((error) => {
      console.error("GDELT ingestion failed", error);
      process.exit(1);
    });
}
