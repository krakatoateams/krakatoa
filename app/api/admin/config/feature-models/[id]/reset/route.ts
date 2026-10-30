import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import { applyFeatureModelReset } from "@/lib/model-config-change";
import { dbModelChangeStore } from "@/lib/model-config-change-db";

// Reset a per-feature model row to its shipped code default (enabled=true; the default flag follows
// lib/creation-features.ts). Admin only. Runs the same guard (last model, unreplaced default, last
// Reels engine), compare-and-set on `expectedUpdatedAt` and audit as a normal edit.
export const dynamic = "force-dynamic";

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return withAdmin(async (ctx) => {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const { status, body: out } = await applyFeatureModelReset(dbModelChangeStore, {
      id: params.id,
      expectedUpdatedAt: body?.expectedUpdatedAt,
      actorProfileId: ctx.profile.id,
    });
    return NextResponse.json(out, { status });
  });
}
