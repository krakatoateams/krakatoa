import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import {
  type WelcomeBonusSettings,
  getWelcomeBonusSettings,
  updateWelcomeBonusSettings,
} from "@/lib/welcome-bonus-settings-db";

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
      const raw = body.creditAmount;
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isInteger(n) || n < 0) {
        return NextResponse.json(
          { error: "creditAmount must be a non-negative whole number." },
          { status: 400 }
        );
      }
      patch.creditAmount = n;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
    }

    const settings = await updateWelcomeBonusSettings(patch, ctx.profile.id);
    return NextResponse.json({ settings });
  });
}
