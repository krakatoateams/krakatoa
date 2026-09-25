import { createHmac, timingSafeEqual } from "crypto";

const PACK_ORDER = ["p1", "p3", "p4", "p5"] as const;

export class PolarConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolarConfigError";
  }
}

export class PolarApiError extends Error {
  status: number;
  body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "PolarApiError";
    this.status = status;
    this.body = body;
  }
}

function polarApiBase(): string {
  const server = process.env.POLAR_SERVER?.trim().toLowerCase();
  return server === "sandbox" ? "https://sandbox-api.polar.sh" : "https://api.polar.sh";
}

function accessToken(): string {
  const token = process.env.POLAR_ACCESS_TOKEN?.trim();
  if (!token) throw new PolarConfigError("POLAR_ACCESS_TOKEN is not set.");
  return token;
}

/** Product ids in pack order: Starter, Creator, Pro, Studio. */
export function polarProductIdForPack(packId: string): string | null {
  const ids = (process.env.POLAR_PRICE_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const index = PACK_ORDER.indexOf(packId as (typeof PACK_ORDER)[number]);
  return index >= 0 ? ids[index] ?? null : null;
}

export async function createPolarCheckout(params: {
  productId: string;
  successUrl: string;
  returnUrl: string;
  customerEmail: string | null;
  customerName: string | null;
  externalCustomerId: string;
  invoiceNumber: string;
  packId: string;
}): Promise<{ url: string; checkoutId: string }> {
  const res = await fetch(`${polarApiBase()}/v1/checkouts/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      products: [params.productId],
      success_url: params.successUrl,
      return_url: params.returnUrl,
      customer_email: params.customerEmail,
      customer_name: params.customerName,
      external_customer_id: params.externalCustomerId,
      allow_discount_codes: false,
      metadata: {
        invoice: params.invoiceNumber,
        packId: params.packId,
      },
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new PolarApiError("Polar checkout failed.", res.status, text);
  }
  let data: { url?: string; id?: string };
  try {
    data = JSON.parse(text) as { url?: string; id?: string };
  } catch {
    throw new PolarApiError("Polar returned a non-JSON response.", res.status, text);
  }
  if (!data.url || !data.id) {
    throw new PolarApiError("Polar response did not include a checkout URL.", res.status, text);
  }
  return { url: data.url, checkoutId: data.id };
}

/** Verify a Standard Webhooks signature (Polar secrets issued after 8 Sep 2026). */
export function verifyPolarWebhook(params: {
  rawBody: string;
  webhookId: string | null;
  timestamp: string | null;
  signature: string | null;
}): boolean {
  const secret = process.env.POLAR_WEBHOOK_SECRET?.trim();
  if (!secret || !params.webhookId || !params.timestamp || !params.signature) return false;
  const key = secret.startsWith("whsec_")
    ? Buffer.from(secret.slice("whsec_".length), "base64")
    : Buffer.from(secret);
  const expected = createHmac("sha256", key)
    .update(`${params.webhookId}.${params.timestamp}.${params.rawBody}`)
    .digest("base64");
  return params.signature.split(" ").some((part) => {
    const value = part.split(",")[1];
    if (!value) return false;
    const a = Buffer.from(value);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}
