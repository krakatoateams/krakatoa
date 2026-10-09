/** Self-check for `tiktok-publish-pure.ts`, kept out of it because workflows bundle that module via `error-log-safe`. */
import { redactPublishMediaRef } from "./tiktok-publish-pure";

function tiktokPublishSelfCheck(): void {
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

tiktokPublishSelfCheck();
console.log("tiktokPublishSelfCheck: ok");
