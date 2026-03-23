const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;

function resolveSpikeThresholdMultiplier() {
  const raw = Number(process.env.SPIKE_THRESHOLD_MULTIPLIER);
  if (!Number.isFinite(raw) || raw <= 0) {
    return 2;
  }
  return raw;
}

function getCriticalBoostedWeight(type, weight) {
  return type === "war" || type === "attack" ? weight * 1.5 : weight;
}

export function calculateDecay(eventDateIso, now = new Date()) {
  const eventTime = new Date(eventDateIso).getTime();
  if (Number.isNaN(eventTime)) {
    return 0;
  }

  const ageDays = Math.max(0, (now.getTime() - eventTime) / ONE_DAY_MS);
  return Math.exp(-ageDays / 7);
}

export function computeCountryScoresInMemory(events, now = new Date()) {
  const scores = new Map();
  const spikes = new Map();
  const nowTs = now.getTime();
  const spikeThresholdMultiplier = resolveSpikeThresholdMultiplier();

  for (const event of events) {
    if (!event.country) {
      continue;
    }

    const decay = calculateDecay(event.date, now);
    const boostedWeight = getCriticalBoostedWeight(event.type, Number(event.weight) || 0);
    const confidence = Number.isFinite(Number(event.confidence)) ? Number(event.confidence) : 0.6;
    const contribution = boostedWeight * confidence * decay;
    const current = scores.get(event.country) || 0;
    scores.set(event.country, current + contribution);

    const eventTs = new Date(event.date).getTime();
    if (Number.isNaN(eventTs)) {
      continue;
    }

    if (!spikes.has(event.country)) {
      spikes.set(event.country, { last6h: 0, last7d: 0 });
    }

    const bucket = spikes.get(event.country);
    if (nowTs - eventTs <= SEVEN_DAYS_MS) {
      bucket.last7d += 1;
    }

    if (nowTs - eventTs <= SIX_HOURS_MS) {
      bucket.last6h += 1;
    }
  }

  return Array.from(scores.entries())
    .map(([country, score]) => ({
      country,
      score: Number(score.toFixed(2)),
      spike: (() => {
        const entry = spikes.get(country);
        if (!entry || entry.last7d <= 0) {
          return false;
        }
        const avgPer6h = entry.last7d / 28;
        return entry.last6h > avgPer6h * spikeThresholdMultiplier;
      })(),
    }))
    .sort((a, b) => b.score - a.score);
}
