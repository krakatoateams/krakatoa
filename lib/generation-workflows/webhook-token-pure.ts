import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_VERSION = "v1";

export function signWebhookCallbackToken(submissionId: string, secret: string): string {
  if (!submissionId.trim()) throw new Error("submissionId required");
  if (!secret.trim()) throw new Error("webhook callback secret required");
  const digest = createHmac("sha256", secret)
    .update(`${TOKEN_VERSION}:${submissionId}`)
    .digest("base64url");
  return `${TOKEN_VERSION}.${digest}`;
}

export function verifyWebhookCallbackToken(
  submissionId: string,
  token: string,
  secret: string,
): boolean {
  if (!token.startsWith(`${TOKEN_VERSION}.`)) return false;
  const expected = signWebhookCallbackToken(submissionId, secret);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function webhookCallbackSecret(): string {
  const dedicatedSecret = process.env.GENERATION_WEBHOOK_SECRET?.trim();
  if (dedicatedSecret) return dedicatedSecret;

  if (process.env.NODE_ENV !== "production") {
    const localFallback = process.env.NEXTAUTH_SECRET?.trim();
    if (localFallback) return localFallback;
  }

  throw new Error(
    "GENERATION_WEBHOOK_SECRET is required for Replicate webhook callback binding.",
  );
}
