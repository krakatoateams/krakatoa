import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import { applyCatalogArchive } from "@/lib/model-config-change";
import { dbModelChangeStore } from "@/lib/model-config-change-db";

// Restore a model (admin only). Same guard as hiding a model; CAS on `expectedUpdatedAt`; idempotent;
// audited. Past creations, pricing and in-flight jobs are untouched. 409 MIGRATION_REQUIRED until migration 118 is applied.
export const dynamic = "force-dynamic";

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return withAdmin(async (ctx) => {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }
    const { status, body: out } = await applyCatalogArchive(dbModelChangeStore, {
      id: params.id,
      archive: false,
      expectedUpdatedAt: body.expectedUpdatedAt,
      actorProfileId: ctx.profile.id,
    });
    return NextResponse.json(out, { status });
  });
}
