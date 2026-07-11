import { type NextRequest, NextResponse } from "next/server";
import { randomBytes, createHash } from "crypto";
import { getSessionUserId } from "@/lib/resolve-user";
import { resolveOrigin } from "@/lib/tiktok";

const TIKTOK_AUTHORIZE_URL = "https://www.tiktok.com/v2/auth/authorize/";
const TIKTOK_SCOPES = "user.info.basic,video.publish";

export async function GET(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const origin = resolveOrigin(request);
  const state = crypto.randomUUID();

  // This TikTok app is configured to require PKCE — the auth request must
  // carry a code_challenge, and the callback must exchange the code with the
  // matching code_verifier or TikTok rejects it outright ("missing code_challenge").
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

  const authUrl = new URL(TIKTOK_AUTHORIZE_URL);
  authUrl.searchParams.set("client_key", process.env.TIKTOK_CLIENT_KEY!);
  authUrl.searchParams.set("scope", TIKTOK_SCOPES);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", `${origin}/api/connections/tiktok/callback`);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  const response = NextResponse.redirect(authUrl.toString());
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 300,
    path: "/",
  };
  response.cookies.set("tiktok_oauth_state", state, cookieOpts);
  response.cookies.set("tiktok_code_verifier", codeVerifier, cookieOpts);

  return response;
}
