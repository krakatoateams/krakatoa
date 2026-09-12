/**
 * Instagram OAuth decisions. Split from lib/instagram.ts so error redaction
 * and eligibility can be tested without loading the service-role client.
 */

export const INSTAGRAM_CONTENT_PUBLISH_SCOPE = "instagram_business_content_publish";

export function hasBusinessContentPublishPermission(permissions: string[]): boolean {
  return permissions.includes(INSTAGRAM_CONTENT_PUBLISH_SCOPE);
}

export function instagramTokenExchangeErrorDetail(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "unknown";
  const record = payload as Record<string, unknown>;
  const detail =
    (typeof record.error_message === "string" && record.error_message) ||
    (typeof record.error_description === "string" && record.error_description) ||
    (typeof record.error_type === "string" && record.error_type) ||
    "unknown";
  return detail;
}

export function instagramOAuthSelfCheck(): void {
  const leaked = instagramTokenExchangeErrorDetail({
    access_token: "IGQW-secret",
    user_id: "123",
    error_message: "missing field",
  });
  if (leaked.includes("IGQW-secret") || leaked.includes("access_token")) {
    throw new Error("Instagram token-exchange errors must not embed access tokens");
  }
  if (!leaked.includes("missing field")) {
    throw new Error("Instagram token-exchange errors must keep the provider message");
  }

  if (!hasBusinessContentPublishPermission(["instagram_business_content_publish"])) {
    throw new Error("content_publish scope must pass eligibility");
  }
  if (hasBusinessContentPublishPermission(["instagram_business_basic"])) {
    throw new Error("basic-only permission must not persist a connection");
  }
}

if (require.main === module) {
  instagramOAuthSelfCheck();
  console.log("instagramOAuthSelfCheck: ok");
}
