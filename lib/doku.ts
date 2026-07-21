import crypto from "crypto";

/**
 * DOKU Checkout (hosted payment page) client + signature helpers.
 *
 * Docs: https://developers.doku.com/accept-payment/integration-guide/checkout
 *
 * Request signing (outbound create-payment) and notification verification
 * (inbound webhook) both use the same scheme:
 *
 *   Digest    = Base64( SHA256(minified-json-body) )
 *   Component = "Client-Id:<id>\nRequest-Id:<uuid>\nRequest-Timestamp:<ts>\n
 *                Request-Target:<path>\nDigest:<digest>"
 *   Signature = "HMACSHA256=" + Base64( HMAC_SHA256(Component, SecretKey) )
 *
 * Timestamp is ISO-8601 in UTC with no milliseconds (e.g. 2020-08-11T08:45:42Z).
 */

const CHECKOUT_PATH = "/checkout/v1/payment";
/** Base path for the DOKU Check Status API (append the invoice number). */
const ORDER_STATUS_PATH = "/orders/v1/status";
/** Path DOKU calls for notifications — must match the deployed route + dashboard config. */
export const DOKU_WEBHOOK_PATH = "/api/payments/doku/webhook";

export class DokuConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DokuConfigError";
  }
}

export class DokuApiError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "DokuApiError";
    this.status = status;
    this.body = body;
  }
}

type DokuConfig = { clientId: string; secretKey: string; baseUrl: string };

function getConfig(): DokuConfig {
  const clientId = process.env.DOKU_CLIENT_ID?.trim();
  const secretKey = process.env.DOKU_SECRET_KEY?.trim();
  if (!clientId || !secretKey) {
    throw new DokuConfigError(
      "DOKU is not configured. Set DOKU_CLIENT_ID and DOKU_SECRET_KEY."
    );
  }
  const explicit = process.env.DOKU_API_BASE?.trim();
  const baseUrl = explicit
    ? explicit.replace(/\/$/, "")
    : process.env.DOKU_ENV === "production"
      ? "https://api.doku.com"
      : "https://api-sandbox.doku.com";
  return { clientId, secretKey, baseUrl };
}

function sha256Base64(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("base64");
}

function hmacSha256Base64(input: string, key: string): string {
  return crypto.createHmac("sha256", key).update(input, "utf8").digest("base64");
}

/** ISO-8601 UTC timestamp with no milliseconds, as DOKU expects. */
function dokuTimestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * DOKU restricts free-text fields (customer name, line-item name) to:
 *   a-z A-Z 0-9 space . - / + , = _ : ' @ %
 * Strip anything else (e.g. parentheses, emoji, accented letters) so a user's
 * display name or a label can't trigger a 400 "Invalid character" rejection.
 */
function sanitizeText(input: string, fallback: string): string {
  const cleaned = input.replace(/[^a-zA-Z0-9 .\-/+,=_:'@%]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || fallback;
}

function buildSignature(params: {
  clientId: string;
  secretKey: string;
  requestId: string;
  timestamp: string;
  target: string;
  rawBody: string;
}): string {
  const digest = sha256Base64(params.rawBody);
  const component =
    `Client-Id:${params.clientId}\n` +
    `Request-Id:${params.requestId}\n` +
    `Request-Timestamp:${params.timestamp}\n` +
    `Request-Target:${params.target}\n` +
    `Digest:${digest}`;
  return `HMACSHA256=${hmacSha256Base64(component, params.secretKey)}`;
}

/**
 * Signature for GET requests. Per DOKU, GET requests omit the Digest line
 * (there is no request body to hash).
 */
function buildGetSignature(params: {
  clientId: string;
  secretKey: string;
  requestId: string;
  timestamp: string;
  target: string;
}): string {
  const component =
    `Client-Id:${params.clientId}\n` +
    `Request-Id:${params.requestId}\n` +
    `Request-Timestamp:${params.timestamp}\n` +
    `Request-Target:${params.target}`;
  return `HMACSHA256=${hmacSha256Base64(component, params.secretKey)}`;
}

export type CheckoutOrderStatus = {
  /** Transaction-level status: SUCCESS | PENDING | FAILED | EXPIRED | ... */
  transactionStatus: string;
  /** Order-level status: ORDER_GENERATED | ORDER_EXPIRED | ORDER_RECOVERED | ... */
  orderStatus: string | null;
  /** Amount DOKU has on record for the order (IDR). */
  amount: number | null;
  /** Payment channel/acquirer id, when present. */
  paymentMethod: string | null;
  raw: unknown;
};

/**
 * Query the DOKU Check Status API for an order by invoice number. Used to
 * reconcile orders whose notification webhook never arrived (or failed), so a
 * genuinely-paid order can still be fulfilled from the redirect-return polling.
 */
export async function checkCheckoutOrderStatus(
  invoiceNumber: string
): Promise<CheckoutOrderStatus> {
  const { clientId, secretKey, baseUrl } = getConfig();
  const target = `${ORDER_STATUS_PATH}/${invoiceNumber}`;
  const requestId = crypto.randomUUID();
  const timestamp = dokuTimestamp();
  const signature = buildGetSignature({
    clientId,
    secretKey,
    requestId,
    timestamp,
    target,
  });

  const res = await fetch(`${baseUrl}${target}`, {
    method: "GET",
    headers: {
      "Client-Id": clientId,
      "Request-Id": requestId,
      "Request-Timestamp": timestamp,
      Signature: signature,
    },
  });

  const text = await res.text();
  if (!res.ok) {
    throw new DokuApiError(
      `DOKU check-status failed (${res.status}).`,
      res.status,
      text
    );
  }

  let parsed: {
    order?: { status?: string; amount?: number | string };
    transaction?: { status?: string };
    channel?: { id?: string };
    acquirer?: { id?: string };
  };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new DokuApiError("DOKU returned a non-JSON response.", res.status, text);
  }

  const amount = Number(parsed.order?.amount);
  return {
    transactionStatus: (parsed.transaction?.status ?? "").toUpperCase(),
    orderStatus: parsed.order?.status ?? null,
    amount: Number.isFinite(amount) ? amount : null,
    paymentMethod: parsed.channel?.id ?? parsed.acquirer?.id ?? null,
    raw: parsed,
  };
}

export type CheckoutPaymentResult = {
  paymentUrl: string;
  tokenId: string | null;
  raw: unknown;
};

/**
 * Create a DOKU Checkout payment session and return the hosted payment page URL.
 * The caller redirects the browser to `paymentUrl`. Fulfillment happens later via
 * the notification webhook — never assume success from the redirect alone.
 */
export async function createCheckoutPayment(params: {
  invoiceNumber: string;
  amountIdr: number;
  customer: { id: string; name: string; email: string };
  successUrl: string;
  /**
   * Per-request override of the Back Office Notification URL. The PATH must match
   * the one configured in the DOKU dashboard; only the domain may differ. Lets a
   * changing dev tunnel domain work without editing the Back Office each time.
   */
  notificationUrl?: string;
  /** Minutes until the payment expires (DOKU default ~60). */
  paymentDueMinutes?: number;
  lineItem?: { name: string; quantity: number; price: number };
}): Promise<CheckoutPaymentResult> {
  const { clientId, secretKey, baseUrl } = getConfig();

  const body: Record<string, unknown> = {
    order: {
      amount: params.amountIdr,
      invoice_number: params.invoiceNumber,
      currency: "IDR",
      callback_url: params.successUrl,
      line_items: params.lineItem
        ? [
            {
              name: sanitizeText(params.lineItem.name, "Credits"),
              quantity: params.lineItem.quantity,
              price: params.lineItem.price,
            },
          ]
        : undefined,
    },
    payment: {
      payment_due_date: params.paymentDueMinutes ?? 60,
    },
    customer: {
      id: params.customer.id,
      name: sanitizeText(params.customer.name, "Kelolako Customer"),
      email: params.customer.email,
    },
    ...(params.notificationUrl
      ? { additional_info: { override_notification_url: params.notificationUrl } }
      : {}),
  };

  const rawBody = JSON.stringify(body);
  const requestId = crypto.randomUUID();
  const timestamp = dokuTimestamp();
  const signature = buildSignature({
    clientId,
    secretKey,
    requestId,
    timestamp,
    target: CHECKOUT_PATH,
    rawBody,
  });

  const res = await fetch(`${baseUrl}${CHECKOUT_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Client-Id": clientId,
      "Request-Id": requestId,
      "Request-Timestamp": timestamp,
      Signature: signature,
    },
    body: rawBody,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new DokuApiError(
      `DOKU create-payment failed (${res.status}).`,
      res.status,
      text
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new DokuApiError("DOKU returned a non-JSON response.", res.status, text);
  }

  const payment = (parsed as { response?: { payment?: { url?: string; token_id?: string } } })
    ?.response?.payment;
  const paymentUrl = payment?.url;
  if (!paymentUrl) {
    throw new DokuApiError(
      "DOKU response did not include a payment URL.",
      res.status,
      text
    );
  }

  return { paymentUrl, tokenId: payment?.token_id ?? null, raw: parsed };
}

/**
 * Verify an inbound DOKU notification signature. Recomputes the signature from
 * the RAW request body (parse only AFTER this passes) and the request headers,
 * then compares in constant time. `target` is the path DOKU called (our webhook).
 */
export function verifyNotificationSignature(params: {
  headers: {
    clientId: string | null;
    requestId: string | null;
    timestamp: string | null;
    signature: string | null;
  };
  rawBody: string;
  target?: string;
}): boolean {
  let secretKey: string;
  try {
    secretKey = getConfig().secretKey;
  } catch {
    return false;
  }

  const { clientId, requestId, timestamp, signature } = params.headers;
  if (!clientId || !requestId || !timestamp || !signature) return false;

  const expected = buildSignature({
    clientId,
    secretKey,
    requestId,
    timestamp,
    target: params.target ?? DOKU_WEBHOOK_PATH,
    rawBody: params.rawBody,
  });

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
