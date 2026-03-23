import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { geocodeLocation } from "../geocodeLocation.js";

describe("geocodeLocation", () => {
  let originalFetch;

  before(() => {
    originalFetch = globalThis.fetch;
  });

  after(() => {
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    // Reset to a failing stub by default; individual tests override as needed
    globalThis.fetch = async () => {
      throw new Error("fetch not mocked for this test");
    };
  });

  it("returns lat/lon when Nominatim returns results", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => [{ lat: "48.8534", lon: "2.3488" }],
    });

    const result = await geocodeLocation("Paris", "France");
    assert.ok(result !== null);
    assert.equal(result.lat, 48.8534);
    assert.equal(result.lon, 2.3488);
  });

  it("returns null when Nominatim returns an empty array", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => [],
    });

    const result = await geocodeLocation("NowhereCity", "NowhereCountry");
    assert.equal(result, null);
  });

  it("returns null when fetch response is not ok (HTTP error)", async () => {
    globalThis.fetch = async () => ({
      ok: false,
      json: async () => null,
    });

    const result = await geocodeLocation("Paris", "France");
    assert.equal(result, null);
  });

  it("returns null and does not call fetch when both city and country are empty", async () => {
    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return { ok: true, json: async () => [] };
    };

    const result = await geocodeLocation("", "");
    assert.equal(result, null);
    assert.equal(fetchCalled, false, "fetch should not be called for empty query");
  });

  it("returns null and does not call fetch when city and country are whitespace only", async () => {
    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return { ok: true, json: async () => [] };
    };

    const result = await geocodeLocation("   ", "   ");
    assert.equal(result, null);
    assert.equal(fetchCalled, false, "fetch should not be called for whitespace-only query");
  });

  it("uses only country when city is empty", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => [{ lat: "48.85", lon: "2.35" }] };
    };

    await geocodeLocation("", "France");
    assert.ok(capturedUrl.includes("France"), "URL should include the country name");
  });

  it("encodes special characters in the query", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => [{ lat: "-23.5", lon: "-46.6" }] };
    };

    await geocodeLocation("São Paulo", "Brazil");
    // "ã" encodes as %C3%A3
    assert.ok(capturedUrl.includes("%C3%A3") || capturedUrl.includes("S%C3%A3o"), "URL should percent-encode special characters");
  });

  it("sends User-Agent and Accept-Language headers", async () => {
    let capturedInit;
    globalThis.fetch = async (url, init) => {
      capturedInit = init;
      return { ok: true, json: async () => [{ lat: "55.7", lon: "37.6" }] };
    };

    await geocodeLocation("Moscow", "Russia");
    assert.equal(capturedInit?.headers?.["User-Agent"], "global-tension-map/0.1");
    assert.equal(capturedInit?.headers?.["Accept-Language"], "en");
  });

  it("returns lat and lon as numbers, not strings", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => [{ lat: "51.5074", lon: "-0.1278" }],
    });

    const result = await geocodeLocation("London", "United Kingdom");
    assert.equal(typeof result.lat, "number");
    assert.equal(typeof result.lon, "number");
  });
});
