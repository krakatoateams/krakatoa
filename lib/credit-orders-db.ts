import { supabaseServer } from "@/lib/supabase-server";

/**
 * Credit purchase orders (DOKU Checkout). See supabase/migrations/043_credit_orders.sql.
 *
 * Every read is scoped by profile_id (the ownership boundary). The webhook is the
 * only writer that flips an order to 'paid' and credits the wallet.
 */
export type CreditOrderStatus = "pending" | "paid" | "failed" | "expired";

export type CreditOrder = {
  id: string;
  profile_id: string;
  pack_id: string;
  credits: number;
  amount_idr: number;
  currency: string;
  invoice_number: string;
  status: CreditOrderStatus;
  payment_method: string | null;
  doku_token_id: string | null;
  credit_transaction_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  paid_at: string | null;
};

const TABLE = "credit_orders";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function handleError(error: { message: string } | null, fallback: string): void {
  if (!error) return;
  if (
    error.message.includes(TABLE) &&
    (error.message.includes("does not exist") ||
      error.message.includes("schema cache") ||
      error.message.includes("could not find"))
  ) {
    throw new Error(
      "Credit orders table is missing. Run: npm run db:setup — or apply supabase/migrations/043_credit_orders.sql."
    );
  }
  throw new Error(error.message || fallback);
}

/** Create a pending order. */
export async function createOrder(params: {
  profileId: string;
  packId: string;
  credits: number;
  amountIdr: number;
  invoiceNumber: string;
  currency?: string;
  metadata?: Record<string, unknown>;
}): Promise<CreditOrder> {
  const { data, error } = await supabaseServer
    .from(TABLE)
    .insert({
      profile_id: params.profileId,
      pack_id: params.packId,
      credits: params.credits,
      amount_idr: params.amountIdr,
      currency: params.currency ?? "IDR",
      invoice_number: params.invoiceNumber,
      status: "pending",
      metadata: params.metadata ?? {},
    })
    .select("*")
    .single();

  handleError(error, "Failed to create order.");
  return data as CreditOrder;
}

/** Look up an order by its invoice number (webhook path; not profile-scoped). */
export async function getOrderByInvoice(
  invoiceNumber: string
): Promise<CreditOrder | null> {
  const { data, error } = await supabaseServer
    .from(TABLE)
    .select("*")
    .eq("invoice_number", invoiceNumber)
    .maybeSingle();

  handleError(error, "Failed to fetch order.");
  return (data as CreditOrder | null) ?? null;
}

/**
 * Owner-scoped order lookup for client polling. `key` may be the order UUID or
 * the invoice number (the redirect URL carries the invoice).
 */
export async function getOrderForUser(
  profileId: string,
  key: string
): Promise<CreditOrder | null> {
  const column = UUID_RE.test(key) ? "id" : "invoice_number";
  const { data, error } = await supabaseServer
    .from(TABLE)
    .select("*")
    .eq("profile_id", profileId)
    .eq(column, key)
    .maybeSingle();

  handleError(error, "Failed to fetch order.");
  return (data as CreditOrder | null) ?? null;
}

/** Store the DOKU token id once the payment session is created. */
export async function setOrderToken(
  invoiceNumber: string,
  dokuTokenId: string
): Promise<void> {
  const { error } = await supabaseServer
    .from(TABLE)
    .update({ doku_token_id: dokuTokenId })
    .eq("invoice_number", invoiceNumber);
  handleError(error, "Failed to update order token.");
}

/**
 * Mark an order paid. Only transitions rows that are still 'pending' (the
 * `.eq("status", "pending")` guard) so concurrent/duplicate notifications can't
 * double-process. Returns the updated row, or null when nothing matched.
 */
export async function markOrderPaid(params: {
  invoiceNumber: string;
  paymentMethod?: string | null;
  dokuTokenId?: string | null;
  creditTransactionId?: string | null;
}): Promise<CreditOrder | null> {
  const { data, error } = await supabaseServer
    .from(TABLE)
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      payment_method: params.paymentMethod ?? null,
      doku_token_id: params.dokuTokenId ?? null,
      credit_transaction_id: params.creditTransactionId ?? null,
    })
    .eq("invoice_number", params.invoiceNumber)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();

  handleError(error, "Failed to mark order paid.");
  return (data as CreditOrder | null) ?? null;
}

/** Mark an order failed/expired (only while still pending). */
export async function markOrderFailed(
  invoiceNumber: string,
  status: "failed" | "expired" = "failed"
): Promise<void> {
  const { error } = await supabaseServer
    .from(TABLE)
    .update({ status })
    .eq("invoice_number", invoiceNumber)
    .eq("status", "pending");
  handleError(error, "Failed to mark order failed.");
}
