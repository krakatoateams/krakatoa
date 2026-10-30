import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import { listProviderModelCosts, updateProviderModelCost } from "@/lib/provider-model-costs-db";

// Per-(provider, model) provider cost (admin only). Margin/analytics only: billing
// does not read it (user price is pricing_configs.credit_amount).
export const dynamic = "force-dynamic";

export async function GET() {
  return withAdmin(async () => NextResponse.json({ costs: await listProviderModelCosts() }));
}

const COST_USD_MAX = 1_000;

export async function PATCH(req: Request) {
  return withAdmin(async (ctx) => {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const { provider, model, pricing_key, cost_usd } = body ?? {};
    if (
      typeof provider !== "string" || typeof model !== "string" || typeof pricing_key !== "string" ||
      !provider || !model || !pricing_key
    ) {
      return NextResponse.json({ error: "provider, model and pricing_key are required." }, { status: 400 });
    }
    if (typeof cost_usd !== "number" || !Number.isFinite(cost_usd) || cost_usd < 0 || cost_usd > COST_USD_MAX) {
      return NextResponse.json({ error: `cost_usd must be a number between 0 and ${COST_USD_MAX}.` }, { status: 400 });
    }
    const cost = await updateProviderModelCost({ provider, model, pricing_key }, cost_usd, ctx.profile.id);
    if (!cost) return NextResponse.json({ error: "Provider cost row not found." }, { status: 404 });
    return NextResponse.json({ cost });
  });
}
