import { redactPublishMediaRef } from "@/lib/tiktok-publish-pure";

/**
 * Instagram Graph / storage error text. Cron copies thrown messages onto
 * `posts.last_error`. Graph bodies and signed media URLs must not appear.
 */

// Meta's Content Publishing API docs (developers.facebook.com/docs/instagram-platform/content-publishing,
// checked 2026-09): "Carousels are limited to 10 images, videos, or a mix of
// the two." Lives in this isomorphic-safe file (not lib/instagram.ts, which
// is server-only) so the Scheduler's client-side UI and the server-side
// publish/validation code share one source of truth instead of a duplicated
// literal that could drift if this number ever changes.
export const INSTAGRAM_CAROUSEL_MAX_ITEMS = 10;

function redactUrlsInText(text: string): string {
  return text.replace(/https?:\/\/[^\s]+/gi, (url) => redactPublishMediaRef(url));
}

export function parseInstagramGraphJson(rawText: string): unknown | null {
  try {
    return JSON.parse(rawText) as unknown;
  } catch {
    return null;
  }
}

export function instagramGraphErrorDetail(rawText: string): string {
  try {
    const json = JSON.parse(rawText) as { error?: { message?: string; type?: string } };
    const detail = json.error?.message ?? json.error?.type ?? "unknown";
    return redactUrlsInText(detail);
  } catch {
    return "unknown";
  }
}

export function instagramStorageCheckError(storagePath: string): string {
  return `Could not read photo from storage for Instagram format check: ${redactPublishMediaRef(storagePath)}`;
}

export function isInstagramPermanentFailure(_err: unknown, message: string): boolean {
  const m = message.toLowerCase();
  if (/re-?authori|reconnect|access token|oauthexception|permission|invalid_business_account|not a professional account/.test(m)) {
    return true;
  }
  if (/jpeg is the only image format|unsupported media type|invalid image format/.test(m)) {
    return true;
  }
  if (
    /could not read photo from storage|no publishable video location|video file no longer exists in storage|could not fetch video from storage/.test(
      m,
    )
  ) {
    return true;
  }
  return false;
}

export function instagramPublishSelfCheck(): void {
  const graphBody = JSON.stringify({
    error: {
      message: "Invalid image URL",
      type: "OAuthException",
    },
    image_url:
      "https://example.supabase.co/storage/v1/object/sign/krakatoa/u/p.jpg?token=secret-jwt",
  });
  const graph = instagramGraphErrorDetail(graphBody);
  if (graph.includes("token=") || graph.includes("secret-jwt") || graph.includes("image_url")) {
    throw new Error("Instagram Graph errors must not embed signed media URLs");
  }
  if (!graph.includes("Invalid image URL")) {
    throw new Error("Instagram Graph errors must keep the provider message");
  }

  const echoed = instagramGraphErrorDetail(
    JSON.stringify({
      error: {
        message:
          "Invalid image URL: https://example.supabase.co/storage/v1/object/sign/krakatoa/u/p.jpg?token=secret-jwt",
      },
    }),
  );
  if (echoed.includes("token=") || echoed.includes("secret-jwt")) {
    throw new Error("Instagram Graph error.message must not echo signed URL tokens");
  }

  const pathError = instagramStorageCheckError(
    "user/photos/shot.png?token=also-secret",
  );
  if (pathError.includes("token=") || pathError.includes("also-secret")) {
    throw new Error("Instagram storage-check errors must redact query tokens");
  }

  if (parseInstagramGraphJson("<html>gateway</html>") !== null) {
    throw new Error("non-JSON Graph bodies must not throw or leak raw text");
  }
  if (instagramGraphErrorDetail("<html>gateway</html>") !== "unknown") {
    throw new Error("non-JSON Graph errors must report unknown, not the body");
  }

  if (
    !isInstagramPermanentFailure(
      null,
      "Video file no longer exists in storage — it was deleted or swept before publishing.",
    )
  ) {
    throw new Error("Instagram missing-video must be permanent, not retry-forever");
  }
  if (
    !isInstagramPermanentFailure(
      null,
      "Could not fetch video from storage (HTTP 404)",
    )
  ) {
    throw new Error("Instagram unreadable video must be permanent");
  }
  if (isInstagramPermanentFailure(null, "network timeout")) {
    throw new Error("generic Instagram network errors must stay transient");
  }
}

if (require.main === module) {
  instagramPublishSelfCheck();
  console.log("instagramPublishSelfCheck: ok");
}
