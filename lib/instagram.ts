// Connect-time functions only (openspec/changes/connect-instagram, Phase 1).
// Container/publish functions (createMediaContainer, getContainerStatus,
// publishContainer) and the long-lived-token refresh function are Phase 2/3 —
// deliberately not added here yet, mirroring connect-tiktok's "connect only"
// scoping of lib/tiktok.ts.

const INSTAGRAM_CODE_TOKEN_URL = "https://api.instagram.com/oauth/access_token";
const INSTAGRAM_LONG_LIVED_TOKEN_URL = "https://graph.instagram.com/access_token";

// The one scope this app actually needs to grant publish access. Checked
// against the code-exchange response's `permissions` string (see
// hasBusinessContentPublishPermission) since the modern "Instagram API with
// Instagram Login" surface has no `account_type` field to check directly —
// that field belongs to the deprecated Instagram Basic Display API (see
// design.md Decision 12).
export const INSTAGRAM_CONTENT_PUBLISH_SCOPE = "instagram_business_content_publish";

export interface InstagramShortLivedTokenResponse {
  accessToken: string;
  userId: string;
  permissions: string[];
}

interface RawInstagramCodeTokenPayload {
  data?: Array<{ access_token?: string; user_id?: string; permissions?: string }>;
  error_type?: string;
  error_message?: string;
  error_description?: string;
}

/**
 * Exchanges the OAuth `code` for a short-lived (~1 hour) Instagram User
 * access token. This is the first of Instagram's 3-hop token exchange (code →
 * short-lived → long-lived) — callers must not persist this token directly;
 * pass it straight to exchangeForLongLivedToken.
 */
export async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
): Promise<InstagramShortLivedTokenResponse> {
  const res = await fetch(INSTAGRAM_CODE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.INSTAGRAM_APP_ID!,
      client_secret: process.env.INSTAGRAM_APP_SECRET!,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    }).toString(),
  });

  const json = (await res.json()) as RawInstagramCodeTokenPayload;
  const entry = json.data?.[0];

  if (!res.ok || !entry?.access_token || !entry?.user_id) {
    throw new Error(
      `Instagram code-for-token exchange failed: ${json.error_message ?? json.error_description ?? res.statusText}`,
    );
  }

  return {
    accessToken: entry.access_token,
    userId: entry.user_id,
    permissions: (entry.permissions ?? "").split(",").map((p) => p.trim()).filter(Boolean),
  };
}

/**
 * Instagram's own gate on this: the code-exchange response's `permissions`
 * field lists what was actually granted, which can omit a requested scope if
 * the account/app isn't eligible (e.g. not a Business/Creator account) even
 * though the request itself succeeded. This is the mechanism this app relies
 * on to detect an ineligible account — see design.md Decision 12 for why the
 * originally-assumed `account_type` field doesn't exist on this API surface.
 */
export function hasBusinessContentPublishPermission(permissions: string[]): boolean {
  return permissions.includes(INSTAGRAM_CONTENT_PUBLISH_SCOPE);
}

export interface InstagramLongLivedTokenResponse {
  accessToken: string;
  expiresIn: number;
}

interface RawInstagramLongLivedTokenPayload {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error_type?: string;
  error_message?: string;
}

/**
 * Exchanges a short-lived token for a long-lived (60-day) Instagram User
 * access token. There is no separate refresh_token — the long-lived token
 * refreshes itself later via a distinct endpoint (refreshLongLivedToken,
 * Phase 3 — not implemented yet).
 */
export async function exchangeForLongLivedToken(
  shortLivedToken: string,
): Promise<InstagramLongLivedTokenResponse> {
  const url = new URL(INSTAGRAM_LONG_LIVED_TOKEN_URL);
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", process.env.INSTAGRAM_APP_SECRET!);
  url.searchParams.set("access_token", shortLivedToken);

  const res = await fetch(url.toString());
  const json = (await res.json()) as RawInstagramLongLivedTokenPayload;

  if (!res.ok || !json.access_token || !json.expires_in) {
    throw new Error(
      `Instagram long-lived token exchange failed: ${json.error_message ?? res.statusText}`,
    );
  }

  return { accessToken: json.access_token, expiresIn: json.expires_in };
}
