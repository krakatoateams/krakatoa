import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import { updateFeatureModelConfig } from "@/lib/feature-model-configs-db";

// Update a per-feature model row by id (admin only). Accepts only `enabled` and
// `is_default` booleans. Setting is_default=true clears the previous default for
// the same feature (single default per feature is enforced in the DB layer).
// Runtime reads are cached ~60s, so changes may take up to a minute to apply.
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
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

    const featureModel = await updateFeatureModelConfig(params.id, patch, ctx.profile.id);
    if (!featureModel) {
      return NextResponse.json({ error: "Feature model config not found." }, { status: 404 });
    }
    return NextResponse.json({ featureModel, warnings });
  });
}
