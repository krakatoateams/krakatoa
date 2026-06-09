import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import { updateModelConfig } from "@/lib/model-configs-db";
import { validateModelPatch } from "@/lib/admin-config-validation";

// Update a model config by id (admin only). Only safe fields are accepted
// (provider, model, enabled, is_default, parameters, metadata). There is no
// secret/API-key field, so this can never expose or mutate credentials, and
// secret-like parameter keys are rejected by the shared validator.
//
// Phase Admin 2 wired the model resolver, so these values now affect new
// generations (with fallback to the hardcoded model IDs). A typo in a non-empty
// model id is treated as intentional and can fail at generation time. Validation
// is shared with the reset endpoint via lib/admin-config-validation.ts. Runtime
// changes may take up to ~60s (TTL cache). No external model validation is done.
export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  return withAdmin(async (ctx) => {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const result = validateModelPatch(body);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    if (Object.keys(result.patch).length === 0) {
      return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
    }

    const model = await updateModelConfig(params.id, result.patch, ctx.profile.id);
    if (!model) {
      return NextResponse.json({ error: "Model config not found." }, { status: 404 });
    }
    return NextResponse.json({ model, warnings: result.warnings });
  });
}
