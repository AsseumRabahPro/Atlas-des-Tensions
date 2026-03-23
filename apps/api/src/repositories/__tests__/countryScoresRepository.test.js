import { createRequire } from "node:module";
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// --- Monkey-patch pg.Pool BEFORE db.js loads ---------------------------------
// node:test runs each file in its own process, so patching here is isolated.
// DATABASE_URL must be set before db.js evaluates so isDbConfigured() returns true.
process.env.DATABASE_URL = "postgresql://localhost/test-mock-countryScores";

const require = createRequire(import.meta.url);
const pg = require("pg");

// Mutable impl: each test replaces this to control what pool.query returns
let mockQueryImpl = async () => ({ rows: [] });

class MockPool {
  async query(sql, params) { return mockQueryImpl(sql, params); }
  async connect() { throw new Error("connect() not expected in countryScores tests"); }
}

pg.Pool = MockPool; // redirect before any dynamic import triggers db.js

const { listCountryScoresCached, refreshCountryScoresCache } = await import(
  "../countryScoresRepository.js"
);

// --- listCountryScoresCached --------------------------------------------------

describe("listCountryScoresCached", () => {
  beforeEach(() => { mockQueryImpl = async () => ({ rows: [] }); });

  it("queries the cache table when no filters are provided", async () => {
    const sqlLog = [];
    mockQueryImpl = async (sql) => { sqlLog.push(sql); return { rows: [{ country: "France", score: 5.0 }] }; };
    const result = await listCountryScoresCached();
    assert.equal(result.length, 1);
    assert.equal(result[0].country, "France");
    assert.ok(sqlLog[0].includes("country_scores"), "Should read from the cache table");
    assert.ok(!sqlLog[0].includes("SUM(weight"), "Should NOT run live aggregation");
  });

  it("runs a live aggregate query when a type filter is provided", async () => {
    const sqlLog = [];
    mockQueryImpl = async (sql) => { sqlLog.push(sql); return { rows: [{ country: "Ukraine", score: 9.5 }] }; };
    const result = await listCountryScoresCached({ type: "war" });
    assert.equal(result.length, 1);
    assert.equal(result[0].country, "Ukraine");
    assert.ok(sqlLog[0].includes("CASE WHEN LOWER(type)"), "Should use boosted live aggregation with filters");
    assert.ok(sqlLog[0].includes("LOWER(type)"), "Should filter by type");
  });

  it("runs a live aggregate query when a days filter is provided", async () => {
    const sqlLog = [];
    mockQueryImpl = async (sql) => { sqlLog.push(sql); return { rows: [] }; };
    await listCountryScoresCached({ days: "7" });
    assert.ok(sqlLog[0].includes("INTERVAL"), "Should filter by days interval");
  });

  it("runs a live aggregate query when a source filter is provided", async () => {
    const sqlLog = [];
    mockQueryImpl = async (sql) => { sqlLog.push(sql); return { rows: [] }; };
    await listCountryScoresCached({ source: "news" });
    assert.ok(sqlLog[0].includes("LOWER(source)"), "Should filter by source");
  });

  it("passes the filter value as a parameterised query argument", async () => {
    const paramLog = [];
    mockQueryImpl = async (sql, params) => { paramLog.push(params); return { rows: [] }; };
    await listCountryScoresCached({ type: "attack" });
    assert.ok(Array.isArray(paramLog[0]) && paramLog[0].includes("attack"), "Should pass type value as query param");
  });

  it("returns an empty array when the live query returns no rows", async () => {
    const result = await listCountryScoresCached({ type: "war" });
    assert.deepEqual(result, []);
  });

  it("combines multiple filters in a single WHERE clause", async () => {
    const sqlLog = [];
    mockQueryImpl = async (sql) => { sqlLog.push(sql); return { rows: [] }; };
    await listCountryScoresCached({ type: "war", days: "30", source: "acled" });
    assert.ok(sqlLog[0].includes("LOWER(type)"), "Should include type filter");
    assert.ok(sqlLog[0].includes("INTERVAL"), "Should include days filter");
    assert.ok(sqlLog[0].includes("LOWER(source)"), "Should include source filter");
  });
});

// --- refreshCountryScoresCache ------------------------------------------------

describe("refreshCountryScoresCache", () => {
  beforeEach(() => { mockQueryImpl = async () => ({ rows: [] }); });

  it("returns 0 when there are no events to score", async () => {
    assert.equal(await refreshCountryScoresCache(), 0);
  });

  it("returns the number of countries that were upserted", async () => {
    let n = 0;
    mockQueryImpl = async () => {
      n++;
      if (n === 1) return { rows: [{ country: "France", score: 3.0 }, { country: "Ukraine", score: 8.0 }, { country: "Russia", score: 6.5 }] };
      return { rows: [] };
    };
    assert.equal(await refreshCountryScoresCache(), 3);
  });

  it("runs an UPSERT into country_scores after aggregation", async () => {
    const sqlHistory = [];
    let n = 0;
    mockQueryImpl = async (sql) => {
      sqlHistory.push(sql); n++;
      if (n === 1) return { rows: [{ country: "Germany", score: 2.0 }] };
      return { rows: [] };
    };
    await refreshCountryScoresCache();
    const upsertSql = sqlHistory.find((s) => s.includes("ON CONFLICT"));
    assert.ok(upsertSql, "Should run an UPSERT to keep the cache current");
    assert.ok(upsertSql.includes("country_scores"), "UPSERT should target country_scores");
  });
});
