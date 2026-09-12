import { redactPublishMediaRef } from "@/lib/tiktok-publish-pure";

/**
 * YouTube upload error text. Cron copies thrown messages onto
 * `posts.last_error`, so signed publish URLs must be redacted.
 */
export function youtubeStorageFetchError(status: number, videoUrl: string): string {
  return `Could not fetch video from storage (HTTP ${status}): ${redactPublishMediaRef(videoUrl)}`;
}

export function youtubePublishSelfCheck(): void {
  const signed =
    "https://ybfmllqcvvexldsteuaw.supabase.co/storage/v1/object/sign/krakatoa/user/videos/clip.mp4?token=secret-jwt";
  const message = youtubeStorageFetchError(403, signed);
  if (message.includes("token=") || message.includes("secret-jwt")) {
    throw new Error("YouTube storage fetch errors must not include signed URL tokens");
  }
  if (!message.includes("/object/sign/krakatoa/user/videos/clip.mp4")) {
    throw new Error("YouTube storage fetch errors must keep the object path");
  }
  if (!message.includes("HTTP 403")) {
    throw new Error("YouTube storage fetch errors must keep the HTTP status");
  }

  const relative = youtubeStorageFetchError(500, "user/videos/clip.mp4?token=also-secret");
  if (relative.includes("token=") || relative.includes("also-secret")) {
    throw new Error("relative signed refs must also strip query tokens");
  }
}

if (require.main === module) {
  youtubePublishSelfCheck();
  console.log("youtubePublishSelfCheck: ok");
}
