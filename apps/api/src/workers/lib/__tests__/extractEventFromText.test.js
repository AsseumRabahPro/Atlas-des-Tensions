import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { extractEventFromText, isRelevantArticle } from "../extractEventFromText.js";

// ─── isRelevantArticle ───────────────────────────────────────────────────────

describe("isRelevantArticle", () => {
  it("returns true for article with 'war' in title", () => {
    assert.equal(isRelevantArticle({ title: "War erupts in the region", description: "", content: "" }), true);
  });

  it("returns true for article with 'attack' keyword", () => {
    assert.equal(isRelevantArticle({ title: "Missile attack on the capital", description: "", content: "" }), true);
  });

  it("returns true for 'protest' keyword in description", () => {
    assert.equal(
      isRelevantArticle({ title: "Breaking news", description: "Large protest erupts downtown", content: "" }),
      true
    );
  });

  it("returns true for 'drone' in content", () => {
    assert.equal(
      isRelevantArticle({ title: "Incident reported", description: "", content: "A drone was intercepted" }),
      true
    );
  });

  it("returns true for 'sanction' keyword", () => {
    assert.equal(isRelevantArticle({ title: "New sanction package announced", description: "", content: "" }), true);
  });

  it("returns false for unrelated article", () => {
    assert.equal(isRelevantArticle({ title: "New smartphone released", description: "Tech news", content: "" }), false);
  });

  it("returns false for sports article", () => {
    assert.equal(
      isRelevantArticle({ title: "Team wins championship", description: "Football match", content: "" }),
      false
    );
  });

  it("returns false when all fields are empty", () => {
    assert.equal(isRelevantArticle({ title: "", description: "", content: "" }), false);
  });

  it("is case-insensitive", () => {
    assert.equal(isRelevantArticle({ title: "RIOT IN CITY", description: "", content: "" }), true);
  });
});

// ─── extractEventFromText – heuristic path (no API key) ─────────────────────

describe("extractEventFromText – heuristic (no OPENAI_API_KEY)", () => {
  before(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it("detects Ukraine as country from city name Kyiv", async () => {
    const article = {
      title: "Heavy shelling near Kyiv continues",
      description: "Forces in Ukraine report ongoing conflict",
      content: "",
      publishedAt: "2024-01-15T10:00:00Z",
    };
    const result = await extractEventFromText(article);
    assert.equal(result.country, "Ukraine");
  });

  it("detects war type from invasion/battle keywords", async () => {
    const article = {
      title: "Full-scale military invasion begins",
      description: "Battle for capital city",
      content: "",
      publishedAt: "2024-01-15T10:00:00Z",
    };
    const result = await extractEventFromText(article);
    assert.equal(result.type, "war");
  });

  it("detects Iran from Tehran mention", async () => {
    const article = {
      title: "Protests in Tehran escalate",
      description: "Demonstrations across Iran",
      content: "",
      publishedAt: "2024-01-15T10:00:00Z",
    };
    const result = await extractEventFromText(article);
    assert.equal(result.country, "Iran");
  });

  it("confidence is between 0.5 and 0.8", async () => {
    const article = {
      title: "Sanctions imposed after conflict escalation",
      description: "",
      content: "",
      publishedAt: "2024-01-15T10:00:00Z",
    };
    const result = await extractEventFromText(article);
    assert.ok(result.confidence >= 0.5 && result.confidence <= 0.8, `confidence=${result.confidence} out of range`);
  });

  it("returns a valid ISO date string", async () => {
    const article = {
      title: "Attack on border region",
      description: "",
      content: "",
      publishedAt: "2024-01-15T10:00:00Z",
    };
    const result = await extractEventFromText(article);
    assert.ok(!Number.isNaN(new Date(result.date).getTime()), "date should be a valid ISO string");
  });

  it("uses fallback date (now) when publishedAt is missing", async () => {
    const before = Date.now();
    // Omit publishedAt entirely → article.publishedAt is undefined
    // toIsoDate(undefined) → new Date(undefined) = Invalid Date → returns null → fallback
    const article = { title: "Drone strike reported", description: "", content: "" };
    const result = await extractEventFromText(article);
    const after = Date.now();
    const resultTs = new Date(result.date).getTime();
    assert.ok(resultTs >= before && resultTs <= after + 2000, "Should use current date as fallback");
  });

  it("returns lower confidence when no country detected", async () => {
    const article = {
      title: "Unspecified conflict somewhere",
      description: "Some unspecified location",
      content: "",
      publishedAt: "2024-01-15T10:00:00Z",
    };
    const result = await extractEventFromText(article);
    assert.ok(result.confidence <= 0.65, "Low confidence when country is unknown");
  });
});

// ─── extractEventFromText – LLM path (mocked fetch) ─────────────────────────

describe("extractEventFromText – LLM path (mocked fetch)", () => {
  let originalFetch;

  before(() => {
    process.env.OPENAI_API_KEY = "test-key-not-real";
    originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                country: "Israel",
                city: "Tel Aviv",
                type: "attack",
                weight: 9,
                date: "2024-01-15T10:00:00Z",
                confidence: 0.75,
              }),
            },
          },
        ],
      }),
    });
  });

  after(() => {
    globalThis.fetch = originalFetch;
    delete process.env.OPENAI_API_KEY;
  });

  it("uses LLM country when API responds", async () => {
    const result = await extractEventFromText({
      title: "Attack in the Middle East",
      description: "Air strikes reported",
      content: "",
      publishedAt: "2024-01-15T10:00:00Z",
    });
    assert.equal(result.country, "Israel");
  });

  it("uses LLM type when API responds", async () => {
    const result = await extractEventFromText({
      title: "Attack in the Middle East",
      description: "Air strikes reported",
      content: "",
      publishedAt: "2024-01-15T10:00:00Z",
    });
    assert.equal(result.type, "attack");
  });

  it("clamps LLM confidence to [0.5, 0.8]", async () => {
    const result = await extractEventFromText({
      title: "Some event",
      description: "",
      content: "",
      publishedAt: "2024-01-15T10:00:00Z",
    });
    assert.ok(result.confidence >= 0.5 && result.confidence <= 0.8);
  });
});

// ─── extractEventFromText – LLM fallback when fetch fails ───────────────────

describe("extractEventFromText – falls back to heuristic when LLM errors", () => {
  let originalFetch;

  before(() => {
    process.env.OPENAI_API_KEY = "test-key-not-real";
    originalFetch = globalThis.fetch;
    // Simulate a failed LLM response
    globalThis.fetch = async () => ({ ok: false, json: async () => null });
  });

  after(() => {
    globalThis.fetch = originalFetch;
    delete process.env.OPENAI_API_KEY;
  });

  it("returns a result even when LLM call fails", async () => {
    const result = await extractEventFromText({
      title: "Battle near Kyiv continues",
      description: "Ukraine conflict Update",
      content: "",
      publishedAt: "2024-01-15T10:00:00Z",
    });
    assert.ok(result !== null);
    assert.ok(typeof result.type === "string");
  });
});
