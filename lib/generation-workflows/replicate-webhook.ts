import { validateWebhook } from "replicate";
import { webcrypto } from "node:crypto";
import { createReplicateClient } from "@/lib/replicate-utils";

let cachedSecret: string | null = null;

/** Resolve Replicate webhook signing secret (env override or account default). */
export async function resolveReplicateWebhookSecret(): Promise<string> {
  const envSecret = process.env.REPLICATE_WEBHOOK_SECRET?.trim();
  if (envSecret) return envSecret;

  if (cachedSecret) return cachedSecret;

  const replicate = createReplicateClient();
  const secretPayload = await replicate.webhooks.default.secret.get();
  const key = secretPayload?.key?.trim();
  if (!key) {
    throw new Error("Replicate default webhook secret is unavailable.");
  }
  cachedSecret = key;
  return key;
}

export async function verifyReplicateWebhookRequest(
  req: Request,
  rawBody: string,
): Promise<boolean> {
  const secret = await resolveReplicateWebhookSecret();
  return validateWebhook(
    {
      id: req.headers.get("webhook-id") ?? "",
      timestamp: req.headers.get("webhook-timestamp") ?? "",
      signature: req.headers.get("webhook-signature") ?? "",
      body: rawBody,
      secret,
    },
    webcrypto as Crypto,
  );
}

export type ReplicateWebhookPayload = {
  id: string;
  status: string;
  output?: unknown;
  error?: unknown;
};

export function parseReplicateWebhookPayload(rawBody: string): ReplicateWebhookPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const id = typeof obj.id === "string" ? obj.id : "";
  const status = typeof obj.status === "string" ? obj.status : "";
  if (!id || !status) return null;
  return {
    id,
    status,
    output: obj.output,
    error: obj.error,
  };
}

export function siteOrigin(): string {
  const explicit = process.env.NEXTAUTH_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export function replicateWebhookCallbackUrl(submissionId: string, token: string): string {
  const origin = siteOrigin();
  const qs = new URLSearchParams({ t: token });
  return `${origin}/api/webhooks/replicate/${submissionId}?${qs.toString()}`;
}
