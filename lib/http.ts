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
