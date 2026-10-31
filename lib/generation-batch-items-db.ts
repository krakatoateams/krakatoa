import { supabaseServer } from "@/lib/supabase-server";
import { isMissingDbObject } from "@/lib/generation-db-errors";
import { errorLogSafe } from "@/lib/error-log-safe";
import type { SettledCursor } from "@/lib/generation-reconcile-settled";
import type { BatchItemCandidate, BatchItemRow } from "@/lib/generation-batch-items-pure";

/**
 * Every read/write of `generation_batch_items` (migration 119). While the table is missing nothing is
 * written, reconcile skips the scan and nothing throws to callers: today's behavior. "Missing" is
 * remembered for at most a minute, so applying 119 switches the feature on without a redeploy.
 */
const TABLE = "generation_batch_items";
const MISSING_RECHECK_MS = 60_000;
let missingUntil = 0;
let loggedMissing = false;

const knownMissing = () => Date.now() < missingUntil;

function noteMissing(message: string): boolean {
  if (!isMissingDbObject(message, TABLE)) return false;
  missingUntil = Date.now() + MISSING_RECHECK_MS;
  if (!loggedMissing) {
    loggedMissing = true;
    console.warn(`[batch-items] ${TABLE} missing (skipped); apply migration 119`);
  }
  return true;
}

/** Route: all rows of one batch in one statement. Best-effort: never throws. */
export async function insertBatchItems(rows: BatchItemRow[]): Promise<"written" | "missing" | "failed"> {
  if (knownMissing()) return "missing";
  try {
    const { error } = await supabaseServer.from(TABLE).insert(rows);
    if (!error) return "written";
    if (noteMissing(error.message)) return "missing";
    console.error(`[batch-items] write failed job=${rows[0]?.job_id}:`, errorLogSafe(error.message));
  } catch (e) {
    console.error(`[batch-items] write failed job=${rows[0]?.job_id}:`, errorLogSafe(e));
  }
  return "failed";
}

/** Reconcile: false while the table is missing; other errors throw (reported in the run's errors). */
export async function batchItemsTableReady(): Promise<boolean> {
  if (knownMissing()) return false;
  // A GET, not HEAD: a HEAD 404 has no body and supabase-js reports it as success.
  const { error } = await supabaseServer.from(TABLE).select("id").limit(1);
  if (!error) return true;
  if (noteMissing(error.message)) return false;
  throw new Error(error.message);
}

type ItemRow = {
  id: string;
  profile_id: string;
  job_id: string;
  batch_index: number;
  provider: string;
  prediction_id: string | null;
  credits: number;
  created_at: string;
};

const ambiguousQuery = (w: { after: string; before: string }, cursor: SettledCursor, head: boolean) => {
  let q = supabaseServer
    .from(TABLE)
    .select("id, profile_id, job_id, batch_index, provider, prediction_id, credits, created_at", head ? { count: "exact", head: true } : undefined)
    .eq("state", "ambiguous")
    .gt("created_at", w.after)
    .lt("created_at", w.before);
  if (cursor) q = q.or(`created_at.gt.${cursor.updatedAt},and(created_at.eq.${cursor.updatedAt},id.gt.${cursor.id})`);
  return q;
};

/** Keyset page of ambiguous rows, (created_at, id) ascending; `updatedAt` carries created_at. */
export async function fetchAmbiguousBatchItems(
  w: { after: string; before: string },
  cursor: SettledCursor,
  limit: number,
): Promise<BatchItemCandidate[]> {
  const { data, error } = await ambiguousQuery(w, cursor, false)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data as ItemRow[] | null) ?? []).map((r) => ({
    id: r.id,
    profileId: r.profile_id,
    jobId: r.job_id,
    batchIndex: r.batch_index,
    provider: r.provider,
    predictionId: r.prediction_id,
    credits: r.credits,
    updatedAt: r.created_at,
  }));
}

export async function countAmbiguousBatchItems(w: { after: string; before: string }, cursor: SettledCursor): Promise<number> {
  const { count } = await ambiguousQuery(w, cursor, true);
  return count ?? 0;
}

/** Compare-and-set `ambiguous -> to`, owner-scoped. False when another run already moved the row. */
export async function settleAmbiguousBatchItem(
  item: { id: string; profileId: string },
  to: "refunded" | "unresolved",
  refundKey: string | null,
): Promise<boolean> {
  const { data, error } = await supabaseServer
    .from(TABLE)
    .update({
      state: to,
      settled_at: new Date().toISOString(),
      ...(refundKey ? { refund_idempotency_key: refundKey } : {}),
    })
    .eq("id", item.id)
    .eq("profile_id", item.profileId)
    .eq("state", "ambiguous")
    .select("id");
  if (error) throw new Error(error.message);
  return ((data as { id: string }[] | null) ?? []).length > 0;
}
