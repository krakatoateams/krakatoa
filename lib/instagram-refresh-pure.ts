/**
 * Instagram Phase 3 — proactive long-lived token refresh decisions.
 * See openspec/changes/connect-instagram/design.md Decision 2 / 2b.
 */

import { readFileSync } from "node:fs";

/** Meta's long-lived Instagram user token lifetime. */
export const INSTAGRAM_LONG_LIVED_MS = 60 * 24 * 60 * 60 * 1000;
export const INSTAGRAM_REFRESH_MIN_AGE_MS = 24 * 60 * 60 * 1000;
/** Start refreshing this far before expiry; keep trying until expiry. */
export const INSTAGRAM_REFRESH_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export function instagramRefreshWindowEndIso(nowMs: number): string {
  return new Date(nowMs + INSTAGRAM_REFRESH_WINDOW_MS).toISOString();
}

/**
 * A stored Instagram token is due when it is not yet expired, expires inside
 * the next 14 days, and the current access_token is at least 24 hours old.
 * The 7–14 day wording is the multi-day retry margin (a miss on day 14 still
 * gets later daily ticks) — rows closer than 7 days stay eligible.
 */
export function instagramTokenDueForRefresh(input: {
  expiresAtMs: number;
  nowMs: number;
  createdAtMs?: number;
}): boolean {
  const timeUntilExpiry = input.expiresAtMs - input.nowMs;
  if (timeUntilExpiry <= 0) return false;
  if (timeUntilExpiry > INSTAGRAM_REFRESH_WINDOW_MS) return false;

  const inferredIssuedAtMs = input.expiresAtMs - INSTAGRAM_LONG_LIVED_MS;
  const tokenIssuedAtMs = Math.max(inferredIssuedAtMs, input.createdAtMs ?? inferredIssuedAtMs);
  return input.nowMs - tokenIssuedAtMs >= INSTAGRAM_REFRESH_MIN_AGE_MS;
}

export function instagramRefreshedTokenRow(input: {
  accessToken: string;
  expiresIn: number;
  nowMs: number;
}): { access_token: string; refresh_token: null; expires_at: string } {
  return {
    access_token: input.accessToken,
    refresh_token: null,
    expires_at: new Date(input.nowMs + input.expiresIn * 1000).toISOString(),
  };
}

/** Transient Graph failures must not delete a still-valid row. */
export function instagramRefreshIsTransient(httpStatus: number): boolean {
  return httpStatus >= 500 || httpStatus === 429;
}

export function instagramRefreshShouldWipeRow(): false {
  return false;
}

export function instagramRefreshLogSafe(detail: string): string {
  return detail
    .replace(/\bIGQWA[A-Za-z0-9._~+/-]+/g, "[redacted-token]")
    .replace(
      /\b(access_token|refresh_token)\b["']?(\s*[:=]\s*)(["']?)[^\s,;}"']+\3/gi,
      (_m, key: string, sep: string) => `${key}${sep}[redacted]`,
    );
}

export function instagramRefreshSelfCheck(): void {
  const now = Date.parse("2026-09-13T00:00:00.000Z");
  const day = 24 * 60 * 60 * 1000;

  if (
    !instagramTokenDueForRefresh({
      expiresAtMs: now + 10 * day,
      nowMs: now,
    })
  ) {
    throw new Error("a token expiring in 10 days must be selected for proactive refresh");
  }
  if (
    instagramTokenDueForRefresh({
      expiresAtMs: now + 20 * day,
      nowMs: now,
    })
  ) {
    throw new Error("a token more than 14 days from expiry must not be refreshed yet");
  }
  if (
    instagramTokenDueForRefresh({
      expiresAtMs: now - day,
      nowMs: now,
    })
  ) {
    throw new Error("an already-expired token must not be refreshed");
  }
  if (
    !instagramTokenDueForRefresh({
      expiresAtMs: now + 6 * day,
      nowMs: now,
    })
  ) {
    throw new Error("a token with 6 days left must still be retried (7–14 day safety margin)");
  }
  if (
    instagramTokenDueForRefresh({
      expiresAtMs: now + 10 * day,
      nowMs: now,
      createdAtMs: now - 60 * 60 * 1000,
    })
  ) {
    throw new Error("a token younger than 24 hours must not be refreshed");
  }

  const persisted = instagramRefreshedTokenRow({
    accessToken: "IGQW-new",
    expiresIn: 5_184_000,
    nowMs: now,
  });
  if (persisted.refresh_token !== null) {
    throw new Error("Instagram persist must keep refresh_token null — do not invent one");
  }
  if (persisted.access_token !== "IGQW-new") {
    throw new Error("Instagram persist must store the new access_token");
  }
  if (persisted.expires_at !== new Date(now + 5_184_000 * 1000).toISOString()) {
    throw new Error("Instagram persist must set expires_at from expires_in");
  }

  if (!instagramRefreshIsTransient(503)) {
    throw new Error("Graph 5xx must be treated as transient and leave the row");
  }
  if (instagramRefreshIsTransient(400)) {
    throw new Error("Graph 400 invalid/expired must leave the row without retrying as transient");
  }
  if (instagramRefreshShouldWipeRow() !== false) {
    throw new Error("Instagram refresh must never wipe a platform_tokens row");
  }
  if (instagramRefreshLogSafe("access_token=IGQW-secret").includes("IGQW-secret")) {
    throw new Error("refresh logs must not include token material");
  }

  const libSource = readFileSync(new URL("./instagram.ts", import.meta.url), "utf8");
  if (!libSource.includes("export async function refreshLongLivedToken")) {
    throw new Error("lib/instagram.ts must export refreshLongLivedToken");
  }
  if (!libSource.includes("graph.instagram.com/refresh_access_token")) {
    throw new Error("refreshLongLivedToken must call Graph refresh_access_token");
  }
  if (!libSource.includes("ig_refresh_token")) {
    throw new Error("refreshLongLivedToken must use grant_type=ig_refresh_token");
  }

  const route = readFileSync(
    new URL("../app/api/cron/instagram-token-refresh/route.ts", import.meta.url),
    "utf8",
  );
  if (!route.includes("cronAuthorizationFailure(req)")) {
    throw new Error("instagram-token-refresh must use the shared cron authorization guard");
  }
  if (route.includes("process.env.CRON_SECRET")) {
    throw new Error("instagram-token-refresh must not reimplement the shared secret policy");
  }
  if (!route.includes('platform", "instagram"') && !route.includes("platform: \"instagram\"")) {
    if (!/platform['\"]\s*,\s*['\"]instagram['\"]/.test(route) && !route.includes('eq("platform", "instagram")')) {
      throw new Error("instagram-token-refresh must select only Instagram platform_tokens rows");
    }
  }
  if (route.includes("tiktok") || route.includes("youtube")) {
    throw new Error("instagram-token-refresh must not refresh TikTok or YouTube");
  }

  const vercel = readFileSync(new URL("../vercel.json", import.meta.url), "utf8");
  if (!vercel.includes("/api/cron/instagram-token-refresh")) {
    throw new Error("vercel.json must register the Instagram refresh cron");
  }
  if (/\*\/30/.test(vercel)) {
    throw new Error("Vercel Hobby forbids */30 native crons");
  }
}

if (require.main === module) {
  instagramRefreshSelfCheck();
  console.log("instagramRefreshSelfCheck: ok");
}
