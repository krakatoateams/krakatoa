import { supabaseServer } from "@/lib/supabase-server";

/**
 * Credit system data access.
 *
 * Billing model:
 *   - credit_transactions is the BILLING SOURCE OF TRUTH (append-mostly ledger).
 *   - credit_wallets.balance is a fast-read cache kept in sync by the RPC
 *     `krakatoa_apply_credit_transaction` (single DB transaction, idempotent).
 *   - All balance mutations go through the RPC — never multi-step JS updates.
 *   - Every read is scoped by profile_id (the ownership boundary).
 *
 * This module is foundation only: it is not wired into generation routes yet.
 */

export type CreditDirection = "credit" | "debit";

export type CreditTransactionType =
  | "purchase"
  | "spend"
  | "refund"
  | "bonus"
  | "adjustment"
  | "expiry";

export type CreditTransactionStatus =
  | "pending"
  | "succeeded"
  | "failed"
  | "reversed";

export type CreditWallet = {
  id: string;
  profile_id: string;
  balance: number;
  lifetime_purchased: number;
  lifetime_spent: number;
  created_at: string;
  updated_at: string;
};

export type CreditTransaction = {
  id: string;
  profile_id: string;
  job_id: string | null;
  asset_id: string | null;
  amount: number;
  direction: CreditDirection;
  type: CreditTransactionType;
  status: CreditTransactionStatus;
  description: string | null;
  metadata: Record<string, unknown>;
  idempotency_key: string | null;
  created_at: string;
};

export type ApplyCreditResult = {
  transaction: CreditTransaction;
  wallet: CreditWallet;
  replayed: boolean;
};

const WALLETS_TABLE = "credit_wallets";
const TRANSACTIONS_TABLE = "credit_transactions";
const APPLY_RPC = "krakatoa_apply_credit_transaction";

/** Thrown when a debit would push the wallet balance below zero. */
export class InsufficientCreditsError extends Error {
  readonly code = "INSUFFICIENT_CREDITS";
  constructor(message = "Insufficient credits.") {
    super(message);
    this.name = "InsufficientCreditsError";
  }
}

function missingObjectMessage(message: string): boolean {
  return (
    (message.includes("credit_wallets") ||
      message.includes("credit_transactions") ||
      message.includes(APPLY_RPC)) &&
    (message.includes("schema cache") ||
      message.includes("does not exist") ||
      message.includes("could not find"))
  );
}

function handleError(error: { message: string } | null, fallback: string): void {
  if (!error) return;
  if (missingObjectMessage(error.message)) {
    throw new Error(
      "Credit system objects are missing. Run: npm run db:setup — or apply supabase/migrations/004_credits.sql."
    );
  }
  throw new Error(error.message || fallback);
}

/** Fetch a profile's wallet, or null if it does not exist yet. */
export async function getWallet(profileId: string): Promise<CreditWallet | null> {
  const { data, error } = await supabaseServer
    .from(WALLETS_TABLE)
    .select("*")
    .eq("profile_id", profileId)
    .maybeSingle();

  handleError(error, "Failed to fetch wallet.");
  return (data as CreditWallet | null) ?? null;
}

/** Fetch a profile's wallet, creating a zero-balance wallet on first use. */
export async function getOrCreateWallet(profileId: string): Promise<CreditWallet> {
  const existing = await getWallet(profileId);
  if (existing) return existing;

  const { error } = await supabaseServer
    .from(WALLETS_TABLE)
    .insert({ profile_id: profileId });

  // Tolerate the race where a concurrent request created the row first.
  if (error && !/duplicate key|unique/i.test(error.message)) {
    handleError(error, "Failed to create wallet.");
  }

  const wallet = await getWallet(profileId);
  if (!wallet) throw new Error("Failed to create wallet.");
  return wallet;
}

/**
 * Apply a single credit/debit through the transactional, idempotent RPC.
 * Returns the ledger row plus the resulting wallet snapshot.
 *
 * Prefer the typed wrappers (`spendCredits`, `refundCredits`, ...) over calling
 * this directly.
 */
export async function addCreditTransaction(params: {
  profileId: string;
  amount: number;
  direction: CreditDirection;
  type: CreditTransactionType;
  status?: CreditTransactionStatus;
  description?: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
  jobId?: string | null;
  assetId?: string | null;
}): Promise<ApplyCreditResult> {
  const { data, error } = await supabaseServer.rpc(APPLY_RPC, {
    p_profile_id: params.profileId,
    p_amount: params.amount,
    p_direction: params.direction,
    p_type: params.type,
    p_status: params.status ?? "succeeded",
    p_description: params.description ?? null,
    p_metadata: params.metadata ?? {},
    p_idempotency_key: params.idempotencyKey ?? null,
    p_job_id: params.jobId ?? null,
    p_asset_id: params.assetId ?? null,
  });

  if (error) {
    if (/INSUFFICIENT_CREDITS/.test(error.message)) {
      throw new InsufficientCreditsError();
    }
    handleError(error, "Failed to apply credit transaction.");
  }

  return data as ApplyCreditResult;
}

/**
 * Spend (debit) credits. Idempotent via `idempotencyKey` — a retry with the
 * same key returns the original result without double-charging. Throws
 * `InsufficientCreditsError` when the balance is too low.
 */
export async function spendCredits(params: {
  profileId: string;
  amount: number;
  idempotencyKey: string;
  jobId?: string | null;
  assetId?: string | null;
  description?: string;
  metadata?: Record<string, unknown>;
}): Promise<ApplyCreditResult> {
  return addCreditTransaction({
    ...params,
    direction: "debit",
    type: "spend",
  });
}

/** Refund (credit back) previously spent credits. */
export async function refundCredits(params: {
  profileId: string;
  amount: number;
  idempotencyKey?: string;
  jobId?: string | null;
  assetId?: string | null;
  description?: string;
  metadata?: Record<string, unknown>;
}): Promise<ApplyCreditResult> {
  return addCreditTransaction({
    ...params,
    direction: "credit",
    type: "refund",
  });
}

/**
 * Manual adjustment in either direction (support/ops corrections). The caller
 * supplies the direction; `amount` is always a positive magnitude.
 */
export async function adjustCredits(params: {
  profileId: string;
  amount: number;
  direction: CreditDirection;
  idempotencyKey?: string;
  jobId?: string | null;
  assetId?: string | null;
  description?: string;
  metadata?: Record<string, unknown>;
}): Promise<ApplyCreditResult> {
  return addCreditTransaction({
    ...params,
    type: "adjustment",
  });
}

/** Grant promotional/bonus credits (credit; does not count as purchased). */
export async function addBonusCredits(params: {
  profileId: string;
  amount: number;
  idempotencyKey?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}): Promise<ApplyCreditResult> {
  return addCreditTransaction({
    ...params,
    direction: "credit",
    type: "bonus",
  });
}

/**
 * Add purchased credits (credit; increments lifetime_purchased). Payment
 * provider integration (e.g. Xendit) is a separate, future phase — this only
 * records the ledger effect once a purchase is known to have succeeded.
 */
export async function addPurchaseCredits(params: {
  profileId: string;
  amount: number;
  idempotencyKey?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}): Promise<ApplyCreditResult> {
  return addCreditTransaction({
    ...params,
    direction: "credit",
    type: "purchase",
  });
}

export type SetBalanceResult = {
  wallet: CreditWallet;
  previousBalance: number;
  targetBalance: number;
  /** Signed change applied to reach the target (positive = credit, negative = debit). */
  delta: number;
  /** False when the wallet was already at the target (no ledger row written). */
  applied: boolean;
};

/**
 * Set a wallet to an EXACT target balance (admin "reset/top-up" tool).
 *
 * Computes the delta from the current balance and applies a single `adjustment`
 * transaction in the right direction through the idempotent RPC, so the ledger
 * (billing source of truth) and the cached balance move atomically. When the
 * wallet is already at the target this is a no-op (no ledger row).
 *
 * `targetBalance` must be a non-negative integer. A debit adjustment can never
 * push the balance below zero because the target is itself >= 0.
 */
export async function setWalletBalance(params: {
  profileId: string;
  targetBalance: number;
  description?: string;
  metadata?: Record<string, unknown>;
}): Promise<SetBalanceResult> {
  if (
    !Number.isInteger(params.targetBalance) ||
    params.targetBalance < 0
  ) {
    throw new Error("targetBalance must be a non-negative integer.");
  }

  const wallet = await getOrCreateWallet(params.profileId);
  const previousBalance = wallet.balance;
  const delta = params.targetBalance - previousBalance;

  if (delta === 0) {
    return {
      wallet,
      previousBalance,
      targetBalance: params.targetBalance,
      delta: 0,
      applied: false,
    };
  }

  const result = await addCreditTransaction({
    profileId: params.profileId,
    amount: Math.abs(delta),
    direction: delta > 0 ? "credit" : "debit",
    type: "adjustment",
    description:
      params.description ?? `Admin set balance to ${params.targetBalance}`,
    metadata: {
      source: "admin_set_balance",
      previous_balance: previousBalance,
      target_balance: params.targetBalance,
      ...(params.metadata ?? {}),
    },
  });

  return {
    wallet: result.wallet,
    previousBalance,
    targetBalance: params.targetBalance,
    delta,
    applied: true,
  };
}

/** List a profile's ledger transactions (newest first). */
export async function listCreditTransactions(
  profileId: string,
  options?: {
    type?: CreditTransactionType;
    direction?: CreditDirection;
    status?: CreditTransactionStatus;
    limit?: number;
  }
): Promise<CreditTransaction[]> {
  let query = supabaseServer
    .from(TRANSACTIONS_TABLE)
    .select("*")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(options?.limit ?? 100);

  if (options?.type) query = query.eq("type", options.type);
  if (options?.direction) query = query.eq("direction", options.direction);
  if (options?.status) query = query.eq("status", options.status);

  const { data, error } = await query;
  handleError(error, "Failed to list credit transactions.");
  return (data as CreditTransaction[] | null) ?? [];
}
