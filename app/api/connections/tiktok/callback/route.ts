import { type NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/resolve-user";
import { supabaseServer } from "@/lib/supabase-server";
import { exchangeCodeForToken, getCreatorInfo, resolveOrigin } from "@/lib/tiktok";

const STATE_COOKIE = "tiktok_oauth_state";
const VERIFIER_COOKIE = "tiktok_code_verifier";

function clearState(response: NextResponse): NextResponse {
  response.cookies.set(STATE_COOKIE, "", { maxAge: 0, path: "/" });
  response.cookies.set(VERIFIER_COOKIE, "", { maxAge: 0, path: "/" });
  return response;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const origin = resolveOrigin(request);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const storedState = request.cookies.get(STATE_COOKIE)?.value;
  const codeVerifier = request.cookies.get(VERIFIER_COOKIE)?.value;

  const settingsBase = `${origin}/dashboard/settings?tab=connections`;

  // CSRF validation — must happen before any other processing.
  if (!state || !storedState || state !== storedState) {
    console.warn("[tiktok-connect] CSRF state mismatch or missing cookie");
    return clearState(NextResponse.redirect(`${settingsBase}&error=invalid_state`));
  }

  if (!code || !codeVerifier) {
    return clearState(NextResponse.redirect(`${settingsBase}&error=tiktok_connect_failed`));
  }

  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return clearState(NextResponse.redirect(`${settingsBase}&error=tiktok_connect_failed`));
    }

    const tokens = await exchangeCodeForToken(
      code,
      `${origin}/api/connections/tiktok/callback`,
      codeVerifier,
    );

    const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000).toISOString();

    const { error: upsertErr } = await supabaseServer
      .from("platform_tokens")
      .upsert(
        {
          user_id: userId,
          platform: "tiktok",
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
          expires_at: expiresAt,
        },
        { onConflict: "user_id,platform" },
      );

    if (upsertErr) {
      console.error("[tiktok-connect] upsert failed:", upsertErr.message);
      return clearState(NextResponse.redirect(`${settingsBase}&error=tiktok_connect_failed`));
    }

    // Best-effort validation — catches scope/Sandbox misconfiguration early.
    // Must never block or fail the connect flow itself.
    try {
      await getCreatorInfo(tokens.accessToken);
    } catch (err) {
      console.warn("[tiktok-connect] creator info validation failed:", err);
    }

    return clearState(NextResponse.redirect(settingsBase));
  } catch (err) {
    console.error("[tiktok-connect] token exchange failed:", err);
    return clearState(NextResponse.redirect(`${settingsBase}&error=tiktok_connect_failed`));
  }
}
