import { supabaseServer } from "@/lib/supabase-server";
import {
  creditPacksFromDbRows,
  type CreditPack,
} from "@/lib/credit-packs";

/**
 * DB-backed credit packs (admin-managed purchase tiers).
 *
 * Public display and checkout reads fail closed on DB errors so stale code
 * defaults never advertise or authorize a purchase. Reads hit the DB every
 * call (no in-process cache) so admin price edits affect checkout immediately.
 * Admin CRUD (listAll / saveAll) throws on error so the admin UI can surface it.
 */

/** Admin-facing pack shape (adds visibility + ordering to the public CreditPack). */
export type AdminCreditPack = CreditPack & {
  isActive: boolean;
  sortOrder: number;
};

const TABLE = "credit_packs";
const REPLACE_CREDIT_PACKS_RPC = "krakatoa_replace_credit_packs";

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
 * Active purchasable tiers, sorted. Reads fresh from the DB every call and
 * returns an empty set on failure or when admins disable every pack.
 */
export async function listActiveCreditPacks(): Promise<CreditPack[]> {
  try {
    const { data, error } = await supabaseServer
      .from(TABLE)
      .select(SELECT)
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (error || !data) {
      if (error) console.warn("[credit-packs] read failed, hiding packs:", error.message);
      return creditPacksFromDbRows(null);
    }

    return creditPacksFromDbRows((data as CreditPackRow[]).map(toPublic));
  } catch (e) {
    console.warn("[credit-packs] read threw, hiding packs:", e);
    return creditPacksFromDbRows(null);
  }
}

/**
 * Resolve a single ACTIVE pack by id for checkout. This path deliberately
 * fails closed on DB errors instead of selling a potentially stale fallback.
 */
export async function getActiveCreditPack(id: string): Promise<CreditPack | null> {
  const { data, error } = await supabaseServer
    .from(TABLE)
    .select(SELECT)
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? toPublic(data as CreditPackRow) : null;
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
 * Replace the full tier set atomically through a Postgres RPC. The prior set
 * remains intact if validation, deletion, or upsert fails.
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

  const { error } = await supabaseServer.rpc(REPLACE_CREDIT_PACKS_RPC, {
    p_packs: rows,
  });
  if (error) throw new Error(error.message);

  return listAllCreditPacks();
}
