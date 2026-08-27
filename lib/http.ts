/**
 * `new URL(request.url).origin` reports the Next.js dev server's own bind
 * address (localhost:PORT) instead of the actual Host header, breaking
 * redirect_uri when testing behind a tunnel (e.g. ngrok). Reading Host /
 * X-Forwarded-Proto directly matches what the browser actually requested,
 * and still resolves correctly in production (Vercel sets both headers).
 *
 * Shared across every OAuth connect flow (TikTok, Instagram, ...) — not
 * provider-specific despite originating in lib/tiktok.ts.
 */
export function resolveOrigin(request: Request): string {
  const host = request.headers.get("host") ?? new URL(request.url).host;
  const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  return `${proto}://${host}`;
}

/** Strip common .env paste mistakes from NEXTAUTH_URL values. */
function normalizeSiteUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim();
  // e.g. `NEXTAUTH_URL=https://kelolako.com` pasted as the value
  value = value.replace(/^(?:NEXTAUTH_URL|nextauth_url)\s*=\s*/i, "");
  value = value.replace(/^["']|["']$/g, "").trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Canonical absolute site origin for payment redirects, metadataBase, etc.
 * Prefers NEXTAUTH_URL; tolerates mis-pasted values; falls back to VERCEL_URL.
 */
export function resolveSiteOrigin(): string {
  const raw = process.env.NEXTAUTH_URL?.trim();
  const fromEnv = normalizeSiteUrl(raw);
  if (fromEnv) return fromEnv;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}
