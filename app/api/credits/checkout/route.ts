import { NextResponse } from "next/server";
import { requireCurrentProfile } from "@/lib/profiles-db";
import { getCreditPack, packTotalCredits } from "@/lib/credit-packs";
import { createOrder, setOrderToken } from "@/lib/credit-orders-db";
import { createCheckoutPayment, DokuConfigError, DokuApiError } from "@/lib/doku";

export const dynamic = "force-dynamic";

/** Absolute site origin for DOKU redirect/callback URLs. */
function siteOrigin(): string {
  const explicit = process.env.NEXTAUTH_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

/**
 * Start a credit-pack purchase via DOKU Checkout.
 *
 * The client sends only `{ packId }`. Credits + amount are resolved server-side
 * from lib/credit-packs.ts (never trusted from the client). We create a pending
 * order, open a DOKU payment session, and return the hosted payment URL. The
 * wallet is credited later by the signature-verified notification webhook.
 */
export async function POST(req: Request) {
  let profileId: string;
  let email: string | null;
  let displayName: string | null;
  try {
    const profile = await requireCurrentProfile();
    profileId = profile.id;
    email = profile.email;
    displayName = profile.display_name;
  } catch (e) {
    if (e instanceof Error && /not authenticated/i.test(e.message)) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    console.error("[credits/checkout] profile resolution failed:", e);
    return NextResponse.json(
      { error: "Profile resolution failed. Please try again." },
      { status: 500 }
    );
  }

  const body = (await req.json().catch(() => null)) as { packId?: unknown } | null;
  const packId = typeof body?.packId === "string" ? body.packId.trim() : "";
  const pack = getCreditPack(packId);
  if (!pack) {
    return NextResponse.json({ error: "Unknown credit pack." }, { status: 400 });
  }

  // Unique, human-readable invoice number (also DOKU order.invoice_number).
  const invoiceNumber = `KRK-${profileId.slice(0, 8)}-${Date.now()}`;

  // Credits actually granted include any promotional bonus on the pack.
  const grantedCredits = packTotalCredits(pack);

  try {
    const order = await createOrder({
      profileId,
      packId: pack.id,
      credits: grantedCredits,
      amountIdr: pack.priceIdr,
      invoiceNumber,
      metadata: {
        source: "doku",
        packLabel: pack.label,
        baseCredits: pack.credits,
        bonusCredits: pack.bonusCredits ?? 0,
      },
    });

    const origin = siteOrigin();
    const successUrl = `${origin}/dashboard/settings?tab=credits&status=success&order=${encodeURIComponent(invoiceNumber)}`;

    const customerEmail = email || `user-${profileId}@krakatoa.app`;
    const customerName = displayName || email || "Kelolako Customer";

    // Optional: override the Back Office notification URL per request (handy when
    // a dev tunnel domain changes). Must share the same PATH as the configured URL.
    const notificationUrl = process.env.DOKU_NOTIFICATION_URL?.trim() || undefined;

    const { paymentUrl, tokenId } = await createCheckoutPayment({
      invoiceNumber,
      amountIdr: pack.priceIdr,
      customer: { id: profileId, name: customerName, email: customerEmail },
      successUrl,
      notificationUrl,
      lineItem: {
        name: `${grantedCredits} credits - ${pack.label}`,
        quantity: 1,
        price: pack.priceIdr,
      },
    });

    if (tokenId) {
      await setOrderToken(invoiceNumber, tokenId).catch((e) =>
        console.warn("[credits/checkout] setOrderToken failed:", e)
      );
    }

    return NextResponse.json({
      paymentUrl,
      orderId: order.id,
      invoiceNumber,
    });
  } catch (e) {
    if (e instanceof DokuConfigError) {
      console.error("[credits/checkout] DOKU not configured:", e.message);
      return NextResponse.json(
        { error: "Payments are not configured yet. Please try again later." },
        { status: 503 }
      );
    }
    if (e instanceof DokuApiError) {
      console.error("[credits/checkout] DOKU API error:", e.status, e.body);
      return NextResponse.json(
        { error: "Could not start the payment. Please try again." },
        { status: 502 }
      );
    }
    console.error("[credits/checkout] unexpected error:", e);
    return NextResponse.json(
      { error: "Could not start the payment. Please try again." },
      { status: 500 }
    );
  }
}
