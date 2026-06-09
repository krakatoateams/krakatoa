import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import {
  updatePricingConfig,
  type PricingConfigPatch,
  type PricingType,
} from "@/lib/pricing-configs-db";

// Update a pricing config by pricing_key (admin only).
// PHASE ADMIN 1: editing here updates the DB row for display/config purposes
// only. Generation routes still use lib/credit-costs.ts constants and will NOT
// read this value until Phase Admin 2 wires a pricing resolver (with fallback).
export const dynamic = "force-dynamic";

const PRICING_TYPES: PricingType[] = ["fixed", "per_second", "per_image"];

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

    const patch: PricingConfigPatch = {};
    if (typeof body.display_name === "string") patch.display_name = body.display_name;
    if (
      typeof body.pricing_type === "string" &&
      PRICING_TYPES.includes(body.pricing_type as PricingType)
    ) {
      patch.pricing_type = body.pricing_type as PricingType;
    }
    if (typeof body.credit_amount === "number") {
      if (!Number.isInteger(body.credit_amount) || body.credit_amount < 0) {
        return NextResponse.json(
          { error: "credit_amount must be a non-negative integer." },
          { status: 400 }
        );
      }
      patch.credit_amount = body.credit_amount;
    }
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (body.metadata && typeof body.metadata === "object")
      patch.metadata = body.metadata as Record<string, unknown>;

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
    }

    const pricing = await updatePricingConfig(params.pricing_key, patch, ctx.profile.id);
    if (!pricing) {
      return NextResponse.json({ error: "Pricing config not found." }, { status: 404 });
    }
    return NextResponse.json({ pricing });
  });
}
