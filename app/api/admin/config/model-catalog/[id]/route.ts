import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import { applyCatalogToggle } from "@/lib/model-config-change";
import { dbModelChangeStore } from "@/lib/model-config-change-db";

// Turn a catalog model on/off (admin only). Runs the server-side guard (last model, default,
// last Reels engine, pricing, provider), compare-and-sets on `expectedUpdatedAt` and audits.
// Runtime reads of enablement are uncached; in-flight jobs are never affected.
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return withAdmin(async (ctx) => {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    if (!("enabled" in body) || typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "`enabled` must be a boolean." }, { status: 400 });
    }

    const { status, body: out } = await applyCatalogToggle(dbModelChangeStore, {
      id: params.id,
      enabled: body.enabled,
      expectedUpdatedAt: body.expectedUpdatedAt,
      actorProfileId: ctx.profile.id,
    });
    return NextResponse.json(out, { status });
  });
}
