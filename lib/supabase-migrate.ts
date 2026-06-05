import { readFileSync } from "fs";
import { join } from "path";

export const SUPABASE_PROJECT_REF =
  process.env.SUPABASE_PROJECT_REF ||
  process.env.NEXT_PUBLIC_SUPABASE_URL?.match(
    /https:\/\/([^.]+)\.supabase\.co/
  )?.[1];

export function readMigration(filename: string): string {
  return readFileSync(
    join(process.cwd(), "supabase/migrations", filename),
    "utf8"
  );
}

/** Runs raw SQL via Supabase Management API (needs SUPABASE_ACCESS_TOKEN). */
export async function runSupabaseSql(
  sql: string,
  label: string
): Promise<{ ok: true } | { ok: false; status: number; body: string }> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token || !SUPABASE_PROJECT_REF) {
    return {
      ok: false,
      status: 400,
      body: "Missing SUPABASE_ACCESS_TOKEN or project ref.",
    };
  }

  const res = await fetch(
    `https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query`,
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
    return { ok: false, status: res.status, body };
  }

  console.log(`[ok] ${label}`);
  return { ok: true };
}

export async function verifyUserCreationsTable(): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return false;

  const res = await fetch(`${url}/rest/v1/user_creations?select=id&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  return res.status === 200;
}
