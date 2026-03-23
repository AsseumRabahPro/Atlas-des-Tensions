import { deterministicUuid, normalizeCountryName } from "./eventSchema.js";

const MAX_DISTANCE_KM = 50;
const MAX_TIME_DIFF_MS = 24 * 60 * 60 * 1000;

function toRad(value) {
  return (value * Math.PI) / 180;
}

function distanceKm(aLat, aLon, bLat, bLon) {
  const earthRadiusKm = 6371;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * earthRadiusKm * Math.asin(Math.sqrt(h));
}

function shouldMerge(a, b) {
  if (normalizeCountryName(a.country) !== normalizeCountryName(b.country)) {
    return false;
  }

  if (a.type !== b.type) {
    return false;
  }

  const timeDiff = Math.abs(new Date(a.date).getTime() - new Date(b.date).getTime());
  if (timeDiff > MAX_TIME_DIFF_MS) {
    return false;
  }

  const distance = distanceKm(a.lat, a.lon, b.lat, b.lon);
  return distance < MAX_DISTANCE_KM;
}

function mergeEvent(base, candidate) {
  const keepCandidateAsPrimary = candidate.confidence > base.confidence;
  const primary = keepCandidateAsPrimary ? candidate : base;
  const secondary = keepCandidateAsPrimary ? base : candidate;

  const mergedTitle = primary.title.length >= secondary.title.length ? primary.title : secondary.title;
  const mergedExternalId = `merged:${[base.externalId, candidate.externalId].sort().join("|")}`;

  return {
    ...primary,
    id: deterministicUuid(mergedExternalId),
    title: mergedTitle,
    weight: Math.max(base.weight, candidate.weight),
    confidence: Math.max(base.confidence, candidate.confidence),
    externalId: mergedExternalId,
  };
}

export function dedupeAndMergeEvents(events) {
  const merged = [];

  for (const event of events) {
    const foundIndex = merged.findIndex((existing) => shouldMerge(existing, event));

    if (foundIndex === -1) {
      merged.push(event);
      continue;
    }

    merged[foundIndex] = mergeEvent(merged[foundIndex], event);
  }

  return merged;
}
