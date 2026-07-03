import { type NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getSessionUserId } from "@/lib/resolve-user";
import { supabaseServer } from "@/lib/supabase-server";

const STATE_COOKIE = "youtube_oauth_state";

function clearState(response: NextResponse): NextResponse {
  response.cookies.set(STATE_COOKIE, "", { maxAge: 0, path: "/" });
  return response;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
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

    const userId = await getSessionUserId();
    if (!userId) {
      return clearState(NextResponse.redirect(`${settingsBase}&error=youtube_connect_failed`));
    }

    // expiry_date from googleapis is already an absolute Unix ms timestamp.
    const expiresAt = tokens.expiry_date
      ? new Date(tokens.expiry_date).toISOString()
      : new Date(Date.now() + 3_600_000).toISOString();

    const { error: upsertErr } = await supabaseServer
      .from("platform_tokens")
      .upsert(
        {
          user_id: userId,
          platform: "youtube",
          access_token: tokens.access_token ?? "",
          refresh_token: tokens.refresh_token ?? null,
          expires_at: expiresAt,
        },
        { onConflict: "user_id,platform" },
      );

    if (upsertErr) {
      console.error("[youtube-connect] upsert failed:", upsertErr.message);
      return clearState(NextResponse.redirect(`${settingsBase}&error=youtube_connect_failed`));
    }

    return clearState(NextResponse.redirect(settingsBase));
  } catch (err) {
    console.error("[youtube-connect] token exchange failed:", err);
    return clearState(NextResponse.redirect(`${settingsBase}&error=youtube_connect_failed`));
  }
}
