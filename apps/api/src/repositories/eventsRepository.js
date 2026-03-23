import { dbGetClient, dbQuery, isDbConfigured } from "../db.js";

export async function listEvents({ page, limit, country, type, days, source, bbox }) {
  if (!isDbConfigured()) {
    return null;
  }

  const filters = [];
  const params = [];

  if (country) {
    params.push(country);
    filters.push(`LOWER(country) = LOWER($${params.length})`);
  }

  if (type) {
    params.push(type);
    filters.push(`LOWER(type) = LOWER($${params.length})`);
  }

  if (days) {
    params.push(days);
    filters.push(`date >= NOW() - ($${params.length}::int * INTERVAL '1 day')`);
  }

  if (source) {
    params.push(source);
    filters.push(`LOWER(source) = LOWER($${params.length})`);
  }

  if (bbox && bbox.length === 4) {
    params.push(...bbox);
    filters.push(
      `geom::geometry && ST_MakeEnvelope($${params.length - 3}, $${params.length - 2}, $${params.length - 1}, $${params.length}, 4326)`
    );
  }

  const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  const countResult = await dbQuery(`SELECT COUNT(*)::int AS total FROM events ${whereClause}`, params);
  const total = countResult.rows[0]?.total || 0;

  const offset = (page - 1) * limit;
  const pageParams = [...params, limit, offset];

  const rowsResult = await dbQuery(
    `
      SELECT id, title, country, lat, lon, type, weight, confidence, date, source
      FROM events
      ${whereClause}
      ORDER BY date DESC
      LIMIT $${pageParams.length - 1}
      OFFSET $${pageParams.length}
    `,
    pageParams
  );

  return {
    total,
    page,
    limit,
    items: rowsResult.rows,
  };
}

export async function insertEvents(events) {
  if (!isDbConfigured() || events.length === 0) {
    return 0;
  }
  const client = await dbGetClient();

  try {
    await client.query("BEGIN");
    let affected = 0;

    for (const event of events) {
      const duplicateResult = await client.query(
        `
          SELECT id, title, weight, confidence, source
          FROM events
          WHERE LOWER(country) = LOWER($1)
            AND type = $2
            AND date BETWEEN $3::timestamptz - INTERVAL '24 hours' AND $3::timestamptz + INTERVAL '24 hours'
            AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, 50000)
          ORDER BY confidence DESC, weight DESC, date DESC
          LIMIT 1
        `,
        [event.country, event.type, event.date, event.lon, event.lat]
      );

      const duplicate = duplicateResult.rows[0];

      if (duplicate) {
        await client.query(
          `
            UPDATE events
            SET
              title = CASE WHEN LENGTH($2) > LENGTH(title) THEN $2 ELSE title END,
              weight = GREATEST(weight, $3),
              confidence = GREATEST(confidence, $4),
              source = CASE WHEN $4 >= confidence THEN $5 ELSE source END,
              date = CASE WHEN $6::timestamptz > date THEN $6::timestamptz ELSE date END
            WHERE id = $1::uuid
          `,
          [duplicate.id, event.title, event.weight, event.confidence ?? 0.6, event.source, event.date]
        );
        affected += 1;
        continue;
      }

      await client.query(
        `
          INSERT INTO events (id, title, country, lat, lon, geom, type, weight, confidence, date, source, external_id)
          VALUES ($1::uuid, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (source, external_id)
          DO UPDATE SET
            title = EXCLUDED.title,
            country = EXCLUDED.country,
            lat = EXCLUDED.lat,
            lon = EXCLUDED.lon,
            geom = EXCLUDED.geom,
            type = EXCLUDED.type,
            weight = GREATEST(events.weight, EXCLUDED.weight),
            confidence = GREATEST(events.confidence, EXCLUDED.confidence),
            date = EXCLUDED.date
        `,
        [
          event.id,
          event.title,
          event.country,
          event.lat,
          event.lon,
          event.type,
          event.weight,
          event.confidence ?? 0.6,
          event.date,
          event.source,
          event.externalId,
        ]
      );
      affected += 1;
    }

    await client.query("COMMIT");
    return affected;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
