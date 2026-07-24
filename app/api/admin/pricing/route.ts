import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import {
  type AdminCreditPack,
  listAllCreditPacks,
  saveAllCreditPacks,
} from "@/lib/credit-packs-db";

export const dynamic = "force-dynamic";

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/i;

class ValidationError extends Error {}

/** Coerce + validate one incoming pack, throwing a ValidationError on bad input. */
function parsePack(raw: unknown, index: number): AdminCreditPack {
  if (!raw || typeof raw !== "object") {
    throw new ValidationError(`Tier ${index + 1} is malformed.`);
  }
  const r = raw as Record<string, unknown>;

  const id = typeof r.id === "string" ? r.id.trim() : "";
  if (!ID_RE.test(id)) {
    throw new ValidationError(
      `Tier ${index + 1}: id must be a short slug (letters, digits, "-", "_").`
    );
  }

  const intField = (v: unknown, name: string, min: number): number => {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isInteger(n) || n < min) {
      throw new ValidationError(`Tier "${id}": ${name} must be an integer ≥ ${min}.`);
    }
    return n;
  };

  const credits = intField(r.credits, "credits", 1);
  const bonusCredits = intField(r.bonusCredits ?? 0, "bonus credits", 0);
  const priceIdr = intField(r.priceIdr, "price", 0);

  const label = typeof r.label === "string" ? r.label.trim() : "";
  if (!label) throw new ValidationError(`Tier "${id}": label is required.`);
  if (label.length > 60) throw new ValidationError(`Tier "${id}": label is too long.`);

  return {
    id,
    credits,
    bonusCredits: bonusCredits || undefined,
    priceIdr,
    label,
    popular: r.popular === true || undefined,
    isActive: r.isActive !== false,
    sortOrder: index,
  };
}

/** GET /api/admin/pricing — all tiers (incl. inactive), sorted. */
export async function GET() {
  return withAdmin(async () => {
    const packs = await listAllCreditPacks();
    return NextResponse.json({ packs });
  });
}

/**
 * PUT /api/admin/pricing — replace the full tier set.
 * Body: { packs: AdminCreditPack[] }. Ordering follows array position; any
 * existing tier not present is deleted.
 */
export async function PUT(req: Request) {
  return withAdmin(async () => {
    const body = (await req.json().catch(() => null)) as { packs?: unknown } | null;
    if (!body || !Array.isArray(body.packs)) {
      return NextResponse.json({ error: "Body must be { packs: [...] }." }, { status: 400 });
    }

    let parsed: AdminCreditPack[];
    try {
      parsed = body.packs.map((p, i) => parsePack(p, i));
    } catch (e) {
      if (e instanceof ValidationError) {
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
      throw e;
    }

    const ids = parsed.map((p) => p.id);
    if (new Set(ids).size !== ids.length) {
      return NextResponse.json({ error: "Tier ids must be unique." }, { status: 400 });
    }

    const packs = await saveAllCreditPacks(parsed);
    return NextResponse.json({ packs });
  });
}
