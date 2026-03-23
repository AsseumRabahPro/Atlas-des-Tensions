import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dedupeAndMergeEvents } from "../dedupeEvents.js";

/** Base event in Eastern Ukraine (Kharkiv area) */
const BASE = {
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  externalId: "ext-001",
  title: "Battle near Kharkiv",
  country: "Ukraine",
  type: "war",
  weight: 8,
  confidence: 0.7,
  lat: 50.0,
  lon: 36.3,
  date: "2024-01-15T12:00:00.000Z",
};

describe("dedupeAndMergeEvents", () => {
  // ─── Edge cases ───────────────────────────────────────────────────────────

  it("returns empty array for empty input", () => {
    assert.deepEqual(dedupeAndMergeEvents([]), []);
  });

  it("returns single event unchanged (same title and weight)", () => {
    const result = dedupeAndMergeEvents([BASE]);
    assert.equal(result.length, 1);
    assert.equal(result[0].title, BASE.title);
    assert.equal(result[0].weight, BASE.weight);
  });

  it("preserves all three distinct events", () => {
    const a = { ...BASE };
    const b = { ...BASE, externalId: "ext-002", country: "Russia", lat: 55.0, lon: 37.6 };
    const c = { ...BASE, externalId: "ext-003", country: "France", lat: 48.8, lon: 2.3 };
    assert.equal(dedupeAndMergeEvents([a, b, c]).length, 3);
  });

  // ─── No-merge conditions ─────────────────────────────────────────────────

  it("keeps events from different countries separate", () => {
    const a = { ...BASE };
    const b = { ...BASE, externalId: "ext-002", country: "Russia", lat: 55.0, lon: 37.6 };
    assert.equal(dedupeAndMergeEvents([a, b]).length, 2);
  });

  it("keeps events with different types separate", () => {
    const a = { ...BASE };
    const b = { ...BASE, externalId: "ext-002", type: "attack" };
    assert.equal(dedupeAndMergeEvents([a, b]).length, 2);
  });

  it("keeps events more than 24h apart separate", () => {
    const a = { ...BASE };
    const b = { ...BASE, externalId: "ext-002", date: "2024-01-17T13:00:00.000Z" };
    assert.equal(dedupeAndMergeEvents([a, b]).length, 2);
  });

  it("keeps events more than 50 km apart separate (≈ 530 km east)", () => {
    // lon 41.0 is roughly 530 km east of lon 36.3 at lat 50
    const b = { ...BASE, externalId: "ext-002", lat: 50.0, lon: 41.0 };
    assert.equal(dedupeAndMergeEvents([BASE, b]).length, 2);
  });

  // ─── Merge conditions ────────────────────────────────────────────────────

  it("merges two nearby events (< 50 km, same country, type, within 24h)", () => {
    const b = { ...BASE, externalId: "ext-002", lat: 50.05, lon: 36.35 }; // ~7 km away
    assert.equal(dedupeAndMergeEvents([BASE, b]).length, 1);
  });

  it("merged event keeps the higher weight", () => {
    const a = { ...BASE, weight: 8 };
    const b = { ...BASE, externalId: "ext-002", weight: 10, lat: 50.05, lon: 36.35 };
    const [merged] = dedupeAndMergeEvents([a, b]);
    assert.equal(merged.weight, 10);
  });

  it("merged event keeps the higher confidence", () => {
    const a = { ...BASE, confidence: 0.6 };
    const b = { ...BASE, externalId: "ext-002", confidence: 0.9, lat: 50.05, lon: 36.35 };
    const [merged] = dedupeAndMergeEvents([a, b]);
    assert.equal(merged.confidence, 0.9);
  });

  it("merged event keeps the longer title", () => {
    const a = { ...BASE, title: "War" };
    const b = {
      ...BASE,
      externalId: "ext-002",
      title: "Full-scale military operation near Kharkiv",
      lat: 50.05,
      lon: 36.35,
    };
    const [merged] = dedupeAndMergeEvents([a, b]);
    assert.equal(merged.title, "Full-scale military operation near Kharkiv");
  });

  it("merged externalId contains both source IDs", () => {
    const a = { ...BASE };
    const b = { ...BASE, externalId: "ext-002", lat: 50.05, lon: 36.35 };
    const [merged] = dedupeAndMergeEvents([a, b]);
    assert.ok(merged.externalId.includes("ext-001"), "Should reference first source ID");
    assert.ok(merged.externalId.includes("ext-002"), "Should reference second source ID");
  });

  it("merged result has a deterministic UUID (same inputs → same id)", () => {
    const a = { ...BASE };
    const b = { ...BASE, externalId: "ext-002", lat: 50.05, lon: 36.35 };
    const [run1] = dedupeAndMergeEvents([a, b]);
    const [run2] = dedupeAndMergeEvents([a, b]);
    assert.equal(run1.id, run2.id);
  });

  // ─── Country normalization ────────────────────────────────────────────────

  it("merges events whose country name differs only in case", () => {
    const a = { ...BASE, country: "Ukraine" };
    const b = { ...BASE, externalId: "ext-002", country: "ukraine", lat: 50.05, lon: 36.35 };
    assert.equal(dedupeAndMergeEvents([a, b]).length, 1);
  });
});
