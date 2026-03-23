import crypto from "node:crypto";

export const WEIGHTS = {
  war: 10,
  attack: 9,
  conflict: 8,
  sanction: 6,
  protest: 4,
  tension: 3,
  politic: 1,
};

const TYPE_RULES = [
  { type: "war", regex: /\b(war|invasion|military operation|battle|shelling|offensive)\b/i },
  { type: "attack", regex: /\b(attack|strike|drone|bombing|missile|raid|killed|explosion)\b/i },
  { type: "conflict", regex: /\b(conflict|clash|fighting|skirmish|escalation|violence)\b/i },
  { type: "sanction", regex: /\b(sanction|embargo|restriction|blacklist)\b/i },
  { type: "protest", regex: /\b(protest|demonstration|rally|march|riot|strike)\b/i },
  { type: "tension", regex: /\b(tension|standoff|dispute|warning|threat)\b/i },
  { type: "politic", regex: /\b(election|parliament|government|minister|political)\b/i },
];

export function mapTypeAndWeight(text) {
  for (const rule of TYPE_RULES) {
    if (rule.regex.test(text)) {
      return { type: rule.type, weight: WEIGHTS[rule.type] };
    }
  }

  return { type: "politic", weight: WEIGHTS.politic };
}

export function clampCoordinate(value, min, max) {
  if (!Number.isFinite(value)) {
    return null;
  }

  if (value < min || value > max) {
    return null;
  }

  return value;
}

export function toIsoDate(rawDate) {
  const parsed = new Date(rawDate);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

export function safeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeCountryName(name) {
  return safeText(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z\s]/g, "")
    .toLowerCase();
}

export function deterministicUuid(fingerprint) {
  return crypto
    .createHash("sha1")
    .update(fingerprint)
    .digest("hex")
    .slice(0, 32)
    .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");
}
