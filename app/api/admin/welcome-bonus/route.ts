import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import {
  type WelcomeBonusSettings,
  getWelcomeBonusSettings,
  updateWelcomeBonusSettings,
} from "@/lib/welcome-bonus-settings-db";
import { parseWelcomeBonusCreditAmount } from "@/lib/welcome-bonus-validation";

export const dynamic = "force-dynamic";

/** GET /api/admin/welcome-bonus — current welcome-bonus config. */
export async function GET() {
  return withAdmin(async () => {
    const settings = await getWelcomeBonusSettings();
    return NextResponse.json({ settings });
  });
}

/**
 * PATCH /api/admin/welcome-bonus — update the enable toggle and/or amount.
 * Body: { enabled?: boolean, creditAmount?: number }.
 */
export async function PATCH(req: Request) {
  return withAdmin(async (ctx) => {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const patch: Partial<WelcomeBonusSettings> = {};

    if ("enabled" in body) {
      if (typeof body.enabled !== "boolean") {
        return NextResponse.json({ error: "enabled must be a boolean." }, { status: 400 });
      }
      patch.enabled = body.enabled;
    }

    if ("creditAmount" in body) {
      const result = parseWelcomeBonusCreditAmount(body.creditAmount);
      if (!result.ok) {
        return NextResponse.json(
          { error: result.error },
          { status: 400 }
        );
      }
      patch.creditAmount = result.value;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
    }

    const settings = await updateWelcomeBonusSettings(patch, ctx.profile.id);
    return NextResponse.json({ settings });
  });
}
