import { NextRequest, NextResponse } from "next/server";
import { requireCurrentProfile } from "@/lib/profiles-db";
import { getOrderForUser } from "@/lib/credit-orders-db";

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

  const order = await getOrderForUser(profileId, key);
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  return NextResponse.json({
    status: order.status,
    credits: order.credits,
    packId: order.pack_id,
    invoiceNumber: order.invoice_number,
  });
}
