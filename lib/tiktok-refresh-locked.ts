/**
 * TikTok refresh + persist under one durable lock per (user_id, tiktok).
 * Callers (creator-info and the publisher cron) must not call
 * refreshAccessToken themselves — TikTok rotates refresh_token on every
 * call, so a loser must re-read the persisted row instead.
 */

import "server-only";

import { supabaseServer } from "@/lib/supabase-server";
import { refreshAccessToken } from "@/lib/tiktok";
import {
  TIKTOK_RECONNECT_MESSAGE,
  tiktokLoserAfterReread,
  tiktokRefreshAfterClaim,
  tiktokRotatedRefreshPersistDenied,
  type TikTokRefreshClaim,
} from "@/lib/tiktok-oauth-pure";

const CLAIM_RPC = "krakatoa_claim_platform_token_refresh";
const COMPLETE_RPC = "krakatoa_complete_platform_token_refresh";
const RELEASE_RPC = "krakatoa_release_platform_token_refresh";
const PLATFORM = "tiktok";
const LOCK_SECONDS = 45;
const LOSER_REREAD_ATTEMPTS = 4;
const LOSER_REREAD_WAIT_MS = 200;

export type TikTokLockedRefreshOk = {
  ok: true;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
};

export type TikTokLockedRefreshDenied = {
  ok: false;
  status: 409;
  error: string;
};

export type TikTokLockedRefreshResult = TikTokLockedRefreshOk | TikTokLockedRefreshDenied;

type ClaimRow = TikTokRefreshClaim & {
  access_token?: string | null;
  refresh_token?: string | null;
  expires_at?: string | null;
};

function reconnectDenied(): TikTokLockedRefreshDenied {
  return { ok: false, status: 409, error: TIKTOK_RECONNECT_MESSAGE };
}

function parseClaim(data: unknown): ClaimRow {
  if (!data || typeof data !== "object") {
    return { claimed: false, reason: "missing" };
  }
  const row = data as Record<string, unknown>;
  const reason = row.reason === "held" || row.reason === "missing" ? row.reason : undefined;
  return {
    claimed: row.claimed === true,
    reason,
    access_token: typeof row.access_token === "string" ? row.access_token : null,
    refresh_token: typeof row.refresh_token === "string" ? row.refresh_token : null,
    expires_at: typeof row.expires_at === "string" ? row.expires_at : null,
  };
}

async function releaseLock(userId: string): Promise<void> {
  try {
    await supabaseServer.rpc(RELEASE_RPC, {
      p_user_id: userId,
      p_platform: PLATFORM,
    });
  } catch {
    // Best-effort: the lease expires on its own.
  }
}

async function rereadPersisted(
  userId: string,
  claimedRefreshToken: string | null,
): Promise<TikTokLockedRefreshResult> {
  let last: {
    access_token: string;
    refresh_token: string | null;
    expires_at: string;
  } | null = null;

  for (let attempt = 0; attempt < LOSER_REREAD_ATTEMPTS; attempt++) {
    const { data, error } = await supabaseServer
      .from("platform_tokens")
      .select("access_token, refresh_token, expires_at")
      .eq("user_id", userId)
      .eq("platform", PLATFORM)
      .maybeSingle();

    if (error || !data?.access_token) {
      return reconnectDenied();
    }

    last = {
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? null,
      expires_at: data.expires_at,
    };

    const next = tiktokLoserAfterReread({
      claimedRefreshToken: claimedRefreshToken ?? "",
      rereadRefreshToken: data.refresh_token,
    });
    if (next === "use_persisted") {
      return {
        ok: true,
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? "",
        expiresAt: data.expires_at,
      };
    }

    if (attempt < LOSER_REREAD_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, LOSER_REREAD_WAIT_MS));
    }
  }

  if (!last) return reconnectDenied();
  return {
    ok: true,
    accessToken: last.access_token,
    refreshToken: last.refresh_token ?? "",
    expiresAt: last.expires_at,
  };
}

export async function refreshTikTokTokensLocked(
  userId: string,
): Promise<TikTokLockedRefreshResult> {
  const { data, error } = await supabaseServer.rpc(CLAIM_RPC, {
    p_user_id: userId,
    p_platform: PLATFORM,
    p_lock_seconds: LOCK_SECONDS,
  });

  if (error || data == null) {
    return reconnectDenied();
  }

  const claim = parseClaim(data);
  const action = tiktokRefreshAfterClaim(claim);

  if (action === "missing") {
    return reconnectDenied();
  }
  if (action === "reread") {
    return rereadPersisted(userId, claim.refresh_token ?? null);
  }
  if (!claim.refresh_token) {
    await releaseLock(userId);
    return reconnectDenied();
  }

  let refreshed;
  try {
    refreshed = await refreshAccessToken(claim.refresh_token);
  } catch (err) {
    await releaseLock(userId);
    throw err;
  }

  const expiresAt = new Date(Date.now() + refreshed.expiresIn * 1000).toISOString();
  const { error: persistErr } = await supabaseServer.rpc(COMPLETE_RPC, {
    p_user_id: userId,
    p_platform: PLATFORM,
    p_access_token: refreshed.accessToken,
    p_refresh_token: refreshed.refreshToken,
    p_expires_at: expiresAt,
  });

  const persistDenied = tiktokRotatedRefreshPersistDenied(persistErr);
  if (persistDenied) {
    return { ok: false, status: persistDenied.status, error: persistDenied.error };
  }

  return {
    ok: true,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    expiresAt,
  };
}
