import { insertEvents } from "../repositories/eventsRepository.js";
import { refreshCountryScoresCache } from "../repositories/countryScoresRepository.js";
import {
  clampCoordinate,
  deterministicUuid,
  mapTypeAndWeight,
  safeText,
  toIsoDate,
} from "./lib/eventSchema.js";

const ACLED_CONFIDENCE = 0.9;
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

export async function fetchEvents({ limit = 250 } = {}) {
  const key = process.env.ACLED_API_KEY;
  const email = process.env.ACLED_EMAIL;

  if (!key || !email) {
    throw new Error("ACLED_API_KEY and ACLED_EMAIL are required for ACLED ingestion");
  }

  const query = new URLSearchParams({
    key,
    email,
    limit: String(limit),
    terms: "accept",
    event_date_where: ">=",
    event_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  });

  const url = `https://api.acleddata.com/acled/read?${query.toString()}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "global-tension-map/0.1" },
  });

  if (!response.ok) {
    throw new Error(`ACLED request failed with status ${response.status}`);
  }

  const payload = await response.json();
  if (Array.isArray(payload?.data)) {
    return payload.data;
  }

  return [];
}

export function normalizeEvents(rawRows) {
  const normalized = [];
  const maxAgeHours = Math.max(1, Number(process.env.ACLED_MAX_AGE_HOURS || 24));
  const minConfidence = resolveMinConfidence();

  for (const row of rawRows) {
    const title = safeText(
      row.notes || row.sub_event_type || row.event_type || "Untitled ACLED event"
    );
    const country = safeText(row.country || "Unknown");
    const lat = clampCoordinate(Number(row.latitude), -90, 90);
    const lon = clampCoordinate(Number(row.longitude), -180, 180);
    const date = toIsoDate(row.event_date);

    if (!title || !country || lat === null || lon === null || !date) {
      continue;
    }

    if (!isRecentEnough(date, maxAgeHours)) {
      continue;
    }

    const signalText = [row.event_type, row.sub_event_type, row.notes].filter(Boolean).join(" ");
    const { type, weight } = mapTypeAndWeight(signalText);

    normalized.push({
      title,
      country,
      lat,
      lon,
      type,
      weight,
      date,
      source: "acled",
      confidence: ACLED_CONFIDENCE,
      externalId: String(row.event_id_cnty || row.data_id || `${country}-${date}-${lat}-${lon}`),
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

export async function ingestAcled(options = {}) {
  const startedAt = new Date();
  const rawRows = await fetchEvents(options);
  const normalized = normalizeEvents(rawRows);
  const mapped = mapToSchema(normalized);
  const inserted = await saveToDB(mapped);
  const deduped = Math.max(0, mapped.length - inserted);
  const endedAt = new Date();

  console.log({
    source: "acled",
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

if (process.argv[1] && process.argv[1].includes("ingestAcled.js")) {
  ingestAcled()
    .then((result) => {
      console.log("ACLED ingestion completed", result);
      process.exit(0);
    })
    .catch((error) => {
      console.error("ACLED ingestion failed", error);
      process.exit(1);
    });
}
