import {
  getOrderByInvoice,
  markOrderFailed,
  markOrderPaid,
  type CreditOrder,
} from "@/lib/credit-orders-db";
import { addPurchaseCredits } from "@/lib/credits-db";
import { checkCheckoutOrderStatus, DokuConfigError } from "@/lib/doku";

/**
 * Shared credit-order fulfillment used by BOTH the DOKU notification webhook and
 * the redirect-return reconciliation path. Crediting the wallet in one place
 * keeps the idempotency + order-transition guarantees identical no matter which
 * path confirms the payment first.
 *
 *   - addPurchaseCredits is idempotent on `purchase:doku:<invoice>`.
 *   - markOrderPaid only transitions a still-`pending` row.
 * So a webhook and a reconcile racing on the same order never double-credit.
 */
export async function fulfillPaidOrder(
  order: CreditOrder,
  paymentMethod: string | null
): Promise<void> {
  const result = await addPurchaseCredits({
    profileId: order.profile_id,
    amount: order.credits,
    idempotencyKey: `purchase:doku:${order.invoice_number}`,
    description: `Credit pack ${order.pack_id} (${order.credits} credits)`,
    metadata: {
      source: "doku",
      invoiceNumber: order.invoice_number,
      packId: order.pack_id,
      amountIdr: order.amount_idr,
      paymentMethod,
    },
  });

  await markOrderPaid({
    invoiceNumber: order.invoice_number,
    paymentMethod,
    dokuTokenId: order.doku_token_id,
    creditTransactionId: result.transaction.id,
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
