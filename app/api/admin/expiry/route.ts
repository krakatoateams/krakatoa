import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import {
  type ExpirySettings,
  getExpirySettings,
  updateExpirySettings,
} from "@/lib/expiry-settings-db";

export const dynamic = "force-dynamic";

/** Editable settings fields mapped to their JSON body keys. */
const FIELDS: (keyof ExpirySettings)[] = [
  "regularCreditDays",
  "purchaseBonusCreditDays",
  "newUserBonusCreditDays",
  "photoCreationDays",
  "videoCreationDays",
];

/**
 * Coerce an incoming value to a non-negative integer number of days or null.
 * Returns `undefined` (skip) when the key is absent, and throws on invalid input
 * (negative, non-integer, wrong type).
 */
function parseDays(raw: unknown, label: string): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${label} must be a non-negative whole number of days, or blank for never.`);
  }
  return n;
}

/** GET /api/admin/expiry — current expiry settings. */
export async function GET() {
  return withAdmin(async () => {
    const settings = await getExpirySettings();
    return NextResponse.json({ settings });
  });
}

/** PATCH /api/admin/expiry — update one or more expiry durations. */
export async function PATCH(req: Request) {
  return withAdmin(async (ctx) => {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const patch: Partial<ExpirySettings> = {};
    try {
      for (const field of FIELDS) {
        const parsed = parseDays(body[field], field);
        if (parsed !== undefined) patch[field] = parsed;
      }
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Invalid value." },
        { status: 400 }
      );
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
    }

    const settings = await updateExpirySettings(patch, ctx.profile.id);
    return NextResponse.json({ settings });
  });
}
