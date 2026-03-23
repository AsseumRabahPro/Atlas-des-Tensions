import { insertEvents } from "../repositories/eventsRepository.js";
import { refreshCountryScoresCache } from "../repositories/countryScoresRepository.js";
import { deterministicUuid, mapTypeAndWeight, safeText, toIsoDate, WEIGHTS } from "./lib/eventSchema.js";
import { extractEventFromText, isRelevantArticle } from "./lib/extractEventFromText.js";
import { geocodeLocation } from "./lib/geocodeLocation.js";

const ONE_HOUR_MS = 60 * 60 * 1000;

function isRecentEnough(isoDate, maxAgeHours = 1) {
  const ts = new Date(isoDate).getTime();
  if (Number.isNaN(ts)) {
    return false;
  }

  return Date.now() - ts <= maxAgeHours * ONE_HOUR_MS;
}

function resolveNewsMaxAgeHours() {
  const fromPrimary = Number(process.env.NEWS_MAX_AGE_HOURS);
  if (Number.isFinite(fromPrimary) && fromPrimary > 0) {
    return fromPrimary;
  }

  const fromAlias = Number(process.env.MAX_NEWS_AGE_HOURS);
  if (Number.isFinite(fromAlias) && fromAlias > 0) {
    return fromAlias;
  }

  return 1;
}

function resolveMinConfidence() {
  const raw = Number(process.env.MIN_EVENT_CONFIDENCE);
  if (!Number.isFinite(raw)) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, raw));
}

function normalizeTypeAndWeight(type, weight, article) {
  const allowed = new Set(Object.keys(WEIGHTS));
  const normalizedType = String(type || "").toLowerCase();
  if (allowed.has(normalizedType) && Number.isFinite(Number(weight))) {
    return { type: normalizedType, weight: Number(weight) };
  }

  const signalText = [article.title, article.description, article.content].filter(Boolean).join(" ");
  return mapTypeAndWeight(signalText);
}

async function fetchFromNewsApi(limit) {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) {
    return null;
  }

  const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent("war OR attack OR protest OR conflict OR sanction OR tension")}&language=en&pageSize=${limit}&sortBy=publishedAt&apiKey=${apiKey}`;
  const response = await fetch(url, { headers: { "User-Agent": "global-tension-map/0.1" } });
  if (!response.ok) {
    throw new Error(`NewsAPI request failed with status ${response.status}`);
  }

  const payload = await response.json();
  return Array.isArray(payload?.articles)
    ? payload.articles.map((article) => ({
        title: article.title,
        description: article.description,
        content: article.content,
        publishedAt: article.publishedAt,
        url: article.url,
        provider: "newsapi",
      }))
    : [];
}

async function fetchFromGNews(limit) {
  const apiKey = process.env.GNEWS_API_KEY;
  if (!apiKey) {
    return null;
  }

  const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent("war OR attack OR protest OR conflict OR sanction OR tension")}&lang=en&max=${limit}&token=${apiKey}`;
  const response = await fetch(url, { headers: { "User-Agent": "global-tension-map/0.1" } });
  if (!response.ok) {
    throw new Error(`GNews request failed with status ${response.status}`);
  }

  const payload = await response.json();
  return Array.isArray(payload?.articles)
    ? payload.articles.map((article) => ({
        title: article.title,
        description: article.description,
        content: article.content,
        publishedAt: article.publishedAt,
        url: article.url,
        provider: "gnews",
      }))
    : [];
}

export async function fetchNews({ limit = 40 } = {}) {
  const [newsApiArticles, gnewsArticles] = await Promise.all([
    fetchFromNewsApi(limit),
    fetchFromGNews(limit),
  ]);

  const combined = [...(newsApiArticles || []), ...(gnewsArticles || [])];
  if (combined.length === 0) {
    throw new Error("NEWS_API_KEY or GNEWS_API_KEY is required for news ingestion");
  }

  return combined;
}

export function filterRelevantArticles(articles) {
  return articles.filter(isRelevantArticle);
}

export async function mapToUnifiedSchema(articles) {
  const mapped = [];
  const maxAgeHours = resolveNewsMaxAgeHours();
  const minConfidence = resolveMinConfidence();

  for (const article of articles) {
    const extracted = await extractEventFromText(article);
    if (!extracted.country) {
      continue;
    }

    const normalizedDate = toIsoDate(extracted.date || article.publishedAt);
    if (!normalizedDate || !isRecentEnough(normalizedDate, maxAgeHours)) {
      continue;
    }

    const normalized = normalizeTypeAndWeight(extracted.type, extracted.weight, article);

    const geocoded = await geocodeLocation(extracted.city, extracted.country);
    if (!geocoded || !Number.isFinite(geocoded.lat) || !Number.isFinite(geocoded.lon)) {
      continue;
    }

    if ((Number(extracted.confidence) || 0) < minConfidence) {
      continue;
    }

    const externalId = safeText(article.url) || `${article.title}-${article.publishedAt}`;
    mapped.push({
      id: deterministicUuid(`news:${externalId}`),
      title: safeText(article.title) || "Live news event",
      country: extracted.country,
      lat: geocoded.lat,
      lon: geocoded.lon,
      type: normalized.type,
      weight: normalized.weight,
      date: normalizedDate,
      source: "news",
      confidence: extracted.confidence,
      externalId,
    });
  }

  return mapped;
}

export async function ingestNews(options = {}) {
  const startedAt = new Date();
  const rawArticles = await fetchNews(options);
  const relevantArticles = filterRelevantArticles(rawArticles);
  const mapped = await mapToUnifiedSchema(relevantArticles);
  const inserted = await insertEvents(mapped);
  const deduped = Math.max(0, mapped.length - inserted);
  const endedAt = new Date();

  console.log({
    source: "news",
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    eventsFetched: rawArticles.length,
    eventsSaved: inserted,
    eventsDeduped: deduped,
  });

  await refreshCountryScoresCache();

  return {
    fetched: rawArticles.length,
    relevant: relevantArticles.length,
    mapped: mapped.length,
    deduped,
    inserted,
  };
}

if (process.argv[1] && process.argv[1].includes("ingestNews.js")) {
  ingestNews()
    .then((result) => {
      console.log("News ingestion completed", result);
      process.exit(0);
    })
    .catch((error) => {
      console.error("News ingestion failed", error);
      process.exit(1);
    });
}
