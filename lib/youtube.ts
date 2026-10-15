import "server-only";

import { google } from "googleapis";
import { Readable } from "stream";
import { youtubeStorageFetchError } from "@/lib/youtube-publish-pure";
import type { YoutubeChannelLookup } from "@/lib/youtube-oauth-pure";

export type YouTubePrivacyStatus = "public" | "unlisted" | "private";

export interface YouTubeUploadParams {
  videoUrl: string;
  title: string;
  description: string;
  tags: string[];
  accessToken: string;
  refreshToken: string;
  /** Defaults to "public" — preserves prior behavior for callers/rows with none chosen. */
  privacyStatus?: YouTubePrivacyStatus;
}

/**
 * Detect a reasonable MIME type from the storage URL's file extension.
 * YouTube accepts MP4, MOV, and AVI among others; we pass the right type
 * so the API doesn't have to guess.
 */
function mimeFromUrl(url: string): string {
  const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    mp4: "video/mp4",
    mov: "video/quicktime",
    avi: "video/x-msvideo",
  };
  return map[ext ?? ""] ?? "video/mp4";
}

/**
 * Download a video from a URL (Supabase Storage public URL) and upload it
 * to YouTube via the Data API v3.
 *
 * Returns the newly created YouTube video ID.
 */
export async function uploadToYouTube(params: YouTubeUploadParams): Promise<string> {
  const { videoUrl, title, description, tags, refreshToken, privacyStatus = "public" } = params;
  // ── Auth client ─────────────────────────────────────────────────────────
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
  );

  // Set refresh_token only — force the library to always fetch a fresh
  // access token. Using the stored access_token directly causes 401s once
  // it has expired (which happens after 1 hour). By omitting access_token
  // and setting expiry_date to the past, getAccessToken() will always
  // perform a refresh before the API call.
  auth.setCredentials({
    refresh_token: refreshToken,
    expiry_date: 1, // epoch past → library always refreshes
  });

  // Explicitly refresh so we catch auth errors before streaming the video.
  // A 401 here means the stored refresh_token itself is dead (revoked,
  // expired) — distinct from a 401 on the upload call below, which (per a
  // real production incident) means the token is fine but the account has
  // no YouTube channel to upload to.
  let freshToken: string | null | undefined;
  try {
    ({ token: freshToken } = await auth.getAccessToken());
  } catch (err) {
    if (googleApiStatus(err) === 401) {
      throw youtubeAuthError("YouTube access has expired or was revoked. Please reconnect YouTube in Settings.");
    }
    throw err;
  }
  if (!freshToken) {
    throw new Error("Failed to obtain a fresh access token from Google. The user may need to re-authorise.");
  }

  // ── Stream the video from storage ───────────────────────────────────────
  const videoRes = await fetch(videoUrl);
  if (!videoRes.ok || !videoRes.body) {
    throw new Error(youtubeStorageFetchError(videoRes.status, videoUrl));
  }

  // Bridge the WHATWG ReadableStream returned by fetch to a Node.js Readable
  // so the googleapis media upload can consume it. Requires Node.js ≥ 18.
  const videoStream = Readable.fromWeb(
    videoRes.body as Parameters<typeof Readable.fromWeb>[0],
  );

  // ── Upload to YouTube ────────────────────────────────────────────────────
  const youtube = google.youtube({ version: "v3", auth });

  let data;
  try {
    ({ data } = await youtube.videos.insert({
      part: ["snippet", "status"],
      requestBody: {
        snippet: {
          title,
          description,
          tags,
          categoryId: "22", // People & Blogs — safe default
        },
        status: {
          // Scheduler publishes for real. The API honors requested visibility for
          // this project (verified: test uploads land as requested, not force-private).
          privacyStatus,
        },
      },
      media: {
        mimeType: mimeFromUrl(videoUrl),
        body: videoStream,
      },
    }));
  } catch (err) {
    // A real production incident confirmed this: the refresh above already
    // succeeded (a valid, freshly-reissued token), yet the upload itself
    // still 401s. YouTube's API returns a bare, bodyless 401 — not a 403
    // with a "no channel" reason — for a Google account that has never
    // created a YouTube channel, so there's no structured field to key off.
    // Re-checking channel existence via channels.list first isn't an option
    // here: that read requires youtube.readonly/youtube scope, which this
    // app deliberately doesn't request (see the comment above channels.list
    // was never added — broadening scope means every user re-consenting).
    if (googleApiStatus(err) === 401) {
      throw youtubeAuthError(
        "YouTube rejected this upload (401 Unauthorized). This almost always means the connected " +
          "Google account has no YouTube channel yet — create one at youtube.com, then retry this post. " +
          "If that doesn't fix it, reconnect YouTube in Settings.",
      );
    }
    throw err;
  }

  if (!data.id) {
    throw new Error("YouTube API returned a successful response but no video ID");
  }

  return data.id;
}

/** Gaxios attaches the HTTP status of a failed Google API call here. */
function googleApiStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status;
}

/**
 * Builds a friendlier replacement for a raw Gaxios 401 while keeping
 * `response.status` set — cron's isPermanentFailure (lib/cron-publish-pure.ts)
 * keys off that field to skip retrying a condition that won't self-heal
 * (dead token or missing channel), same as it did for the original error.
 */
function youtubeAuthError(message: string): Error {
  return Object.assign(new Error(message), { response: { status: 401 } });
}

/**
 * The connecting account's own YouTube channel title, or `null` if the
 * account has no channel at all (an empty `items` array — confirmed via a
 * real production incident that this is exactly what causes uploadToYouTube's
 * bare 401 "Unauthorized"). Requires the youtube.readonly scope — confirmed
 * empirically that youtube.upload alone 403s on this call ("insufficient
 * authentication scopes").
 *
 * Pass the tokens Google just issued for this consent, so the answer is about
 * the account the user just picked — not a previously stored, possibly
 * different, account.
 *
 * Throws on any other failure (network, auth) — distinct from "confirmed no
 * channel" so callers don't misreport a transient failure as a missing
 * channel.
 */
export async function getYouTubeChannelTitle(tokens: {
  accessToken?: string | null;
  refreshToken?: string | null;
}): Promise<string | null> {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
  );
  auth.setCredentials({
    access_token: tokens.accessToken ?? undefined,
    refresh_token: tokens.refreshToken ?? undefined,
  });

  const youtube = google.youtube({ version: "v3", auth });
  const { data } = await youtube.channels.list({ part: ["snippet"], mine: true });
  return data.items?.[0]?.snippet?.title ?? null;
}

/**
 * getYouTubeChannelTitle as a lookup result that never throws: a confirmed
 * missing channel ("none") stays distinct from a failure to check ("error").
 */
export async function lookupYouTubeChannel(tokens: {
  accessToken?: string | null;
  refreshToken?: string | null;
}): Promise<YoutubeChannelLookup> {
  if (!tokens.accessToken && !tokens.refreshToken) return { kind: "error" };
  try {
    const title = await getYouTubeChannelTitle(tokens);
    return title ? { kind: "found", title } : { kind: "none" };
  } catch (err) {
    console.warn("[youtube] channel lookup failed:", err);
    return { kind: "error" };
  }
}

/**
 * Revoke a grant we decided not to keep (e.g. a channel-less account), so it
 * doesn't linger in the user's Google Account permissions. Revoking either
 * token ends the whole grant.
 */
export async function revokeYouTubeGrant(token: string): Promise<void> {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
  );
  await auth.revokeToken(token);
}
