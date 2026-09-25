import { NextRequest, NextResponse } from "next/server";
import { getOrderByInvoice } from "@/lib/credit-orders-db";
import { fulfillPaidOrder } from "@/lib/credit-fulfillment";
import { polarProductIdForPack, verifyPolarWebhook } from "@/lib/polar";

export const dynamic = "force-dynamic";

type PolarOrder = {
  type?: string;
  data?: {
    currency?: string;
    total_amount?: number;
    product_id?: string;
    metadata?: { invoice?: string; packId?: string };
  };
};

/**
 * Polar order.paid notification. Credits the wallet only after the signature
 * checks out and the paid product matches the pending order.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const valid = verifyPolarWebhook({
    rawBody,
    webhookId: req.headers.get("webhook-id"),
    timestamp: req.headers.get("webhook-timestamp"),
    signature: req.headers.get("webhook-signature"),
  });
  if (!valid) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let payload: PolarOrder;
  try {
    payload = JSON.parse(rawBody) as PolarOrder;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  if (payload.type !== "order.paid") {
    return NextResponse.json({ ignored: true, reason: "event" });
  }

  const invoiceNumber = payload.data?.metadata?.invoice;
  if (!invoiceNumber) {
    return NextResponse.json({ ignored: true, reason: "no invoice" });
  }

  const order = await getOrderByInvoice(invoiceNumber);
  if (!order) {
    console.warn("[polar/webhook] unknown invoice:", invoiceNumber);
    return NextResponse.json({ ignored: true, reason: "unknown order" });
  }
  if (order.status === "paid") {
    return NextResponse.json({ ok: true, status: "paid" });
  }
  if (order.metadata?.source !== "polar") {
    return NextResponse.json({ ignored: true, reason: "not a polar order" });
  }

  const expectedProduct = polarProductIdForPack(order.pack_id);
  const paidProduct = payload.data?.product_id ?? "";
  const paidCents = Number(payload.data?.total_amount);
  const expectedCents = Number(order.metadata?.amountUsdCents);
  const currency = (payload.data?.currency ?? "").toLowerCase();
  if (
    currency !== "usd" ||
    !expectedProduct ||
    paidProduct !== expectedProduct ||
    !Number.isFinite(paidCents) ||
    paidCents < expectedCents
  ) {
    console.error(
      `[polar/webhook] payment mismatch for ${invoiceNumber}: product=${paidProduct} expected=${expectedProduct} paid=${payload.data?.total_amount} expectedCents=${expectedCents} currency=${currency}`
    );
    return NextResponse.json({ ignored: true, reason: "payment mismatch" });
  }

  try {
    await fulfillPaidOrder(order, "polar");
    return NextResponse.json({ ok: true, status: "paid" });
  } catch (e) {
    console.error("[polar/webhook] fulfillment failed:", e);
    return NextResponse.json({ error: "Fulfillment failed." }, { status: 500 });
  }
}
