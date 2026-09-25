import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import {
  getUsdCheckoutSettings,
  updateUsdCheckoutSettings,
} from "@/lib/usd-checkout-settings-db";

export const dynamic = "force-dynamic";

export async function GET() {
  return withAdmin(async () => {
    const settings = await getUsdCheckoutSettings();
    return NextResponse.json({ settings });
  });
}

export async function PATCH(req: Request) {
  return withAdmin(async (ctx) => {
    const body = (await req.json().catch(() => null)) as { enabled?: unknown } | null;
    if (!body || typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be a boolean." }, { status: 400 });
    }
    const settings = await updateUsdCheckoutSettings(body.enabled, ctx.profile.id);
    return NextResponse.json({ settings });
  });
}
