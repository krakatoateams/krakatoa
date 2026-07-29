import { type NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/resolve-user";
import { supabaseServer } from "@/lib/supabase-server";
import { resolveOrigin } from "@/lib/http";
import {
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  hasBusinessContentPublishPermission,
} from "@/lib/instagram";

const STATE_COOKIE = "instagram_oauth_state";

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
    console.warn("[instagram-connect] CSRF state mismatch or missing cookie");
    return clearState(NextResponse.redirect(`${settingsBase}&error=invalid_state`));
  }

  if (!code) {
    return clearState(NextResponse.redirect(`${settingsBase}&error=instagram_connect_failed`));
  }

  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return clearState(NextResponse.redirect(`${settingsBase}&error=instagram_connect_failed`));
    }

    const shortLived = await exchangeCodeForToken(
      code,
      `${origin}/api/connections/instagram/callback`,
    );

    // Reject before ever exchanging for a long-lived token, and before
    // writing anything to platform_tokens — the account isn't eligible to
    // publish, so there is nothing worth persisting (see design.md Decision
    // 12: the modern Instagram API has no `account_type` field to check
    // directly, so the granted `permissions` list is the actual signal).
    if (!hasBusinessContentPublishPermission(shortLived.permissions)) {
      console.warn(
        `[instagram-connect] account ${shortLived.userId} did not grant instagram_business_content_publish — not a Business/Creator account, or app misconfiguration`,
      );
      return clearState(NextResponse.redirect(`${settingsBase}&error=instagram_not_business_account`));
    }

    const longLived = await exchangeForLongLivedToken(shortLived.accessToken);
    const expiresAt = new Date(Date.now() + longLived.expiresIn * 1000).toISOString();

    const { error: upsertErr } = await supabaseServer
      .from("platform_tokens")
      .upsert(
        {
          user_id: userId,
          platform: "instagram",
          access_token: longLived.accessToken,
          // No refresh_token concept for Instagram — the long-lived
          // access_token refreshes itself (see design.md Decision 2).
          refresh_token: null,
          expires_at: expiresAt,
        },
        { onConflict: "user_id,platform" },
      );

    if (upsertErr) {
      console.error("[instagram-connect] upsert failed:", upsertErr.message);
      return clearState(NextResponse.redirect(`${settingsBase}&error=instagram_connect_failed`));
    }

    return clearState(NextResponse.redirect(settingsBase));
  } catch (err) {
    console.error("[instagram-connect] token exchange failed:", err);
    return clearState(NextResponse.redirect(`${settingsBase}&error=instagram_connect_failed`));
  }
}
