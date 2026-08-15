import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import {
  type WelcomeOfferSettings,
  getWelcomeOfferSettings,
  updateWelcomeOfferSettings,
} from "@/lib/welcome-offer-settings-db";

export const dynamic = "force-dynamic";

/** GET /api/admin/welcome-offer — current welcome-offer config. */
export async function GET() {
  return withAdmin(async () => {
    const settings = await getWelcomeOfferSettings();
    return NextResponse.json({ settings });
  });
}

/**
 * PATCH /api/admin/welcome-offer — update the enable toggle.
 * Body: { enabled?: boolean }.
 */
export async function PATCH(req: Request) {
  return withAdmin(async (ctx) => {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const patch: Partial<WelcomeOfferSettings> = {};

    if ("enabled" in body) {
      if (typeof body.enabled !== "boolean") {
        return NextResponse.json({ error: "enabled must be a boolean." }, { status: 400 });
      }
      patch.enabled = body.enabled;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
    }

    const settings = await updateWelcomeOfferSettings(patch, ctx.profile.id);
    return NextResponse.json({ settings });
  });
}
