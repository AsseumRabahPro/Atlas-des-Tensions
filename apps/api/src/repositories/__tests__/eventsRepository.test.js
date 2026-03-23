import { createRequire } from "node:module";
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// --- Monkey-patch pg.Pool BEFORE db.js loads ---------------------------------
// node:test runs each file in its own process so patching pg here is isolated.
process.env.DATABASE_URL = "postgresql://localhost/test-mock-events";

const require = createRequire(import.meta.url);
const pg = require("pg");

// For pool.query (used by dbQuery)
let mockQueryImpl = async () => ({ rows: [] });

// For pool.connect (used by dbGetClient) ? returns a mock client
let mockClientQueryImpl = async () => ({ rows: [] });
const mockClientRelease = { calls: 0, fn() { this.calls++; } };

const mockClient = {
  query(...args) { return mockClientQueryImpl(...args); },
  release() { mockClientRelease.fn(); },
};

class MockPool {
  async query(sql, params) { return mockQueryImpl(sql, params); }
  async connect() { return mockClient; }
}

pg.Pool = MockPool; // redirect before dynamic import triggers db.js

const { listEvents, insertEvents } = await import("../eventsRepository.js");

// --- Shared fixture -----------------------------------------------------------

const EVENT = {
  id: "aaaaaaaa-1111-1111-1111-111111111111",
  externalId: "ext-test-001",
  title: "Protest in Paris",
  country: "France",
  lat: 48.86,
  lon: 2.34,
  type: "protest",
  weight: 4,
  confidence: 0.7,
  date: "2024-01-15T12:00:00.000Z",
  source: "gdelt",
};

// --- listEvents ---------------------------------------------------------------

describe("listEvents", () => {
  beforeEach(() => { mockQueryImpl = async () => ({ rows: [] }); });

  it("returns paginated results with the correct shape", async () => {
    mockQueryImpl = async (sql) => {
      if (sql.includes("COUNT(*)")) return { rows: [{ total: 2 }] };
      return { rows: [
        { id: "1", title: "Event A", country: "France", lat: 48, lon: 2, type: "protest", weight: 4, confidence: 0.7, date: "2024-01-15", source: "gdelt" },
        { id: "2", title: "Event B", country: "Germany", lat: 52, lon: 13, type: "politic", weight: 1, confidence: 0.6, date: "2024-01-14", source: "acled" },
      ]};
    };
    const result = await listEvents({ page: 1, limit: 10 });
    assert.equal(result.total, 2);
    assert.equal(result.items.length, 2);
    assert.equal(result.page, 1);
    assert.equal(result.limit, 10);
  });

  it("issues two queries per call (COUNT then rows)", async () => {
    let n = 0;
    mockQueryImpl = async (sql) => { n++; return sql.includes("COUNT(*)") ? { rows: [{ total: 0 }] } : { rows: [] }; };
    await listEvents({ page: 1, limit: 5 });
    assert.equal(n, 2);
  });

  it("adds LOWER(country) filter when country is provided", async () => {
    const sqlLog = [];
    mockQueryImpl = async (sql) => { sqlLog.push(sql); return { rows: [] }; };
    await listEvents({ page: 1, limit: 10, country: "France" });
    assert.ok(sqlLog[0].includes("LOWER(country)"), "Should include country filter");
  });

  it("adds LOWER(type) filter when type is provided", async () => {
    const sqlLog = [];
    mockQueryImpl = async (sql) => { sqlLog.push(sql); return { rows: [] }; };
    await listEvents({ page: 1, limit: 10, type: "war" });
    assert.ok(sqlLog[0].includes("LOWER(type)"), "Should include type filter");
  });

  it("adds LOWER(source) filter when source is provided", async () => {
    const sqlLog = [];
    mockQueryImpl = async (sql) => { sqlLog.push(sql); return { rows: [] }; };
    await listEvents({ page: 1, limit: 10, source: "news" });
    assert.ok(sqlLog[0].includes("LOWER(source)"), "Should include source filter");
  });

  it("adds INTERVAL filter when days is provided", async () => {
    const sqlLog = [];
    mockQueryImpl = async (sql) => { sqlLog.push(sql); return { rows: [] }; };
    await listEvents({ page: 1, limit: 10, days: "7" });
    assert.ok(sqlLog[0].includes("INTERVAL"), "Should include days filter");
  });

  it("adds ST_MakeEnvelope filter when a valid 4-element bbox is provided", async () => {
    const sqlLog = [];
    mockQueryImpl = async (sql) => { sqlLog.push(sql); return { rows: [] }; };
    await listEvents({ page: 1, limit: 10, bbox: [-5, 40, 10, 55] });
    assert.ok(sqlLog[0].includes("ST_MakeEnvelope"), "Should include bbox spatial filter");
  });

  it("omits the bbox filter when bbox array length is wrong", async () => {
    const sqlLog = [];
    mockQueryImpl = async (sql) => { sqlLog.push(sql); return { rows: [] }; };
    await listEvents({ page: 1, limit: 10, bbox: [-5, 40, 10] }); // only 3 items
    assert.ok(!sqlLog[0].includes("ST_MakeEnvelope"), "Should skip malformed bbox");
  });
});

// --- insertEvents -------------------------------------------------------------

describe("insertEvents", () => {
  beforeEach(() => {
    mockClientQueryImpl = async () => ({ rows: [] });
    mockClientRelease.calls = 0;
  });

  it("returns 0 for an empty events array", async () => {
    assert.equal(await insertEvents([]), 0);
  });

  it("begins and commits a transaction", async () => {
    const sqlLog = [];
    mockClientQueryImpl = async (sql) => {
      sqlLog.push(sql.trim().split("\n")[0].trim());
      return sql.includes("SELECT id") ? { rows: [] } : { rows: [] };
    };
    await insertEvents([EVENT]);
    assert.ok(sqlLog.includes("BEGIN"), "Should issue BEGIN");
    assert.ok(sqlLog.includes("COMMIT"), "Should issue COMMIT");
  });

  it("releases the client after a successful insert", async () => {
    mockClientQueryImpl = async (sql) => sql.includes("SELECT id") ? { rows: [] } : { rows: [] };
    await insertEvents([EVENT]);
    assert.ok(mockClientRelease.calls > 0, "Should call client.release()");
  });

  it("issues a ROLLBACK and releases client on query error", async () => {
    const sqlLog = [];
    let n = 0;
    mockClientQueryImpl = async (sql) => {
      sqlLog.push(sql.trim().split("\n")[0].trim());
      n++;
      if (n === 1) return {}; // BEGIN succeeds
      if (sql.includes("SELECT id")) throw new Error("simulated DB error");
      return {};
    };
    await assert.rejects(() => insertEvents([EVENT]), /simulated DB error/);
    assert.ok(sqlLog.includes("ROLLBACK"), "Should issue ROLLBACK on error");
    assert.ok(mockClientRelease.calls > 0, "Should release client even after error");
  });

  it("returns the count of inserted/updated rows", async () => {
    mockClientQueryImpl = async (sql) => sql.includes("SELECT id") ? { rows: [] } : { rows: [] };
    const result = await insertEvents([
      EVENT,
      { ...EVENT, id: "bbbbbbbb-2222-2222-2222-222222222222", externalId: "ext-002" },
    ]);
    assert.equal(result, 2);
  });

  it("issues an UPDATE (not INSERT) when a spatial duplicate is found", async () => {
    const sqlLog = [];
    mockClientQueryImpl = async (sql) => {
      sqlLog.push(sql.trim().replace(/\s+/g, " "));
      if (sql.includes("SELECT id")) {
        return { rows: [{ id: EVENT.id, title: "Old title", weight: 3, confidence: 0.5, source: "gdelt" }] };
      }
      return { rows: [] };
    };
    await insertEvents([EVENT]);
    assert.ok(sqlLog.some((s) => s.startsWith("UPDATE events")), "Should UPDATE a duplicate");
    assert.equal(sqlLog.some((s) => s.startsWith("INSERT INTO events")), false, "Should NOT INSERT a duplicate");
  });

  it("issues an INSERT when no duplicate is found", async () => {
    const sqlLog = [];
    mockClientQueryImpl = async (sql) => {
      sqlLog.push(sql.trim().replace(/\s+/g, " "));
      return sql.includes("SELECT id") ? { rows: [] } : { rows: [] };
    };
    await insertEvents([EVENT]);
    assert.ok(sqlLog.some((s) => s.startsWith("INSERT INTO events")), "Should INSERT a new event");
  });
});
