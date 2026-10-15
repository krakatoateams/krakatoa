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

export type YoutubeCallbackNext =
  | "invalid_state"
  | "youtube_connect_failed"
  | "exchange";

/**
 * CSRF first, then session, then code exchange. A missing session must never
 * reach Google getToken — the authorization code is single-use.
 */
export function youtubeCallbackNextStep(input: {
  state: string | null;
  storedState: string | null;
  code: string | null;
  userId: string | null;
}): YoutubeCallbackNext {
  if (!input.state || !input.storedState || input.state !== input.storedState) {
    return "invalid_state";
  }
  if (!input.code || !input.userId) return "youtube_connect_failed";
  return "exchange";
}

/** Result of reading the connecting account's own channel (channels.list mine=true). */
export type YoutubeChannelLookup =
  | { kind: "found"; title: string }
  | { kind: "none" }
  | { kind: "error" };

export type YoutubeChannelGate = {
  /** Save the token, i.e. YouTube shows as connected. */
  persist: boolean;
  /** Channel name to store as the YouTube username. */
  username: string | null;
  /** Delete this user's previously stored YouTube connection. */
  removeExisting: boolean;
  /** Revoke the grant Google just issued, since we won't keep it. */
  revokeGrant: boolean;
  /** `error` URL param for Settings → Connections, if any. */
  errorParam: string | null;
};

/**
 * Publishing can't work without a channel, so a confirmed channel-less
 * account must never end up "Connected". A failed lookup is not proof of a
 * missing channel, so it still connects rather than blocking a real channel
 * on a transient error.
 *
 * `existing` is the stored connection's own channel lookup (made with its
 * stored token), or "absent". We can't tell whether the newly picked Google
 * account is the stored one, so the stored connection is judged on its own:
 * - no channel either → it can never publish, so clear it
 * - has a channel → a different, working account: keep it
 * - can't be checked → keep it, and don't revoke: it may share the grant
 */
export function youtubeChannelGate(input: {
  lookup: YoutubeChannelLookup;
  existing: YoutubeChannelLookup | "absent";
}): YoutubeChannelGate {
  const { lookup, existing } = input;
  if (lookup.kind === "none") {
    const existingUncheckable = existing !== "absent" && existing.kind === "error";
    return {
      persist: false,
      username: null,
      removeExisting: existing !== "absent" && existing.kind === "none",
      revokeGrant: !existingUncheckable,
      errorParam: "youtube_no_channel",
    };
  }
  return {
    persist: true,
    username: lookup.kind === "found" ? lookup.title : null,
    removeExisting: false,
    revokeGrant: false,
    errorParam: null,
  };
}

/** The callback must read the channel before its token upsert (see youtubeChannelGate). */
export function youtubeCallbackChecksChannelBeforeSaving(source: string): boolean {
  const lookupIdx = source.search(/lookupYouTubeChannel\s*\(/);
  const upsertIdx = source.search(/\.upsert\s*\(/);
  return lookupIdx >= 0 && upsertIdx >= 0 && lookupIdx < upsertIdx;
}

export function youtubeCallbackBindsSessionBeforeCodeExchange(source: string): boolean {
  const sessionIdx = source.search(/await getSessionUserId\s*\(/);
  const tokenIdx = source.search(/\.getToken\s*\(/);
  return sessionIdx >= 0 && tokenIdx >= 0 && sessionIdx < tokenIdx;
}

export function youtubeOAuthSelfCheck(): void {
  // ── Channel gate: no channel → never a saved ("Connected") YouTube ──────
  type Gate = ReturnType<typeof youtubeChannelGate>;
  const expectGate = (actual: Gate, expected: Gate, why: string) => {
    for (const key of Object.keys(expected) as (keyof Gate)[]) {
      if (actual[key] !== expected[key]) {
        throw new Error(`${why} (${key}: expected ${String(expected[key])}, got ${String(actual[key])})`);
      }
    }
  };

  expectGate(
    youtubeChannelGate({ lookup: { kind: "found", title: "Kelolako Studio" }, existing: "absent" }),
    { persist: true, username: "Kelolako Studio", removeExisting: false, revokeGrant: false, errorParam: null },
    "an account with a channel connects and stores the channel name",
  );

  // A failed lookup is not proof of a missing channel. It still connects, and
  // stores no name, so an old channel's name can't stick to new tokens.
  expectGate(
    youtubeChannelGate({ lookup: { kind: "error" }, existing: { kind: "found", title: "Old" } }),
    { persist: true, username: null, removeExisting: false, revokeGrant: false, errorParam: null },
    "a failed lookup still connects, without a name",
  );

  const noChannel = { persist: false, username: null, errorParam: "youtube_no_channel" } as const;

  expectGate(
    youtubeChannelGate({ lookup: { kind: "none" }, existing: "absent" }),
    { ...noChannel, removeExisting: false, revokeGrant: true },
    "a first connect with no channel stores nothing and revokes the grant",
  );

  // The stored connection has no channel either: it can never publish.
  expectGate(
    youtubeChannelGate({ lookup: { kind: "none" }, existing: { kind: "none" } }),
    { ...noChannel, removeExisting: true, revokeGrant: true },
    "a channel-less reconnect clears a stored connection that has no channel",
  );

  // The stored connection has a channel, so it is a different, working
  // account: keep it. Revoking is safe because the grants differ.
  expectGate(
    youtubeChannelGate({ lookup: { kind: "none" }, existing: { kind: "found", title: "Real" } }),
    { ...noChannel, removeExisting: false, revokeGrant: true },
    "picking a channel-less account on Reconnect keeps a working connection",
  );

  // The stored connection can't be checked (e.g. it predates youtube.readonly).
  // It may be the same Google account, whose grant a revoke would kill.
  expectGate(
    youtubeChannelGate({ lookup: { kind: "none" }, existing: { kind: "error" } }),
    { ...noChannel, removeExisting: false, revokeGrant: false },
    "an uncheckable stored connection is kept and its possibly shared grant is not revoked",
  );

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

  if (
    youtubeCallbackNextStep({
      state: "s",
      storedState: "s",
      code: "auth-code",
      userId: null,
    }) !== "youtube_connect_failed"
  ) {
    throw new Error("a signed-out callback must fail closed before any code exchange");
  }
  if (
    youtubeCallbackNextStep({
      state: "s",
      storedState: "other",
      code: "auth-code",
      userId: null,
    }) !== "invalid_state"
  ) {
    throw new Error("CSRF must be rejected before the session or code-exchange checks");
  }
  if (
    youtubeCallbackNextStep({
      state: "s",
      storedState: "s",
      code: "auth-code",
      userId: "user-1",
    }) !== "exchange"
  ) {
    throw new Error("a signed-in callback with a valid state and code may exchange");
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

  const callbackSource = readFileSync(
    new URL("../app/api/connections/youtube/callback/route.ts", import.meta.url),
    "utf8",
  );
  if (
    !youtubeCallbackChecksChannelBeforeSaving(
      "const t = await lookupYouTubeChannel(r);\nawait db.from('platform_tokens').upsert(row);",
    ) ||
    youtubeCallbackChecksChannelBeforeSaving(
      "await db.from('platform_tokens').upsert(row);\nconst t = await lookupYouTubeChannel(r);",
    )
  ) {
    throw new Error("the channel-before-save check must tell the two orders apart");
  }
  if (!youtubeCallbackChecksChannelBeforeSaving(callbackSource)) {
    throw new Error(
      "YouTube callback must look up the channel before saving the token, so a channel-less account is never stored as connected",
    );
  }
  if (!youtubeCallbackBindsSessionBeforeCodeExchange(callbackSource)) {
    throw new Error(
      "YouTube callback must bind the session before Google getToken so a logged-out browser cannot consume the authorization code",
    );
  }
}

if (require.main === module) {
  youtubeOAuthSelfCheck();
  console.log("youtubeOAuthSelfCheck: ok");
}
