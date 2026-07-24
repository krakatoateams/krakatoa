import {
  getOrderByInvoice,
  markOrderFailed,
  markOrderPaid,
  type CreditOrder,
} from "@/lib/credit-orders-db";
import { getCreditPack } from "@/lib/credit-packs";
import { addPurchaseCredits } from "@/lib/credits-db";
import { checkCheckoutOrderStatus, DokuConfigError } from "@/lib/doku";

/** Read a non-negative integer field from order metadata, or undefined. */
function metaInt(
  metadata: Record<string, unknown>,
  key: string
): number | undefined {
  const v = metadata?.[key];
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
}

/**
 * Split an order's total credits into base ("regular") and promotional bonus
 * ("purchase_bonus") so the two can expire on independent schedules. The base
 * count comes from the order metadata (authoritative snapshot at checkout),
 * falling back to the current pack catalog, then to the whole amount. The bonus
 * is always the remainder so base + bonus === order.credits exactly.
 */
function splitOrderCredits(order: CreditOrder): { base: number; bonus: number } {
  const pack = getCreditPack(order.pack_id);
  const metaBase = metaInt(order.metadata ?? {}, "baseCredits");
  const rawBase = metaBase ?? pack?.credits ?? order.credits;
  const base = Math.max(0, Math.min(rawBase, order.credits));
  const bonus = Math.max(0, order.credits - base);
  return { base, bonus };
}

/**
 * Shared credit-order fulfillment used by BOTH the DOKU notification webhook and
 * the redirect-return reconciliation path. Crediting the wallet in one place
 * keeps the idempotency + order-transition guarantees identical no matter which
 * path confirms the payment first.
 *
 * The grant is split into a base ("regular") lot and a promotional bonus
 * ("purchase_bonus") lot so each can carry its own expiry. Each half is
 * idempotent on a distinct key (`:base` / `:bonus`), and markOrderPaid only
 * transitions a still-`pending` row — so a webhook and a reconcile racing on the
 * same order never double-credit.
 */
export async function fulfillPaidOrder(
  order: CreditOrder,
  paymentMethod: string | null
): Promise<void> {
  const { base, bonus } = splitOrderCredits(order);
  const baseMeta = {
    source: "doku",
    invoiceNumber: order.invoice_number,
    packId: order.pack_id,
    amountIdr: order.amount_idr,
    paymentMethod,
  };

  const baseResult = await addPurchaseCredits({
    profileId: order.profile_id,
    amount: base,
    idempotencyKey: `purchase:doku:${order.invoice_number}:base`,
    description: `Credit pack ${order.pack_id} — base (${base} credits)`,
    source: "regular",
    metadata: { ...baseMeta, portion: "base" },
  });

  if (bonus > 0) {
    await addPurchaseCredits({
      profileId: order.profile_id,
      amount: bonus,
      idempotencyKey: `purchase:doku:${order.invoice_number}:bonus`,
      description: `Credit pack ${order.pack_id} — bonus (${bonus} credits)`,
      source: "purchase_bonus",
      metadata: { ...baseMeta, portion: "bonus" },
    });
  }

  await markOrderPaid({
    invoiceNumber: order.invoice_number,
    paymentMethod,
    dokuTokenId: order.doku_token_id,
    creditTransactionId: baseResult.transaction.id,
  });
}

export type ReconcileResult = {
  status: CreditOrder["status"];
  /** True when this call transitioned the order to paid and credited the wallet. */
  fulfilled: boolean;
  /** DOKU transaction status when a live check was performed. */
  dokuStatus?: string;
};

/**
 * Reconcile a possibly-stuck order against DOKU's Check Status API. Safe to call
 * repeatedly. When DOKU reports the payment as SUCCESS (and the amount matches),
 * the wallet is credited via the shared idempotent path; when DOKU reports
 * EXPIRED/FAILED the order is marked failed. Otherwise the order is left pending.
 *
 * This is the fallback that keeps fulfillment working even when the server-to-
 * server notification never reaches us (common with rotating dev tunnels or a
 * misconfigured Back Office Notification URL).
 */
export async function reconcilePendingOrder(
  invoiceNumber: string
): Promise<ReconcileResult> {
  const order = await getOrderByInvoice(invoiceNumber);
  if (!order) return { status: "failed", fulfilled: false };
  if (order.status !== "pending") {
    return { status: order.status, fulfilled: false };
  }

  let doku;
  try {
    doku = await checkCheckoutOrderStatus(invoiceNumber);
  } catch (e) {
    // Config missing or transient DOKU error — leave the order pending so a
    // later poll / the webhook can still fulfill it.
    if (!(e instanceof DokuConfigError)) {
      console.warn(
        `[reconcile] DOKU check-status failed for ${invoiceNumber}:`,
        e instanceof Error ? e.message : e
      );
    }
    return { status: "pending", fulfilled: false };
  }

  if (doku.transactionStatus === "SUCCESS") {
    // Guard against an amount mismatch before crediting.
    if (doku.amount !== null && doku.amount !== order.amount_idr) {
      console.error(
        `[reconcile] amount mismatch for ${invoiceNumber}: doku=${doku.amount} expected=${order.amount_idr}`
      );
      return { status: "pending", fulfilled: false, dokuStatus: doku.transactionStatus };
    }
    await fulfillPaidOrder(order, doku.paymentMethod);
    return { status: "paid", fulfilled: true, dokuStatus: doku.transactionStatus };
  }

  if (["EXPIRED", "FAILED", "VOID", "REFUND"].includes(doku.transactionStatus)) {
    await markOrderFailed(
      invoiceNumber,
      doku.transactionStatus === "EXPIRED" ? "expired" : "failed"
    );
    return {
      status: doku.transactionStatus === "EXPIRED" ? "expired" : "failed",
      fulfilled: false,
      dokuStatus: doku.transactionStatus,
    };
  }

  // Still PENDING on DOKU's side.
  return { status: "pending", fulfilled: false, dokuStatus: doku.transactionStatus };
}
