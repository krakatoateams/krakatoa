import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import { ensureModelConfig, updateModelConfig } from "@/lib/model-configs-db";
import { listPricingConfigs } from "@/lib/pricing-configs-db";
import { photoTierPricingKeys } from "@/lib/product-photo";
import { creditAmountsForKeys, providerSwitchPricingError } from "@/lib/admin-config-validation";
import { isProviderConfigured, isSupportedProviderModel } from "@/lib/ai-provider-catalog";
import { photoSwitchTarget } from "@/lib/admin-provider-switch";
import { recordProviderChange } from "@/lib/admin-config-audit-db";

// Switch a Photo tier between catalog providers as ONE unit (provider + model + parameters)
// (admin only). The body names the tier and the provider only; the model and parameters
// always come from the code catalog. Takes effect within the resolver's ~60s cache.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return withAdmin(async (ctx) => {
    const body = (await req.json().catch(() => null)) as { config_key?: unknown; provider?: unknown } | null;
    const configKey = body?.config_key;
    const provider = body?.provider;
    if (typeof configKey !== "string" || typeof provider !== "string") {
      return NextResponse.json({ error: "config_key and provider are required." }, { status: 400 });
    }
    const target = photoSwitchTarget(configKey, provider);
    if (!target || !isSupportedProviderModel(target.provider, target.model, { toolKey: "photo", configKey })) {
      return NextResponse.json({ error: `Provider "${provider}" is not available for this model.` }, { status: 400 });
    }
    if (!isProviderConfigured(target.provider)) {
      return NextResponse.json({ error: `Provider "${target.provider}" is not configured on this server.` }, { status: 400 });
    }

    // Seed row = the Replicate default, so a missing row never starts on the new provider.
    const base = photoSwitchTarget(configKey, "replicate")!;
    const row = await ensureModelConfig({ tool_key: "photo", config_key: configKey, ...base });
    if (!row) return NextResponse.json({ error: "Model config not found." }, { status: 404 });

    if (target.provider !== row.provider) {
      const keys = photoTierPricingKeys(configKey);
      const amounts = keys ? creditAmountsForKeys(keys, await listPricingConfigs()) : null;
      const switchError = providerSwitchPricingError(row.provider, target.provider, amounts);
      if (switchError) return NextResponse.json({ error: switchError }, { status: 400 });
    }

    const model = await updateModelConfig(
      row.id,
      { provider: target.provider, model: target.model, parameters: target.parameters },
      ctx.profile.id
    );
    if (!model) return NextResponse.json({ error: "Model config not found." }, { status: 404 });
    await recordProviderChange({
      actorProfileId: ctx.profile.id,
      toolKey: "photo",
      configKey,
      from: row.provider,
      to: model.provider,
    });
    return NextResponse.json({ model });
  });
}
