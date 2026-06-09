import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import { updatePricingConfig } from "@/lib/pricing-configs-db";
import { getPricingDefault } from "@/lib/admin-config-defaults";
import { validatePricingPatch } from "@/lib/admin-config-validation";

// Reset a pricing config to its canonical default (Admin Phase 2.5).
// Admin-gated. Updates the existing row (never delete/reinsert) via the shared
// update helper, so updated_by_profile_id is recorded. The default is run through
// the same validator the PATCH route uses, so reset can never bypass validation.
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: { pricing_key: string } }
) {
  return withAdmin(async (ctx) => {
    const def = getPricingDefault(params.pricing_key);
    if (!def) {
      return NextResponse.json(
        { error: "No canonical default exists for this pricing key." },
        { status: 404 }
      );
    }

    // Build the reset body, including Pricing Config v2.1 fields when the default
    // is a v2 row. provider_cost_usd === undefined on legacy rows means we reset
    // it back to null (the default for a non-v2 row).
    const result = validatePricingPatch({
      pricing_type: def.pricing_type,
      credit_amount: def.credit_amount,
      enabled: def.enabled,
      provider_cost_usd: def.provider_cost_usd ?? null,
      cost_unit: def.cost_unit ?? null,
      pricing_group: def.pricing_group ?? null,
      variant_key: def.variant_key ?? null,
      currency: def.currency ?? "USD",
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    const pricing = await updatePricingConfig(params.pricing_key, result.patch, ctx.profile.id);
    if (!pricing) {
      return NextResponse.json({ error: "Pricing config not found." }, { status: 404 });
    }
    return NextResponse.json({ pricing, warnings: result.warnings, reset: true });
  });
}
