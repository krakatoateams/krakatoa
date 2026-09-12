/**
 * Pure TikTok publish-client decisions. Split from lib/tiktok.ts so error
 * redaction and disclosure rules can be tested without network I/O.
 *
 * Cron persists thrown messages on `posts.last_error` and logs them. Signed
 * publish URLs must never appear in those strings.
 */

export function redactPublishMediaRef(urlOrPath: string): string {
  try {
    const parsed = new URL(urlOrPath);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    const query = urlOrPath.indexOf("?");
    return query === -1 ? urlOrPath : urlOrPath.slice(0, query);
  }
}

export function tiktokPublishSelfCheck(): void {
  const signed =
    "https://ybfmllqcvvexldsteuaw.supabase.co/storage/v1/object/sign/krakatoa/user/videos/clip.mp4?token=secret-jwt&expires=999";
  const redacted = redactPublishMediaRef(signed);
  if (redacted.includes("token=") || redacted.includes("secret-jwt")) {
    throw new Error("signed publish URLs must not appear in error strings");
  }
  if (!redacted.includes("/object/sign/krakatoa/user/videos/clip.mp4")) {
    throw new Error("redaction must keep the object path for debugging");
  }

  const bare = "user-id/photos/generated/product/shot.png";
  if (redactPublishMediaRef(bare) !== bare) {
    throw new Error("bare storage paths must stay unchanged");
  }

  const queryPath = "user-id/photos/generated/product/shot.png?token=also-secret";
  const redactedPath = redactPublishMediaRef(queryPath);
  if (redactedPath.includes("token=") || redactedPath.includes("also-secret")) {
    throw new Error("query tokens on relative paths must be stripped");
  }
}

if (require.main === module) {
  tiktokPublishSelfCheck();
  console.log("tiktokPublishSelfCheck: ok");
}
