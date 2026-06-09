import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import { updateModelConfig, type ModelConfigPatch } from "@/lib/model-configs-db";

// Update a model config by id (admin only). Only safe fields are accepted
// (provider, model, enabled, is_default, parameters, metadata). There is no
// secret/API-key field, so this can never expose or mutate credentials.
//
// PHASE ADMIN 1: editing here updates the DB row only. Generation routes still
// use their hardcoded model IDs and will NOT read this until Phase Admin 2 wires
// a model resolver (with fallback).
export const dynamic = "force-dynamic";

// Defense-in-depth: reject anything that smells like a secret in parameters.
const SECRET_KEY_RE = /(secret|token|api[_-]?key|password|credential|authorization)/i;

function containsSecretKey(obj: Record<string, unknown>): boolean {
  return Object.keys(obj).some((k) => SECRET_KEY_RE.test(k));
}

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

    const patch: ModelConfigPatch = {};
    if (typeof body.provider === "string") patch.provider = body.provider;
    if (typeof body.model === "string") patch.model = body.model;
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (typeof body.is_default === "boolean") patch.is_default = body.is_default;
    if (body.parameters && typeof body.parameters === "object") {
      const parameters = body.parameters as Record<string, unknown>;
      if (containsSecretKey(parameters)) {
        return NextResponse.json(
          { error: "Secrets/API keys are not allowed in model parameters." },
          { status: 400 }
        );
      }
      patch.parameters = parameters;
    }
    if (body.metadata && typeof body.metadata === "object")
      patch.metadata = body.metadata as Record<string, unknown>;

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
    }

    const model = await updateModelConfig(params.id, patch, ctx.profile.id);
    if (!model) {
      return NextResponse.json({ error: "Model config not found." }, { status: 404 });
    }
    return NextResponse.json({ model });
  });
}
