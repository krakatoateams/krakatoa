import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/resolve-user";
import { supabaseServer } from "@/lib/supabase-server";
import { getCreatorInfo, refreshAccessToken, TikTokCreatorInfoError, type TikTokCreatorInfo } from "@/lib/tiktok";
import { classifyTikTokCreatorInfoError } from "@/lib/tiktok-creator-info-pure";
import { tiktokRotatedRefreshPersistDenied } from "@/lib/tiktok-oauth-pure";

function successResponse(info: TikTokCreatorInfo) {
  return NextResponse.json({
    privacyLevelOptions: info.privacyLevelOptions,
    creatorNickname: info.creatorNickname,
    commentDisabled: info.commentDisabled,
    duetDisabled: info.duetDisabled,
    stitchDisabled: info.stitchDisabled,
    maxVideoPostDurationSec: info.maxVideoPostDurationSec,
    postingBlocked: false,
    blockedReason: null,
    rateLimited: false,
    rateLimitedReason: null,
  });
}

// A classified TikTok error (banned / daily cap) means the *account* is the
// problem, not the access token — never worth a token refresh+retry.
function classifiedResponse(err: TikTokCreatorInfoError) {
  const cls = classifyTikTokCreatorInfoError(err.code);
  return NextResponse.json({
    privacyLevelOptions: [],
    creatorNickname: "",
    commentDisabled: false,
    duetDisabled: false,
    stitchDisabled: false,
    maxVideoPostDurationSec: 0,
    postingBlocked: cls.severity === "blocked",
    blockedReason: cls.severity === "blocked" ? cls.message : null,
    rateLimited: cls.severity === "rate_limited",
    rateLimitedReason: cls.severity === "rate_limited" ? cls.message : null,
  });
}

/**
 * GET /api/connections/tiktok/creator-info — read-only preview of the
 * connected TikTok account's creator info, used by the scheduler to populate
 * the required privacy-level dropdown (never defaulted silently — see
 * openspec/changes/tiktok-publish/design.md, Decision 4), the interaction
 * toggles' greyed-out state, the duration cap, and whether the account can
 * post at all right now (banned vs. a same-moment daily cap — the scheduler
 * treats these very differently, see the TikTok resubmission plan).
 */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { data: token, error } = await supabaseServer
    .from("platform_tokens")
    .select("access_token, refresh_token")
    .eq("user_id", userId)
    .eq("platform", "tiktok")
    .maybeSingle();

  if (error || !token) {
    return NextResponse.json({ error: "TikTok not connected." }, { status: 404 });
  }

  try {
    const info = await getCreatorInfo(token.access_token);
    return successResponse(info);
  } catch (err) {
    if (err instanceof TikTokCreatorInfoError) {
      return classifiedResponse(err);
    }

    // Access token likely expired — refresh once, persist the rotated
    // refresh_token immediately (same ordering as the cron's publish path —
    // see Decision 3), then retry.
    if (!token.refresh_token) {
      return NextResponse.json({ error: "TikTok connection needs to be re-authorized." }, { status: 409 });
    }
    try {
      const refreshed = await refreshAccessToken(token.refresh_token);

      const { error: refreshUpsertErr } = await supabaseServer.from("platform_tokens").upsert(
        {
          user_id: userId,
          platform: "tiktok",
          access_token: refreshed.accessToken,
          refresh_token: refreshed.refreshToken,
          expires_at: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString(),
        },
        { onConflict: "user_id,platform" },
      );

      const persistDenied = tiktokRotatedRefreshPersistDenied(refreshUpsertErr);
      if (persistDenied) {
        console.error(
          "[tiktok-creator-info] failed to persist refreshed token:",
          refreshUpsertErr?.message,
        );
        return NextResponse.json({ error: persistDenied.error }, { status: persistDenied.status });
      }

      const info = await getCreatorInfo(refreshed.accessToken);
      return successResponse(info);
    } catch (retryErr) {
      if (retryErr instanceof TikTokCreatorInfoError) {
        return classifiedResponse(retryErr);
      }
      console.error("[tiktok-creator-info] failed after refresh:", retryErr);
      return NextResponse.json({ error: "Failed to fetch TikTok creator info." }, { status: 502 });
    }
  }
}
