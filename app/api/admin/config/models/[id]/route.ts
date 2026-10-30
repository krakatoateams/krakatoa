import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import { getModelConfigById, updateModelConfig } from "@/lib/model-configs-db";
import { listPricingConfigs } from "@/lib/pricing-configs-db";
import { photoTierPricingKeys } from "@/lib/product-photo";
import { creditAmountsForKeys, providerSwitchPricingError, validateModelPatch } from "@/lib/admin-config-validation";
import { photoPatchUnit } from "@/lib/admin-provider-switch";
import { isProviderConfigured } from "@/lib/ai-provider-catalog";
import { recordProviderChange } from "@/lib/admin-config-audit-db";

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

export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return withAdmin(async (ctx) => {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const row = await getModelConfigById(params.id);
    if (!row) {
      return NextResponse.json({ error: "Model config not found." }, { status: 404 });
    }

    const result = validateModelPatch(body, row);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    if (Object.keys(result.patch).length === 0) {
      return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
    }

    if (row.tool_key === "photo") {
      const unit = photoPatchUnit(row.config_key, row, result.patch);
      if (!unit.ok) return NextResponse.json({ error: unit.error }, { status: 400 });
      if (unit.parameters) result.patch.parameters = unit.parameters;
    }

    if (result.patch.provider && !isProviderConfigured(result.patch.provider)) {
      return NextResponse.json({ error: `Provider "${result.patch.provider}" is not configured on this server.` }, { status: 400 });
    }

    // User price stays ONE per feature: a provider switch needs fixed credit_amounts.
    if (result.patch.provider !== undefined && result.patch.provider !== row.provider) {
      const keys = row.tool_key === "photo" ? photoTierPricingKeys(row.config_key) : null;
      const amounts = keys ? creditAmountsForKeys(keys, await listPricingConfigs()) : null;
      const switchError = providerSwitchPricingError(row.provider, result.patch.provider, amounts);
      if (switchError) return NextResponse.json({ error: switchError }, { status: 400 });
    }

    const model = await updateModelConfig(params.id, result.patch, ctx.profile.id);
    if (!model) {
      return NextResponse.json({ error: "Model config not found." }, { status: 404 });
    }
    await recordProviderChange({
      actorProfileId: ctx.profile.id,
      toolKey: row.tool_key,
      configKey: row.config_key,
      from: row.provider,
      to: model.provider,
    });
    return NextResponse.json({ model, warnings: result.warnings });
  });
}
