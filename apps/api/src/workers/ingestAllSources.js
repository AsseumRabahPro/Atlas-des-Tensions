import { insertEvents } from "../repositories/eventsRepository.js";
import { refreshCountryScoresCache } from "../repositories/countryScoresRepository.js";
import { dedupeAndMergeEvents } from "./lib/dedupeEvents.js";
import {
  fetchEvents as fetchGdeltEvents,
  mapToSchema as mapGdeltToSchema,
  normalizeEvents as normalizeGdeltEvents,
} from "./ingestGdelt.js";
import {
  fetchEvents as fetchAcledEvents,
  mapToSchema as mapAcledToSchema,
  normalizeEvents as normalizeAcledEvents,
} from "./ingestAcled.js";
import { mapToUnifiedSchema as mapNewsToSchema, fetchNews, filterRelevantArticles } from "./ingestNews.js";

async function safeSource(name, run) {
  try {
    return await run();
  } catch (error) {
    console.warn(`${name} ingestion skipped`, error.message);
    return [];
  }
}

export async function ingestAllSources({ gdelt = {}, acled = {}, news = {} } = {}) {
  const startedAt = new Date();

  const [gdeltRaw, acledRaw, newsRaw] = await Promise.all([
    safeSource("GDELT", () => fetchGdeltEvents(gdelt)),
    safeSource("ACLED", () => fetchAcledEvents(acled)),
    safeSource("News", () => fetchNews(news)),
  ]);

  const gdeltMapped = mapGdeltToSchema(normalizeGdeltEvents(gdeltRaw));
  const acledMapped = mapAcledToSchema(normalizeAcledEvents(acledRaw));
  const newsMapped = await mapNewsToSchema(filterRelevantArticles(newsRaw));

  const allMapped = [...gdeltMapped, ...acledMapped, ...newsMapped];
  const unified = dedupeAndMergeEvents(allMapped);
  const inserted = await insertEvents(unified);
  const deduped = Math.max(0, allMapped.length - unified.length);
  const endedAt = new Date();

  console.log({
    source: "all",
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    eventsFetched: gdeltRaw.length + acledRaw.length + newsMapped.length,
    eventsSaved: inserted,
    eventsDeduped: deduped,
  });

  await refreshCountryScoresCache();

  return {
    fetched: gdeltRaw.length + acledRaw.length + newsMapped.length,
    mapped: allMapped.length,
    unified: unified.length,
    deduped,
    inserted,
  };
}

if (process.argv[1] && process.argv[1].includes("ingestAllSources.js")) {
  ingestAllSources()
    .then((result) => {
      console.log("Multi-source ingestion completed", result);
      process.exit(0);
    })
    .catch((error) => {
      console.error("Multi-source ingestion failed", error);
      process.exit(1);
    });
}
