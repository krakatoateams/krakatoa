import { supabaseServer } from "@/lib/supabase-server";
import { DEFAULT_CREDIT_PACKS, type CreditPack } from "@/lib/credit-packs";

/**
 * DB-backed credit packs (admin-managed purchase tiers).
 *
 * Read path (public/checkout) NEVER throws: a missing table / query error falls
 * back to DEFAULT_CREDIT_PACKS so purchasing keeps working. Reads hit the DB
 * every call (no in-process cache) — Next bundles each route module separately,
 * so a shared module-level cache can't be reliably invalidated across routes and
 * would serve stale prices right after an admin save.
 * Admin CRUD (listAll / saveAll) throws on error so the admin UI can surface it.
 */

/** Admin-facing pack shape (adds visibility + ordering to the public CreditPack). */
export type AdminCreditPack = CreditPack & {
  isActive: boolean;
  sortOrder: number;
};

const TABLE = "credit_packs";

type CreditPackRow = {
  id: string;
  credits: number;
  bonus_credits: number;
  price_idr: number;
  label: string;
  popular: boolean;
  is_active: boolean;
  sort_order: number;
};

function toPublic(row: CreditPackRow): CreditPack {
  return {
    id: row.id,
    credits: row.credits,
    bonusCredits: row.bonus_credits || undefined,
    priceIdr: row.price_idr,
    label: row.label,
    popular: row.popular || undefined,
  };
}

function toAdmin(row: CreditPackRow): AdminCreditPack {
  return {
    id: row.id,
    credits: row.credits,
    bonusCredits: row.bonus_credits || undefined,
    priceIdr: row.price_idr,
    label: row.label,
    popular: row.popular || undefined,
    isActive: row.is_active,
    sortOrder: row.sort_order,
  };
}

const SELECT =
  "id, credits, bonus_credits, price_idr, label, popular, is_active, sort_order";

/**
 * Active purchasable tiers, sorted. Reads fresh from the DB every call. Falls
 * back to DEFAULT_CREDIT_PACKS on any read failure (never throws).
 */
export async function listActiveCreditPacks(): Promise<CreditPack[]> {
  try {
    const { data, error } = await supabaseServer
      .from(TABLE)
      .select(SELECT)
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (error || !data) {
      if (error) console.warn("[credit-packs] read failed, using defaults:", error.message);
      return DEFAULT_CREDIT_PACKS;
    }
    if (data.length === 0) return DEFAULT_CREDIT_PACKS;

    return (data as CreditPackRow[]).map(toPublic);
  } catch (e) {
    console.warn("[credit-packs] read threw, using defaults:", e);
    return DEFAULT_CREDIT_PACKS;
  }
}

/**
 * Resolve a single ACTIVE pack by id (checkout path). Returns null for unknown
 * or inactive ids so a disabled tier can't be purchased.
 */
export async function getActiveCreditPack(id: string): Promise<CreditPack | null> {
  const packs = await listActiveCreditPacks();
  return packs.find((p) => p.id === id) ?? null;
}

/** All tiers incl. inactive, sorted (admin). Throws on error. */
export async function listAllCreditPacks(): Promise<AdminCreditPack[]> {
  const { data, error } = await supabaseServer
    .from(TABLE)
    .select(SELECT)
    .order("sort_order", { ascending: true });

  if (error) throw new Error(error.message);
  return (data as CreditPackRow[]).map(toAdmin);
}

/**
 * Replace the full tier set (admin "Save"): upsert every pack in `packs` and
 * delete any existing row whose id is not present. Ordering is taken from array
 * position. Throws on error.
 */
export async function saveAllCreditPacks(
  packs: AdminCreditPack[]
): Promise<AdminCreditPack[]> {
  const rows = packs.map((p, i) => ({
    id: p.id,
    credits: p.credits,
    bonus_credits: p.bonusCredits ?? 0,
    price_idr: p.priceIdr,
    label: p.label,
    popular: p.popular ?? false,
    is_active: p.isActive,
    sort_order: p.sortOrder ?? i,
  }));

  const keepIds = rows.map((r) => r.id);

  // Delete removed tiers first (anything not in the incoming set). Ids are
  // slug-safe (enforced by the admin API), so an unquoted IN list is safe.
  const del = keepIds.length
    ? await supabaseServer.from(TABLE).delete().not("id", "in", `(${keepIds.join(",")})`)
    : await supabaseServer.from(TABLE).delete().neq("id", "");
  if (del.error) throw new Error(del.error.message);

  if (rows.length) {
    const { error } = await supabaseServer.from(TABLE).upsert(rows, { onConflict: "id" });
    if (error) throw new Error(error.message);
  }

  return listAllCreditPacks();
}
