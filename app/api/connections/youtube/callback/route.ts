import { type NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getSessionUserId } from "@/lib/resolve-user";
import { supabaseServer } from "@/lib/supabase-server";
import { resolveOrigin } from "@/lib/http";
import { getYouTubeChannelTitle } from "@/lib/youtube";
import { updatePlatformUsername } from "@/lib/platform-tokens";
import {
  youtubeRefreshLookupDenied,
  youtubeRefreshTokenForUpsert,
} from "@/lib/youtube-oauth-pure";

const STATE_COOKIE = "youtube_oauth_state";

function clearState(response: NextResponse): NextResponse {
  response.cookies.set(STATE_COOKIE, "", { maxAge: 0, path: "/" });
  return response;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const origin = resolveOrigin(request);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const storedState = request.cookies.get(STATE_COOKIE)?.value;

  const settingsBase = `${origin}/dashboard/settings?tab=connections`;

  // CSRF validation — must happen before any other processing.
  if (!state || !storedState || state !== storedState) {
    console.warn("[youtube-connect] CSRF state mismatch or missing cookie");
    return clearState(NextResponse.redirect(`${settingsBase}&error=invalid_state`));
  }

  if (!code) {
    return clearState(NextResponse.redirect(`${settingsBase}&error=youtube_connect_failed`));
  }

  const userId = await getSessionUserId();
  if (!userId) {
    // Do not consume the single-use authorization code while signed out.
    return clearState(NextResponse.redirect(`${settingsBase}&error=youtube_connect_failed`));
  }

  try {
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID!,
      process.env.GOOGLE_CLIENT_SECRET!,
      `${origin}/api/connections/youtube/callback`,
    );

    const { tokens } = await auth.getToken(code);

    if (!tokens.refresh_token) {
      // Shouldn't happen with prompt=consent, but log and continue — the
      // stored row may already have a valid refresh_token from a prior connect.
      console.warn("[youtube-connect] Google did not return a refresh_token");
    }

    const { data: existing, error: existingErr } = await supabaseServer
      .from("platform_tokens")
      .select("refresh_token")
      .eq("user_id", userId)
      .eq("platform", "youtube")
      .maybeSingle();

    if (youtubeRefreshLookupDenied(tokens.refresh_token, existingErr)) {
      console.error("[youtube-connect] existing refresh lookup failed:", existingErr?.message);
      return clearState(NextResponse.redirect(`${settingsBase}&error=youtube_connect_failed`));
    }

    // expiry_date from googleapis is already an absolute Unix ms timestamp.
    const expiresAt = tokens.expiry_date
      ? new Date(tokens.expiry_date).toISOString()
      : new Date(Date.now() + 3_600_000).toISOString();

    const refreshTokenForUpsert = youtubeRefreshTokenForUpsert(
      tokens.refresh_token,
      existing?.refresh_token,
    );

    const { error: upsertErr } = await supabaseServer
      .from("platform_tokens")
      .upsert(
        {
          user_id: userId,
          platform: "youtube",
          access_token: tokens.access_token ?? "",
          refresh_token: refreshTokenForUpsert,
          expires_at: expiresAt,
        },
        { onConflict: "user_id,platform" },
      );

    if (upsertErr) {
      console.error("[youtube-connect] upsert failed:", upsertErr.message);
      return clearState(NextResponse.redirect(`${settingsBase}&error=youtube_connect_failed`));
    }

    // Best-effort channel lookup — must never block the connect flow itself
    // (same philosophy as TikTok's creator-info capture above). Needs
    // youtube.readonly, so an account that connected before this scope was
    // added won't have it until it reconnects; that's fine, this just stays
    // a no-op for it. Captures the channel name for the Connected accounts
    // badge (parity with TikTok/Instagram) AND — distinctly — surfaces a
    // non-blocking warning when the account genuinely has no channel at all,
    // the root cause of uploadToYouTube's bare 401 "Unauthorized" found in a
    // real production incident. The connection itself still succeeds (the
    // OAuth grant is valid either way); only publishing would fail.
    let warning = "";
    if (refreshTokenForUpsert) {
      try {
        const channelTitle = await getYouTubeChannelTitle(refreshTokenForUpsert);
        if (channelTitle) {
          await updatePlatformUsername(userId, "youtube", channelTitle);
        } else {
          warning = "&warning=youtube_no_channel";
        }
      } catch (err) {
        console.warn("[youtube-connect] channel lookup failed:", err);
      }
    }

    return clearState(NextResponse.redirect(`${settingsBase}${warning}`));
  } catch (err) {
    console.error("[youtube-connect] token exchange failed:", err);
    return clearState(NextResponse.redirect(`${settingsBase}&error=youtube_connect_failed`));
  }
}
