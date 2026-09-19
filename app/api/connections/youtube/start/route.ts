import { type NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getSessionUserId } from "@/lib/resolve-user";
import { resolveOrigin } from "@/lib/http";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { getCurrentProfile } from "@/lib/profiles-db";
import { canPreviewPlatform } from "@/lib/tool-preview-access-db";
import { getPlatformAvailability } from "@/lib/platform-availability-db";
import { isPlatformUsable } from "@/lib/platform-availability-pure";

export async function GET(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  // Platform availability (see CONTEXT.md) — "coming soon" actually blocks
  // connecting for a regular user, not just cosmetic. Bypassed by an admin,
  // or a narrow email on the existing tool_preview_access allowlist (e.g. a
  // Google OAuth verification reviewer's test account — see
  // /api/platform-availability's own comment for why these two are folded
  // into one check here). UI hides the Connect button too, but that's
  // cosmetic-only — this is the real gate.
  const [availability, admin, profile] = await Promise.all([
    getPlatformAvailability(),
    getCurrentAdmin(),
    getCurrentProfile(),
  ]);
  const canBypass = !!admin || (await canPreviewPlatform(profile?.email, "youtube"));
  if (!isPlatformUsable(availability.youtube, canBypass)) {
    return NextResponse.json({ error: "YouTube isn't available yet." }, { status: 403 });
  }

  const origin = resolveOrigin(request);
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
