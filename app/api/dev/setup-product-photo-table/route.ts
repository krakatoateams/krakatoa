import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

const PROJECT_REF = process.env.NEXT_PUBLIC_SUPABASE_URL?.match(
  /https:\/\/([^.]+)\.supabase\.co/
)?.[1];

function migrationSql(): string {
  return readFileSync(
    join(process.cwd(), "supabase/migrations/001_product_photo_generations.sql"),
    "utf8"
  );
}

/**
 * Dev-only: creates product_photo_generations via Supabase Management API.
 * GET /api/dev/setup-product-photo-table
 * Header: x-setup-key: <SETUP_DB_KEY or NEXTAUTH_SECRET>
 * Requires SUPABASE_ACCESS_TOKEN in .env.local
 */
export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production." }, { status: 404 });
  }

  const expected =
    process.env.SETUP_DB_KEY || process.env.NEXTAUTH_SECRET || "";
  const provided = req.headers.get("x-setup-key") || "";
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token || !PROJECT_REF) {
    return NextResponse.json(
      {
        error: "Missing SUPABASE_ACCESS_TOKEN.",
        hint: "Create a token at https://supabase.com/dashboard/account/tokens and add it to .env.local, then call this route again. Or run npm run db:setup-product-photo.",
      },
      { status: 400 }
    );
  }

  try {
    const res = await fetch(
      `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: migrationSql() }),
      }
    );

    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json({ error: text }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      message: "product_photo_generations table created. Refresh Product Photo.",
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
