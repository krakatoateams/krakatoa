// Phase 1: connect-time functions (OAuth token exchange). Phase 2: publish
// functions (createMediaContainer, getContainerStatus, publishContainer) and
// JPEG-compatibility conversion, added below. Phase 3 (refreshLongLivedToken
// call site + the daily proactive-refresh cron) is still not implemented.

import sharp from "sharp";
import { supabaseServer } from "@/lib/supabase-server";
import { STORAGE_BUCKET } from "@/lib/storage-buckets";

const INSTAGRAM_CODE_TOKEN_URL = "https://api.instagram.com/oauth/access_token";
const INSTAGRAM_LONG_LIVED_TOKEN_URL = "https://graph.instagram.com/access_token";
const INSTAGRAM_GRAPH_BASE = "https://graph.instagram.com";

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

interface RawInstagramCodeTokenEntry {
  access_token?: string;
  user_id?: string;
  // Meta's docs sample shows this as a comma-separated string, but the
  // observed live response is already a string array — normalized below via
  // normalizePermissions() rather than assumed to be one or the other.
  permissions?: string | string[];
}

/** Accepts either shape observed for `permissions` (comma-separated string,
 * per Meta's docs sample, or a string array, per this app's actual live
 * response) and normalizes to a trimmed, non-empty string array either way —
 * see the ".split is not a function" incident this fixes, where the code
 * assumed the string shape and blew up on the real array shape. */
function normalizePermissions(raw: string | string[] | undefined): string[] {
  if (Array.isArray(raw)) {
    return raw.map((p) => String(p).trim()).filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw.split(",").map((p) => p.trim()).filter(Boolean);
  }
  return [];
}

// Meta's documented sample for this endpoint wraps the entry in a `data`
// array ({ data: [{ access_token, user_id, permissions }] }) — but the
// observed live response for this app's app/flow config was the same fields
// flat at the top level instead. Accepting both shapes means a docs/reality
// mismatch (either direction) can never again silently masquerade as a
// failed exchange — see the "token exchange failed: OK" incident this fixes,
// where a 200 response was misread as a failure because only the wrapped
// shape was recognized.
type RawInstagramCodeTokenPayload = RawInstagramCodeTokenEntry & {
  data?: Array<RawInstagramCodeTokenEntry>;
  error_type?: string;
  error_message?: string;
  error_description?: string;
};

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
  // Prefer the array-wrapped shape if present, fall back to the flat shape.
  const entry: RawInstagramCodeTokenEntry = json.data?.[0] ?? json;

  if (!res.ok || !entry?.access_token || !entry?.user_id) {
    throw new Error(
      `Instagram code-for-token exchange failed: HTTP ${res.status} ${JSON.stringify(json)}`,
    );
  }

  return {
    accessToken: entry.access_token,
    userId: entry.user_id,
    permissions: normalizePermissions(entry.permissions),
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
      `Instagram long-lived token exchange failed: HTTP ${res.status} ${JSON.stringify(json)}`,
    );
  }

  return { accessToken: json.access_token, expiresIn: json.expires_in };
}

// ─────────────────────────────────────────────────────────────────────────────
// Publish (Phase 2, openspec/changes/connect-instagram) — container creation,
// status polling, and media_publish. Confirmed against Meta's current Content
// Publishing docs during this phase (not carried over unverified from Phase
// 1's design): all three calls use `graph.instagram.com` (this app's flow is
// Instagram Login, not Facebook Login, which would use graph.facebook.com
// instead), `Authorization: Bearer <token>` + JSON body — the same shape this
// app's TikTok code already uses, unlike the OAuth endpoints above (which use
// form/query params and had their own docs-vs-reality surprises).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sniffs an image's real format from its magic bytes — not the stored
 * content-type or file extension, either of which could be wrong. Mirrors
 * lib/tiktok.ts's own sniffImageFormat (kept as a separate copy rather than a
 * shared import so this file doesn't take on a dependency on TikTok-specific
 * code for an unrelated platform's format check — see design.md Alternatives
 * Considered).
 */
function sniffImageFormat(bytes: Uint8Array): "jpeg" | "png" | "webp" | "unknown" {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return "png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "webp";
  }
  return "unknown";
}

/**
 * Ensures a photo storage path points to a file Instagram's Content
 * Publishing API will actually accept. Per Meta's current docs, "JPEG is the
 * only image format supported" for image posts — unlike TikTok (which
 * accepts JPEG *or* WebP), Instagram rejects WebP too, not just PNG. Since
 * this app's own generation tools (Product Photo, Storyboard) default to PNG
 * (see lib/tiktok.ts's ensureTikTokCompatiblePhoto for the same finding on
 * the TikTok side), this conversion is not a defensive nicety — it's a real,
 * confirmed requirement most of this app's own photos would otherwise fail.
 *
 * Downloads the original, sniffs its real format, and if it isn't already
 * JPEG, converts it via sharp and uploads the result under a sibling path
 * (so the original asset — still used elsewhere, e.g. asset library, TikTok
 * publishing — is untouched). Returns the storage path to actually sign and
 * publish — the original path if no conversion was needed.
 */
export async function ensureInstagramCompatibleImage(storagePath: string): Promise<string> {
  const { data, error } = await supabaseServer.storage.from(STORAGE_BUCKET).download(storagePath);
  if (error || !data) {
    throw new Error(`Could not read photo from storage for Instagram format check: ${storagePath}`);
  }

  const bytes = new Uint8Array(await data.arrayBuffer());
  if (sniffImageFormat(bytes) === "jpeg") return storagePath;

  const jpegBuffer = await sharp(Buffer.from(bytes)).jpeg({ quality: 90 }).toBuffer();
  const convertedPath = `${storagePath.replace(/\.[^./]+$/, "")}.instagram.jpg`;

  const { error: uploadError } = await supabaseServer.storage
    .from(STORAGE_BUCKET)
    .upload(convertedPath, jpegBuffer, { contentType: "image/jpeg", upsert: true });
  if (uploadError) {
    throw new Error(`Failed to upload converted JPEG for Instagram: ${uploadError.message}`);
  }

  return convertedPath;
}

export type InstagramMediaType = "IMAGE" | "REELS";

export interface CreateMediaContainerParams {
  igUserId: string;
  accessToken: string;
  mediaType: InstagramMediaType;
  /** image_url for IMAGE, video_url for REELS — caller resolves the right
   * signed URL (and, for IMAGE, runs it through ensureInstagramCompatibleImage
   * first) before calling this. */
  mediaUrl: string;
  caption: string;
}

interface RawInstagramApiError {
  error?: { message?: string; type?: string; code?: number; error_subcode?: number; fbtrace_id?: string };
}

interface RawCreateContainerResponse extends RawInstagramApiError {
  id?: string;
}

/**
 * Creates an Instagram media container (POST /{ig-user-id}/media) — the
 * first step of the container → poll → publish flow. Returns immediately
 * with a container_id; this does NOT wait for processing to finish (see
 * getContainerStatus / design.md Decision 4 for why polling is a separate,
 * per-cron-tick step rather than an in-request loop).
 */
export async function createMediaContainer(
  params: CreateMediaContainerParams,
): Promise<{ containerId: string }> {
  const url = `${INSTAGRAM_GRAPH_BASE}/${params.igUserId}/media`;
  const body: Record<string, string> = {
    media_type: params.mediaType,
    caption: params.caption,
  };
  if (params.mediaType === "IMAGE") {
    body.image_url = params.mediaUrl;
  } else {
    body.video_url = params.mediaUrl;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const rawText = await res.text();
  const json = JSON.parse(rawText) as RawCreateContainerResponse;

  if (!res.ok || !json.id) {
    throw new Error(`Instagram container creation failed: HTTP ${res.status} ${rawText}`);
  }

  return { containerId: json.id };
}

export type InstagramContainerStatus =
  | "IN_PROGRESS"
  | "FINISHED"
  | "ERROR"
  | "EXPIRED"
  | "PUBLISHED";

interface RawContainerStatusResponse extends RawInstagramApiError {
  status_code?: string;
}

/**
 * Checks a container's processing status (GET /{container-id}?fields=status_code)
 * — a single check, no internal polling loop. Callers (the cron route) do
 * exactly one check per cron tick, since Meta's own recommended cadence
 * (once/minute, up to 5 minutes) cannot fit inside this app's cron
 * maxDuration budget even once — see design.md Decision 4 (Phase 1).
 */
export async function getContainerStatus(
  accessToken: string,
  containerId: string,
): Promise<InstagramContainerStatus> {
  const url = `${INSTAGRAM_GRAPH_BASE}/${containerId}?fields=status_code`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const rawText = await res.text();
  const json = JSON.parse(rawText) as RawContainerStatusResponse;

  if (!res.ok || !json.status_code) {
    throw new Error(`Instagram container status check failed: HTTP ${res.status} ${rawText}`);
  }

  // Meta's documented values are IN_PROGRESS / FINISHED / ERROR / EXPIRED /
  // PUBLISHED. Anything else observed live is treated as non-terminal by the
  // caller (falls through the same path as IN_PROGRESS) rather than thrown —
  // see design.md Risks for the PUBLISHED-without-our-own-media_publish edge
  // case this also covers defensively.
  return json.status_code as InstagramContainerStatus;
}

interface RawPublishResponse extends RawInstagramApiError {
  id?: string;
}

/**
 * Publishes a FINISHED container (POST /{ig-user-id}/media_publish). Must
 * only be called once getContainerStatus has confirmed status_code =
 * FINISHED — Instagram's own API rejects this call otherwise, unlike TikTok
 * where Init and "publish" are the same call (see design.md Decision 3).
 */
export async function publishContainer(
  igUserId: string,
  accessToken: string,
  containerId: string,
): Promise<{ mediaId: string }> {
  const url = `${INSTAGRAM_GRAPH_BASE}/${igUserId}/media_publish`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ creation_id: containerId }),
  });

  const rawText = await res.text();
  const json = JSON.parse(rawText) as RawPublishResponse;

  if (!res.ok || !json.id) {
    throw new Error(`Instagram media_publish failed: HTTP ${res.status} ${rawText}`);
  }

  return { mediaId: json.id };
}

/**
 * Classifies an Instagram publish failure, mirroring isTikTokPermanentFailure
 * / isPermanentFailure in app/api/cron/route.ts: auth/permission problems
 * (token invalid/expired, missing scope) are permanent — retrying wastes an
 * attempt on something that cannot self-heal without reconnecting. Rate-limit
 * responses (Instagram's 100-posts/24h cap) and network/5xx errors are
 * transient — see design.md Decision 8 (Phase 1): no pre-flight rate-limit
 * check, just classify a real rate-limit error as retry-later.
 */
export function isInstagramPermanentFailure(_err: unknown, message: string): boolean {
  const m = message.toLowerCase();
  if (/re-?authori|reconnect|access token|oauthexception|permission|invalid_business_account|not a professional account/.test(m)) {
    return true;
  }
  if (/jpeg is the only image format|unsupported media type|invalid image format/.test(m)) {
    return true;
  }
  if (/could not read photo from storage|no publishable video location/.test(m)) {
    return true;
  }
  return false;
}
