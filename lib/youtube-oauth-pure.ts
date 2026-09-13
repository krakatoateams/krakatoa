/**
 * Pure YouTube OAuth persist decisions. Split from the callback route so
 * reconnect-without-refresh cannot silently wipe a stored refresh_token.
 *
 * Google often omits refresh_token on a second consent even with
 * prompt=consent. The callback comment already admits a prior row may still
 * hold a valid refresh — the upsert must not replace it with null.
 */

import { readFileSync } from "node:fs";

export function youtubeRefreshTokenForUpsert(
  incoming: string | null | undefined,
  existing: string | null | undefined,
): string | null {
  if (incoming) return incoming;
  return existing ?? null;
}

/** When Google omitted refresh, a failed existing-row lookup must not upsert. */
export function youtubeRefreshLookupDenied(
  incoming: string | null | undefined,
  lookupError: { message?: string } | null | undefined,
): boolean {
  return Boolean(lookupError) && !incoming;
}

export function youtubeOAuthSelfCheck(): void {
  const preserved = youtubeRefreshTokenForUpsert(null, "stored-refresh");
  if (preserved !== "stored-refresh") {
    throw new Error("reconnect without a new refresh_token must keep the stored one");
  }
  if (youtubeRefreshTokenForUpsert(undefined, "stored-refresh") !== "stored-refresh") {
    throw new Error("omitted refresh_token must keep the stored one");
  }
  if (youtubeRefreshTokenForUpsert("new-refresh", "stored-refresh") !== "new-refresh") {
    throw new Error("a new refresh_token from Google must replace the stored one");
  }
  if (youtubeRefreshTokenForUpsert(null, null) !== null) {
    throw new Error("first connect without a refresh_token still stores null");
  }
  if (youtubeRefreshTokenForUpsert("", "stored-refresh") !== "stored-refresh") {
    throw new Error("empty-string refresh_token must not wipe the stored one");
  }

  if (!youtubeRefreshLookupDenied(null, { message: "select failed" })) {
    throw new Error("a failed existing-row lookup without a new refresh must fail closed");
  }
  if (youtubeRefreshLookupDenied("new-refresh", { message: "select failed" })) {
    throw new Error("a new refresh_token can persist even if the existing-row lookup failed");
  }
  if (youtubeRefreshLookupDenied(null, null)) {
    throw new Error("a successful lookup without a new refresh must proceed to preserve");
  }

  for (const relative of [
    "../app/api/connections/youtube/start/route.ts",
    "../app/api/connections/youtube/callback/route.ts",
  ]) {
    const source = readFileSync(new URL(relative, import.meta.url), "utf8");
    if (!source.includes("resolveOrigin")) {
      throw new Error(`${relative} must use resolveOrigin like TikTok`);
    }
    if (/const \{[^}]*origin[^}]*\} = new URL\(request\.url\)/.test(source)) {
      throw new Error(`${relative} must not bind OAuth origin from request.url`);
    }
  }
}

if (require.main === module) {
  youtubeOAuthSelfCheck();
  console.log("youtubeOAuthSelfCheck: ok");
}
