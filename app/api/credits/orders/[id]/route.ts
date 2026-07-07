import { NextRequest, NextResponse } from "next/server";
import { requireCurrentProfile } from "@/lib/profiles-db";
import { getOrderForUser } from "@/lib/credit-orders-db";
import { reconcilePendingOrder } from "@/lib/credit-fulfillment";

export const dynamic = "force-dynamic";

/**
 * Owner-scoped order status for client polling after the DOKU redirect.
 * `[id]` may be the order UUID or the invoice number (the redirect carries the
 * invoice). Returns just enough for the UI to show a banner + refresh balance.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  let profileId: string;
  try {
    const profile = await requireCurrentProfile();
    profileId = profile.id;
  } catch (e) {
    if (e instanceof Error && /not authenticated/i.test(e.message)) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    throw e;
  }

  const key = params.id?.trim();
  if (!key) {
    return NextResponse.json({ error: "Missing order id." }, { status: 400 });
  }

  let order = await getOrderForUser(profileId, key);
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  // Self-heal: if the notification webhook never fulfilled a still-pending
  // order, ask DOKU directly and credit the wallet here if it's actually paid.
  // Ownership was already verified above; fulfillment is idempotent.
  if (order.status === "pending") {
    try {
      await reconcilePendingOrder(order.invoice_number);
      order = (await getOrderForUser(profileId, key)) ?? order;
    } catch (e) {
      console.warn(
        `[credits/orders] reconcile failed for ${order.invoice_number}:`,
        e instanceof Error ? e.message : e
      );
    }
  }

  return NextResponse.json({
    status: order.status,
    credits: order.credits,
    packId: order.pack_id,
    invoiceNumber: order.invoice_number,
  });
}
