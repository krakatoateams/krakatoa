/**
 * Applies all SQL files in supabase/migrations/ to your remote Supabase project.
 *
 * Option A — Management API:
 *   SUPABASE_ACCESS_TOKEN=sbp_...  (https://supabase.com/dashboard/account/tokens)
 *   npm run db:setup
 *
 * Option B — Direct Postgres:
 *   DATABASE_URL=postgresql://...  (Dashboard → Settings → Database → URI)
 *   npm run db:setup
 */

import { readFileSync, existsSync, readdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const envPath = resolve(root, ".env.local");
const migrationsDir = resolve(root, "supabase/migrations");

function loadEnv() {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const key = t.slice(0, i);
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnv();

const PROJECT_REF =
  process.env.SUPABASE_PROJECT_REF ||
  (process.env.NEXT_PUBLIC_SUPABASE_URL || "").match(
    /https:\/\/([^.]+)\.supabase\.co/
  )?.[1];

function migrationFiles() {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

async function runQuery(sql, label) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (token && PROJECT_REF) {
    const res = await fetch(
      `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: sql }),
      }
    );
    const body = await res.text();
    if (res.ok) {
      console.log(`[ok] ${label} (Management API)`);
      return true;
    }
    // ponytail: 403 = token lacks Management API scope — fall through to Postgres
    // instead of failing the whole run when DATABASE_URL is available.
    if (res.status !== 403) {
      throw new Error(`${label} Management API ${res.status}: ${body}`);
    }
    console.warn(
      `[warn] ${label} Management API 403 (insufficient token privileges) — trying Postgres…`
    );
  }

  const connectionString =
    process.env.DATABASE_URL ||
    (process.env.SUPABASE_DB_PASSWORD && PROJECT_REF
      ? `postgresql://postgres.${PROJECT_REF}:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`
      : null);

  if (!connectionString) return false;

  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query(sql);
    console.log(`[ok] ${label} (Postgres)`);
    return true;
  } finally {
    await client.end();
  }
}

async function verify() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;

  const res = await fetch(`${url}/rest/v1/user_creations?select=id&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (res.status === 200) {
    console.log("[ok] Verified: user_creations is visible to the API");
  } else {
    console.warn(`[warn] Verify returned HTTP ${res.status}`);
  }
}

async function main() {
  if (!PROJECT_REF) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL in .env.local");
    process.exit(1);
  }

  console.log(`Project: ${PROJECT_REF}`);

  const files = migrationFiles();
  let hasCreds =
    !!process.env.SUPABASE_ACCESS_TOKEN ||
    !!process.env.DATABASE_URL ||
    !!process.env.SUPABASE_DB_PASSWORD;

  for (const file of files) {
    const sql = readFileSync(resolve(migrationsDir, file), "utf8");
    const ok = await runQuery(sql, file);
    if (ok === false) {
      hasCreds = false;
      break;
    }
  }

  if (!hasCreds) {
    console.error(`
Could not run migrations. Add to .env.local:

  SUPABASE_ACCESS_TOKEN=sbp_...
  or DATABASE_URL=postgresql://...

Then: npm run db:setup

Or paste each file in SQL Editor:
https://supabase.com/dashboard/project/${PROJECT_REF}/sql/new
`);
    process.exit(1);
  }

  await verify();
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
