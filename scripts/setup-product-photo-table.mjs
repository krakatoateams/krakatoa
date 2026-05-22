/**
 * Creates product_photo_generations on your remote Supabase project.
 *
 * Option A — Management API (recommended):
 *   1. https://supabase.com/dashboard/account/tokens → New token
 *   2. Add to .env.local: SUPABASE_ACCESS_TOKEN=sbp_...
 *   3. npm run db:setup-product-photo
 *
 * Option B — Direct Postgres:
 *   Add to .env.local from Dashboard → Settings → Database → Connection string (URI):
 *   DATABASE_URL=postgresql://postgres.[ref]:[PASSWORD]@...
 *   npm run db:setup-product-photo
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const envPath = resolve(root, ".env.local");

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

const sql = readFileSync(
  resolve(root, "supabase/migrations/001_product_photo_generations.sql"),
  "utf8"
);

async function viaManagementApi() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token || !PROJECT_REF) return false;

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
  if (!res.ok) {
    throw new Error(`Management API ${res.status}: ${body}`);
  }
  console.log("[ok] Table created via Supabase Management API");
  return true;
}

async function viaPostgres() {
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
    console.log("[ok] Table created via direct Postgres connection");
    return true;
  } finally {
    await client.end();
  }
}

async function verify() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;

  const res = await fetch(
    `${url}/rest/v1/product_photo_generations?select=id&limit=1`,
    {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    }
  );
  if (res.status === 200) {
    console.log("[ok] Verified: product_photo_generations is visible to the API");
  } else {
    console.warn(`[warn] Verify returned HTTP ${res.status} — reload schema may take a few seconds`);
  }
}

async function main() {
  if (!PROJECT_REF) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL in .env.local");
    process.exit(1);
  }

  console.log(`Project: ${PROJECT_REF}`);

  if (await viaManagementApi()) {
    await verify();
    return;
  }

  if (await viaPostgres()) {
    await verify();
    return;
  }

  console.error(`
Could not run migration automatically. Add ONE of these to .env.local:

  SUPABASE_ACCESS_TOKEN=sbp_...   (from https://supabase.com/dashboard/account/tokens)

  DATABASE_URL=postgresql://...   (from Dashboard → Settings → Database → URI)

Then run: npm run db:setup-product-photo

Or paste this SQL in Dashboard → SQL Editor:
https://supabase.com/dashboard/project/${PROJECT_REF}/sql/new
`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
