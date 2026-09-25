import { NextResponse } from "next/server";
import { requireCurrentProfile } from "@/lib/profiles-db";
import { packTotalCredits } from "@/lib/credit-packs";
import { getActiveCreditPack } from "@/lib/credit-packs-db";
import { getUsdCheckoutSettings } from "@/lib/usd-checkout-settings-db";
import { createOrder, setOrderToken } from "@/lib/credit-orders-db";
import { createCheckoutPayment, DokuConfigError, DokuApiError } from "@/lib/doku";
import { createPolarCheckout, polarProductIdForPack, PolarApiError, PolarConfigError } from "@/lib/polar";
import { resolveSiteOrigin } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Start a credit-pack purchase via DOKU Checkout.
 *
 * The client sends only `{ packId }`. Credits + amount are resolved server-side
 * from the active DB row (never trusted from the client). We create a pending
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

  const body = (await req.json().catch(() => null)) as {
    packId?: unknown;
    currency?: unknown;
  } | null;
  const packId = typeof body?.packId === "string" ? body.packId.trim() : "";
  const currency = body?.currency === "USD" ? "USD" : "IDR";
  if (currency === "USD" && !(await getUsdCheckoutSettings()).enabled) {
    return NextResponse.json({ error: "USD checkout is not available." }, { status: 403 });
  }
  let pack;
  try {
    pack = await getActiveCreditPack(packId);
  } catch (e) {
    console.error(
      "[credits/checkout] pack resolution failed:",
      e instanceof Error ? e.message : "unknown"
    );
    return NextResponse.json(
      { error: "Credit packs are temporarily unavailable. Please try again." },
      { status: 503 }
    );
  }
  if (!pack) {
    return NextResponse.json({ error: "Unknown credit pack." }, { status: 400 });
  }

  // Unique, human-readable invoice number (also DOKU order.invoice_number).
  const invoiceNumber = `KRK-${profileId.slice(0, 8)}-${Date.now()}`;

  // Credits actually granted include any promotional bonus on the pack.
  const grantedCredits = packTotalCredits(pack);

  try {
    const origin = resolveSiteOrigin();
    const successUrl = `${origin}/dashboard/settings?tab=credits&status=success&order=${encodeURIComponent(invoiceNumber)}`;
    const customerEmail = email && email.includes("@") ? email : null;
    const customerName = displayName || email || "Kelolako Customer";

    if (currency === "USD") {
      const productId = polarProductIdForPack(pack.id);
      if (!productId || pack.priceUsdCents <= 0) {
        return NextResponse.json(
          { error: "USD checkout is not configured for this pack." },
          { status: 503 }
        );
      }
      const order = await createOrder({
        profileId,
        packId: pack.id,
        credits: grantedCredits,
        amountIdr: pack.priceIdr,
        currency: "USD",
        invoiceNumber,
        metadata: {
          source: "polar",
          packLabel: pack.label,
          baseCredits: pack.credits,
          bonusCredits: pack.bonusCredits ?? 0,
          amountUsdCents: pack.priceUsdCents,
          polarProductId: productId,
        },
      });
      const { url, checkoutId } = await createPolarCheckout({
        productId,
        successUrl,
        returnUrl: `${origin}/dashboard/settings?tab=credits`,
        customerEmail,
        customerName,
        externalCustomerId: profileId,
        invoiceNumber,
        packId: pack.id,
      });
      await setOrderToken(invoiceNumber, checkoutId).catch((e) =>
        console.warn("[credits/checkout] setOrderToken failed:", e)
      );
      return NextResponse.json({ paymentUrl: url, orderId: order.id, invoiceNumber });
    }

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

    const notificationUrl = process.env.DOKU_NOTIFICATION_URL?.trim() || undefined;

    const { paymentUrl, tokenId } = await createCheckoutPayment({
      invoiceNumber,
      amountIdr: pack.priceIdr,
      customer: { id: profileId, name: customerName, email: customerEmail || `user-${profileId}@kelolako.com` },
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
    if (e instanceof DokuConfigError || e instanceof PolarConfigError) {
      console.error("[credits/checkout] payments not configured:", e.message);
      return NextResponse.json(
        { error: "Payments are not configured yet. Please try again later." },
        { status: 503 }
      );
    }
    if (e instanceof DokuApiError || e instanceof PolarApiError) {
      console.error("[credits/checkout] payment API error:", e.status, e.body);
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
