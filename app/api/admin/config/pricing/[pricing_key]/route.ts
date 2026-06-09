import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import { updatePricingConfig } from "@/lib/pricing-configs-db";
import { validatePricingPatch } from "@/lib/admin-config-validation";

// Update a pricing config by pricing_key (admin only). Phase Admin 2 wired the
// pricing resolver, so these values now affect new generations (with fallback to
// lib/credit-costs.ts). Validation is shared with the reset endpoint via
// lib/admin-config-validation.ts. Runtime changes may take up to ~60s (TTL cache).
export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: { pricing_key: string } }
) {
  return withAdmin(async (ctx) => {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const result = validatePricingPatch(body);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    if (Object.keys(result.patch).length === 0) {
      return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
    }

    const pricing = await updatePricingConfig(params.pricing_key, result.patch, ctx.profile.id);
    if (!pricing) {
      return NextResponse.json({ error: "Pricing config not found." }, { status: 404 });
    }
    return NextResponse.json({ pricing, warnings: result.warnings });
  });
}
