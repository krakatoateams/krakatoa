import { type NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/resolve-user";
import { resolveOrigin } from "@/lib/http";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { getCurrentProfile } from "@/lib/profiles-db";
import { canPreviewPlatform } from "@/lib/tool-preview-access-db";
import { getPlatformAvailability } from "@/lib/platform-availability-db";
import { isPlatformUsable } from "@/lib/platform-availability-pure";

const INSTAGRAM_AUTHORIZE_URL = "https://www.instagram.com/oauth/authorize";
const INSTAGRAM_SCOPES = "instagram_business_basic,instagram_business_content_publish";

export async function GET(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  // Platform availability (see CONTEXT.md) — "coming soon" actually blocks
  // connecting for a regular user. Bypassed by an admin, or a narrow email
  // on the existing tool_preview_access allowlist — see
  // /api/platform-availability's own comment for why these two are folded
  // into one check here.
  const [availability, admin, profile] = await Promise.all([
    getPlatformAvailability(),
    getCurrentAdmin(),
    getCurrentProfile(),
  ]);
  const canBypass = !!admin || (await canPreviewPlatform(profile?.email, "instagram"));
  if (!isPlatformUsable(availability.instagram, canBypass)) {
    return NextResponse.json({ error: "Instagram isn't available yet." }, { status: 403 });
  }

  const origin = resolveOrigin(request);
  const state = crypto.randomUUID();

  const authUrl = new URL(INSTAGRAM_AUTHORIZE_URL);
  authUrl.searchParams.set("client_id", process.env.INSTAGRAM_APP_ID!);
  authUrl.searchParams.set("redirect_uri", `${origin}/api/connections/instagram/callback`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", INSTAGRAM_SCOPES);
  authUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(authUrl.toString());
  response.cookies.set("instagram_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 300,
    path: "/",
  });

  return response;
}
