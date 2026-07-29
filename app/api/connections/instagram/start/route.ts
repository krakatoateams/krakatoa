import { type NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/resolve-user";
import { resolveOrigin } from "@/lib/http";

const INSTAGRAM_AUTHORIZE_URL = "https://www.instagram.com/oauth/authorize";
const INSTAGRAM_SCOPES = "instagram_business_basic,instagram_business_content_publish";

export async function GET(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
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
