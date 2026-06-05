import { NextResponse } from "next/server";
import {
  readMigration,
  runSupabaseSql,
  SUPABASE_PROJECT_REF,
  verifyUserCreationsTable,
} from "@/lib/supabase-migrate";

export const dynamic = "force-dynamic";

/**
 * Dev-only: apply supabase/migrations via Management API.
 * GET /api/dev/setup-db?file=002_user_creations.sql
 * Header: x-setup-key: <SETUP_DB_KEY or NEXTAUTH_SECRET>
 */
export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production." }, { status: 404 });
  }

  const expected = process.env.SETUP_DB_KEY || process.env.NEXTAUTH_SECRET || "";
  const provided = req.headers.get("x-setup-key") || "";
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!process.env.SUPABASE_ACCESS_TOKEN) {
    return NextResponse.json(
      {
        error: "Missing SUPABASE_ACCESS_TOKEN.",
        projectRef: SUPABASE_PROJECT_REF,
        hint: "Add a personal access token from https://supabase.com/dashboard/account/tokens to .env.local, then call this route again. Or connect the Supabase MCP server in Cursor (see .cursor/mcp.json) and run apply_migration.",
        sqlEditor: SUPABASE_PROJECT_REF
          ? `https://supabase.com/dashboard/project/${SUPABASE_PROJECT_REF}/sql/new`
          : undefined,
      },
      { status: 400 }
    );
  }

  const { searchParams } = new URL(req.url);
  const file =
    searchParams.get("file") || "002_user_creations.sql";

  try {
    const sql = readMigration(file);
    const result = await runSupabaseSql(sql, file);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.body, file },
        { status: result.status }
      );
    }

    const verified = await verifyUserCreationsTable();

    return NextResponse.json({
      ok: true,
      file,
      verified,
      message: verified
        ? "user_creations is ready. Refresh the dashboard."
        : "Migration ran; refresh PostgREST schema cache in Dashboard if the table still 404s.",
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
