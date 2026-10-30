import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import { applyFeatureModelChange } from "@/lib/model-config-change";
import { dbModelChangeStore } from "@/lib/model-config-change-db";

// Update a per-feature model row by id (admin only). Accepts only `enabled` and
// `is_default` booleans. Setting is_default=true clears the previous default for
// the same feature (single default per feature is enforced in the DB layer).
// Guarded: the last enabled model of a feature and an unreplaced default are refused (409), and
// `expectedUpdatedAt` is compare-and-set (409 STALE_MODEL_CONFIG). Changes are audited.
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

    const patch: { enabled?: boolean; is_default?: boolean } = {};
    if ("enabled" in body) {
      if (typeof body.enabled !== "boolean") {
        return NextResponse.json({ error: "`enabled` must be a boolean." }, { status: 400 });
      }
      patch.enabled = body.enabled;
    }
    if ("is_default" in body) {
      if (typeof body.is_default !== "boolean") {
        return NextResponse.json({ error: "`is_default` must be a boolean." }, { status: 400 });
      }
      patch.is_default = body.is_default;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
    }

    const warnings: string[] = [];
    // A default model must be usable: warn (don't block) if it's also being disabled.
    if (patch.is_default === true && patch.enabled === false) {
      warnings.push("A disabled model cannot be the default; enable it to use as default.");
    }

    const { status, body: out } = await applyFeatureModelChange(dbModelChangeStore, {
      id: params.id,
      patch,
      expectedUpdatedAt: body.expectedUpdatedAt,
      actorProfileId: ctx.profile.id,
    });
    return NextResponse.json(status === 200 ? { ...out, warnings } : out, { status });
  });
}
