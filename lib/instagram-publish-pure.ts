import { redactPublishMediaRef } from "@/lib/tiktok-publish-pure";

/**
 * Instagram Graph / storage error text. Cron copies thrown messages onto
 * `posts.last_error`. Graph bodies and signed media URLs must not appear.
 */

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
}

if (require.main === module) {
  instagramPublishSelfCheck();
  console.log("instagramPublishSelfCheck: ok");
}
