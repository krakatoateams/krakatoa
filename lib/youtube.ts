import { google } from "googleapis";
import { Readable } from "stream";

export interface YouTubeUploadParams {
  videoUrl: string;
  title: string;
  description: string;
  tags: string[];
  accessToken: string;
  refreshToken: string;
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
  const { videoUrl, title, description, tags, refreshToken } = params;
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

  // Explicitly refresh so we catch auth errors before streaming the video
  const { token: freshToken } = await auth.getAccessToken();
  if (!freshToken) {
    throw new Error("Failed to obtain a fresh access token from Google. The user may need to re-authorise.");
  }
  console.log("[youtube] Fresh access token obtained:", freshToken.slice(0, 20) + "...");

  // ── Stream the video from storage ───────────────────────────────────────
  const videoRes = await fetch(videoUrl);
  if (!videoRes.ok || !videoRes.body) {
    throw new Error(
      `Could not fetch video from storage (HTTP ${videoRes.status}): ${videoUrl}`,
    );
  }

  // Bridge the WHATWG ReadableStream returned by fetch to a Node.js Readable
  // so the googleapis media upload can consume it. Requires Node.js ≥ 18.
  const videoStream = Readable.fromWeb(
    videoRes.body as Parameters<typeof Readable.fromWeb>[0],
  );

  // ── Upload to YouTube ────────────────────────────────────────────────────
  const youtube = google.youtube({ version: "v3", auth });

  const { data } = await youtube.videos.insert({
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
        // this project (verified: test uploads land as requested, not force-private),
        // so scheduled videos go live publicly. No per-post override by design.
        privacyStatus: "public",
      },
    },
    media: {
      mimeType: mimeFromUrl(videoUrl),
      body: videoStream,
    },
  });

  if (!data.id) {
    throw new Error("YouTube API returned a successful response but no video ID");
  }

  return data.id;
}
