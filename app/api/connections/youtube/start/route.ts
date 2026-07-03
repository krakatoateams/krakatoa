import { type NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getSessionUserId } from "@/lib/resolve-user";

export async function GET(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { origin } = new URL(request.url);
  const state = crypto.randomUUID();

  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    `${origin}/api/connections/youtube/callback`,
  );

  const authUrl = auth.generateAuthUrl({
    scope: ["https://www.googleapis.com/auth/youtube.upload"],
    access_type: "offline",
    prompt: "consent",
    state,
  });

  const response = NextResponse.redirect(authUrl);
  response.cookies.set("youtube_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 300,
    path: "/",
  });

  return response;
}
