import { NextRequest, NextResponse } from "next/server";
import {
  verifyNotificationSignature,
  DOKU_WEBHOOK_PATH,
} from "@/lib/doku";
import { getOrderByInvoice, markOrderFailed } from "@/lib/credit-orders-db";
import { fulfillPaidOrder } from "@/lib/credit-fulfillment";

export const dynamic = "force-dynamic";

/**
 * DOKU server-to-server notification handler.
 *
 * Security/correctness invariants:
 *   - Read the RAW body BEFORE parsing and verify the HMAC signature against it.
 *   - Re-validate the amount against the stored order (never trust the payload).
 *   - Credit the wallet ONLY here (never on the browser redirect).
 *   - Idempotent: addPurchaseCredits keys on `purchase:doku:<invoice>` and
 *     markOrderPaid only transitions a still-pending row, so duplicate/retry
 *     notifications never double-credit.
 *   - Always 200 on handled events so DOKU stops retrying.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const valid = verifyNotificationSignature({
    headers: {
      clientId: req.headers.get("Client-Id"),
      requestId: req.headers.get("Request-Id"),
      timestamp: req.headers.get("Request-Timestamp"),
      signature: req.headers.get("Signature"),
    },
    rawBody,
    target: DOKU_WEBHOOK_PATH,
  });

  if (!valid) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let payload: {
    order?: { invoice_number?: string; amount?: number | string };
    transaction?: { status?: string };
    channel?: { id?: string };
    acquirer?: { id?: string };
  };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const invoiceNumber = payload.order?.invoice_number;
  if (!invoiceNumber) {
    return NextResponse.json({ ignored: true, reason: "no invoice" });
  }

  const order = await getOrderByInvoice(invoiceNumber);
  if (!order) {
    // Unknown invoice — ack so DOKU stops retrying, but record nothing.
    console.warn("[doku/webhook] unknown invoice:", invoiceNumber);
    return NextResponse.json({ ignored: true, reason: "unknown order" });
  }

  // Already fulfilled — idempotent ack.
  if (order.status === "paid") {
    return NextResponse.json({ ok: true, status: "paid" });
  }

  const status = (payload.transaction?.status ?? "").toUpperCase();
  const paymentMethod = payload.channel?.id ?? payload.acquirer?.id ?? null;

  // Failure / expiry signals from DOKU.
  if (["FAILED", "EXPIRED", "VOID", "REFUND"].includes(status)) {
    await markOrderFailed(
      invoiceNumber,
      status === "EXPIRED" ? "expired" : "failed"
    );
    return NextResponse.json({ ok: true, status: "failed" });
  }

  // Anything other than a clear success (e.g. PENDING) — wait for a later notice.
  if (status !== "SUCCESS") {
    return NextResponse.json({ ok: true, status: "pending" });
  }

  // Re-validate the amount against the stored order before crediting.
  const paidAmount = Number(payload.order?.amount);
  if (!Number.isFinite(paidAmount) || paidAmount !== order.amount_idr) {
    console.error(
      `[doku/webhook] amount mismatch for ${invoiceNumber}: paid=${payload.order?.amount} expected=${order.amount_idr}`
    );
    return NextResponse.json({ ignored: true, reason: "amount mismatch" });
  }

  try {
    await fulfillPaidOrder(order, paymentMethod);
    return NextResponse.json({ ok: true, status: "paid" });
  } catch (e) {
    // Don't ack on a fulfillment error — let DOKU retry the notification.
    console.error("[doku/webhook] fulfillment failed:", e);
    return NextResponse.json(
      { error: "Fulfillment failed." },
      { status: 500 }
    );
  }
}
