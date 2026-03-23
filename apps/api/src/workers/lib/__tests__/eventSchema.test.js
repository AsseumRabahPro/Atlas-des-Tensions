import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  WEIGHTS,
  mapTypeAndWeight,
  clampCoordinate,
  toIsoDate,
  safeText,
  normalizeCountryName,
  deterministicUuid,
} from "../eventSchema.js";

// ─── WEIGHTS ─────────────────────────────────────────────────────────────────

describe("WEIGHTS", () => {
  it("contains all expected event types", () => {
    const expected = ["war", "attack", "conflict", "sanction", "protest", "tension", "politic"];
    for (const key of expected) {
      assert.ok(key in WEIGHTS, `Missing weight for: ${key}`);
    }
  });

  it("war has the highest weight", () => {
    const max = Math.max(...Object.values(WEIGHTS));
    assert.equal(WEIGHTS.war, max);
  });

  it("politic has the lowest weight", () => {
    const min = Math.min(...Object.values(WEIGHTS));
    assert.equal(WEIGHTS.politic, min);
  });

  it("all weights are positive integers", () => {
    for (const [key, val] of Object.entries(WEIGHTS)) {
      assert.ok(Number.isInteger(val) && val > 0, `Weight for ${key} must be a positive integer`);
    }
  });
});

// ─── mapTypeAndWeight ─────────────────────────────────────────────────────────

describe("mapTypeAndWeight", () => {
  const cases = [
    ["Full-scale invasion and battle in progress", "war", WEIGHTS.war],
    ["Drone strike kills 12 civilians", "attack", WEIGHTS.attack],
    ["Violent fighting between armed factions", "conflict", WEIGHTS.conflict],
    ["New trade embargo imposed on the regime", "sanction", WEIGHTS.sanction],
    ["Mass protest march through city center", "protest", WEIGHTS.protest],
    ["Rising tension at the disputed border", "tension", WEIGHTS.tension],
    ["Election results announced by the minister", "politic", WEIGHTS.politic],
    ["Restaurant opens in downtown area", "politic", WEIGHTS.politic],
  ];

  for (const [text, expectedType, expectedWeight] of cases) {
    it(`classifies "${text.slice(0, 40)}…" as ${expectedType}`, () => {
      const { type, weight } = mapTypeAndWeight(text);
      assert.equal(type, expectedType);
      assert.equal(weight, expectedWeight);
    });
  }

  it("war rule takes priority when text contains both war and attack keywords", () => {
    const { type } = mapTypeAndWeight("military operation and drone battle");
    assert.equal(type, "war");
  });

  it("is case-insensitive", () => {
    const { type } = mapTypeAndWeight("INVASION AND SHELLING");
    assert.equal(type, "war");
  });
});

// ─── clampCoordinate ──────────────────────────────────────────────────────────

describe("clampCoordinate", () => {
  it("returns value within range", () => assert.equal(clampCoordinate(45, -90, 90), 45));
  it("returns null when value exceeds max", () => assert.equal(clampCoordinate(91, -90, 90), null));
  it("returns null when value is below min", () => assert.equal(clampCoordinate(-91, -90, 90), null));
  it("returns null for NaN", () => assert.equal(clampCoordinate(NaN, -90, 90), null));
  it("returns null for Infinity", () => assert.equal(clampCoordinate(Infinity, -90, 90), null));
  it("returns null for -Infinity", () => assert.equal(clampCoordinate(-Infinity, -90, 90), null));
  it("accepts boundary min value", () => assert.equal(clampCoordinate(-90, -90, 90), -90));
  it("accepts boundary max value", () => assert.equal(clampCoordinate(90, -90, 90), 90));
  it("accepts zero within range", () => assert.equal(clampCoordinate(0, -90, 90), 0));
  it("works for longitude range [-180, 180]", () => {
    assert.equal(clampCoordinate(180, -180, 180), 180);
    assert.equal(clampCoordinate(181, -180, 180), null);
  });
});

// ─── toIsoDate ────────────────────────────────────────────────────────────────

describe("toIsoDate", () => {
  it("parses a full ISO timestamp", () => {
    assert.equal(toIsoDate("2024-01-15T10:00:00.000Z"), "2024-01-15T10:00:00.000Z");
  });

  it("parses a date-only string and returns an ISO string", () => {
    const result = toIsoDate("2024-01-15");
    assert.ok(typeof result === "string" && result.startsWith("2024-01-15"));
  });

  it("returns null for an invalid date string", () => {
    assert.equal(toIsoDate("not-a-date"), null);
  });

  it("returns null for empty string", () => {
    assert.equal(toIsoDate(""), null);
  });

  it("returns null for undefined", () => {
    assert.equal(toIsoDate(undefined), null);
  });

  it("parses a numeric timestamp (milliseconds)", () => {
    const ts = new Date("2024-06-01T00:00:00Z").getTime();
    const result = toIsoDate(ts);
    assert.ok(result !== null && result.includes("2024-06-01"));
  });
});

// ─── safeText ─────────────────────────────────────────────────────────────────

describe("safeText", () => {
  it("trims leading and trailing whitespace", () => assert.equal(safeText("  hello  "), "hello"));
  it("returns empty string for null", () => assert.equal(safeText(null), ""));
  it("returns empty string for undefined", () => assert.equal(safeText(undefined), ""));
  it("returns empty string for a number", () => assert.equal(safeText(42), ""));
  it("returns empty string for a boolean", () => assert.equal(safeText(true), ""));
  it("returns empty string for an object", () => assert.equal(safeText({}), ""));
  it("preserves internal whitespace", () => assert.equal(safeText("hello world"), "hello world"));
  it("returns empty string for empty string", () => assert.equal(safeText(""), ""));
});

// ─── normalizeCountryName ─────────────────────────────────────────────────────

describe("normalizeCountryName", () => {
  it("lowercases ASCII name", () => assert.equal(normalizeCountryName("France"), "france"));
  it("lowercases multi-word name", () => assert.equal(normalizeCountryName("United States"), "united states"));
  it("strips accents from characters", () => {
    const result = normalizeCountryName("Côte");
    assert.ok(!result.includes("ô"), "Should not contain accented character");
    assert.ok(result.includes("cote"), "Should contain normalized form");
  });
  it("removes non-letter/space characters", () => {
    const result = normalizeCountryName("Bosnia & Herzegovina");
    assert.ok(!result.includes("&"));
  });
  it("returns empty string for empty input", () => assert.equal(normalizeCountryName(""), ""));
  it("normalizes the same country consistently", () => {
    assert.equal(normalizeCountryName("Germany"), normalizeCountryName("germany"));
  });
});

// ─── deterministicUuid ───────────────────────────────────────────────────────

describe("deterministicUuid", () => {
  it("returns a UUID-formatted string", () => {
    const uuid = deterministicUuid("test-fingerprint");
    assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("is deterministic for the same input", () => {
    assert.equal(deterministicUuid("fingerprint-abc"), deterministicUuid("fingerprint-abc"));
  });

  it("produces different UUIDs for different inputs", () => {
    assert.notEqual(deterministicUuid("input-a"), deterministicUuid("input-b"));
  });

  it("works with an empty string fingerprint", () => {
    const uuid = deterministicUuid("");
    assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("works with a long fingerprint", () => {
    const uuid = deterministicUuid("merged:ext-001|ext-002|ext-003|ext-004|ext-005");
    assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
