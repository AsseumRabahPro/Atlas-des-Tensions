import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL || "";
const hasDbConfig = connectionString.length > 0;

const pool = hasDbConfig
  ? new Pool({
      connectionString,
      ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
    })
  : null;

export function isDbConfigured() {
  return Boolean(pool);
}

export async function dbQuery(text, params = []) {
  if (!pool) {
    throw new Error("DATABASE_URL is not configured");
  }
  return pool.query(text, params);
}

export async function dbGetClient() {
  if (!pool) {
    throw new Error("DATABASE_URL is not configured");
  }

  return pool.connect();
}

export async function dbHealth() {
  if (!pool) {
    return { configured: false, ok: false };
  }

  try {
    await pool.query("SELECT 1");
    return { configured: true, ok: true };
  } catch {
    return { configured: true, ok: false };
  }
}
