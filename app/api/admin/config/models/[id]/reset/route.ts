import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import { getModelConfigById, updateModelConfig } from "@/lib/model-configs-db";
import { getModelDefault } from "@/lib/admin-config-defaults";
import { validateModelPatch } from "@/lib/admin-config-validation";

// Reset a model config to its canonical default (Admin Phase 2.5).
// Admin-gated. Resolves the row id -> (tool_key, config_key) to pick the default,
// then updates the existing row via the shared helper (records updated_by_profile_id).
// The default is run through the same validator the PATCH route uses.
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  return withAdmin(async (ctx) => {
    const row = await getModelConfigById(params.id);
    if (!row) {
      return NextResponse.json({ error: "Model config not found." }, { status: 404 });
    }

    const def = getModelDefault(row.tool_key, row.config_key);
    if (!def) {
      return NextResponse.json(
        { error: "No canonical default exists for this model config." },
        { status: 404 }
      );
    }

    const result = validateModelPatch({
      provider: def.provider,
      model: def.model,
      enabled: def.enabled,
      is_default: def.is_default,
      parameters: def.parameters,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    const model = await updateModelConfig(params.id, result.patch, ctx.profile.id);
    if (!model) {
      return NextResponse.json({ error: "Model config not found." }, { status: 404 });
    }
    return NextResponse.json({ model, warnings: result.warnings, reset: true });
  });
}
