import { dbQuery, isDbConfigured } from "../db.js";

const SCORE_FORMULA_SQL = `
  SUM(
    (CASE WHEN LOWER(type) IN ('war', 'attack') THEN weight * 1.5 ELSE weight END)
    * confidence
    * EXP(-(EXTRACT(EPOCH FROM (NOW() - date)) / 86400.0) / 7)
  )
`;

function buildOptionalFilters({ type, source }) {
  const params = [];
  const filters = [];

  if (type) {
    params.push(type);
    filters.push(`LOWER(type) = LOWER($${params.length})`);
  }

  if (source) {
    params.push(source);
    filters.push(`LOWER(source) = LOWER($${params.length})`);
  }

  return { params, filters };
}

function resolveSpikeThresholdMultiplier() {
  const raw = Number(process.env.SPIKE_THRESHOLD_MULTIPLIER);
  if (!Number.isFinite(raw) || raw <= 0) {
    return 2;
  }
  return raw;
}

export async function detectSpike(country, { type, source } = {}) {
  if (!isDbConfigured() || !country) {
    return false;
  }

  const params = [country];
  const filters = [`LOWER(country) = LOWER($1)`];

  if (type) {
    params.push(type);
    filters.push(`LOWER(type) = LOWER($${params.length})`);
  }

  if (source) {
    params.push(source);
    filters.push(`LOWER(source) = LOWER($${params.length})`);
  }

  const whereClause = `WHERE ${filters.join(" AND ")}`;
  const multiplier = resolveSpikeThresholdMultiplier();

  const result = await dbQuery(
    `
      WITH base AS (
        SELECT date
        FROM events
        ${whereClause}
          AND date >= NOW() - INTERVAL '7 days'
      ),
      stats AS (
        SELECT
          COUNT(*) FILTER (WHERE date >= NOW() - INTERVAL '6 hours')::float8 AS last_6h,
          COUNT(*)::float8 AS last_7d
        FROM base
      )
      SELECT
        CASE
          WHEN COALESCE(last_7d, 0) = 0 THEN FALSE
          ELSE last_6h > ((last_7d / 28.0) * $${params.length + 1})
        END AS spike
      FROM stats
    `,
    [...params, multiplier]
  );

  return Boolean(result.rows[0]?.spike);
}

async function buildSpikeMap(countries, filters) {
  const spikeMap = new Map();

  for (const country of countries) {
    spikeMap.set(country, await detectSpike(country, filters));
  }

  return spikeMap;
}

export async function listCountryScoresCached({ type, days, source } = {}) {
  if (!isDbConfigured()) {
    return null;
  }

  const { params, filters } = buildOptionalFilters({ type, source });

  if (days) {
    params.push(days);
    filters.push(`date >= NOW() - ($${params.length}::int * INTERVAL '1 day')`);
  }

  const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  const result = filters.length
    ? await dbQuery(
        `
          SELECT
            country,
            ROUND((${SCORE_FORMULA_SQL})::numeric, 2)::float8 AS score
          FROM events
          ${whereClause}
          GROUP BY country
          ORDER BY score DESC
        `,
        params
      )
    : await dbQuery("SELECT country, score FROM country_scores ORDER BY score DESC");

  const spikeMap = await buildSpikeMap(
    result.rows.map((row) => row.country),
    { type, source }
  );

  return result.rows.map((row) => ({
    ...row,
    spike: spikeMap.get(row.country) || false,
  }));
}

export async function refreshCountryScoresCache() {
  if (!isDbConfigured()) {
    return 0;
  }

  const scoreResult = await dbQuery(`
    SELECT
      country,
      ROUND((${SCORE_FORMULA_SQL})::numeric, 2)::float8 AS score
    FROM events
    GROUP BY country
  `);

  if (scoreResult.rows.length === 0) {
    return 0;
  }

  const values = [];
  const placeholders = [];

  scoreResult.rows.forEach((row, index) => {
    const base = index * 2;
    placeholders.push(`($${base + 1}, $${base + 2}, NOW())`);
    values.push(row.country, row.score);
  });

  await dbQuery(
    `
      INSERT INTO country_scores (country, score, updated_at)
      VALUES ${placeholders.join(",")}
      ON CONFLICT (country)
      DO UPDATE SET score = EXCLUDED.score, updated_at = EXCLUDED.updated_at
    `,
    values
  );

  return scoreResult.rows.length;
}
