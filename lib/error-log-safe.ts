import { redactPublishMediaRef } from "@/lib/tiktok-publish-pure";

/**
 * Convert an unexpected operational error to one log-safe line.
 * Keep the reason, but never emit stack frames, signed query strings, or
 * common bearer/OAuth/API credential values.
 */
export function errorLogSafe(error: unknown): string {
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : String(error);

  return message
    .replace(/\s+/g, " ")
    .trim()
    .replace(
      /\bAuthorization\s*:\s*(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi,
      "Authorization: [redacted]"
    )
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      "[redacted-jwt]"
    )
    .replace(/https?:\/\/[^\s]+/gi, (url) => redactPublishMediaRef(url))
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\bBasic\s+[A-Za-z0-9+/=]+/gi, "Basic [redacted]")
    .replace(
      /\b(access_token|refresh_token|id_token|token|api[_-]?key|service[_-]?role[_-]?key|secret[_-]?key|client[_-]?secret|password|authorization)\b["']?(\s*[:=]\s*)(["']?)[^\s,;}"']+\3/gi,
      (_match, key: string, separator: string) =>
        `${key}${separator}[redacted]`
    );
}

/**
 * Generation providers may echo a user prompt in `error.message`. Generation
 * logs therefore keep only stable error metadata; detailed messages remain in
 * owner-scoped job/request state for admin monitoring.
 */
export function generationErrorLogSafe(error: unknown): string {
  if (!error || typeof error !== "object") return "GenerationError";
  const record = error as { name?: unknown; code?: unknown; status?: unknown };
  const name =
    typeof record.name === "string" &&
    /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(record.name)
      ? record.name
      : "GenerationError";
  const code =
    typeof record.code === "string" && /^[A-Z0-9_]{1,64}$/.test(record.code)
      ? record.code
      : null;
  const status =
    typeof record.status === "number" &&
    Number.isInteger(record.status) &&
    record.status >= 100 &&
    record.status <= 599
      ? record.status
      : null;
  return [name, code ? `code=${code}` : null, status ? `status=${status}` : null]
    .filter(Boolean)
    .join(" ");
}
