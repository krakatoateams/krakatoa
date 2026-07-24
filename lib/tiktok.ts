import {
  isStorageRelativePath,
  photoStoragePathToProxyRest,
  storagePathFromPublicUrl,
  storagePathFromSignedUrl,
} from "@/lib/storage-buckets";

const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const TIKTOK_CREATOR_INFO_URL = "https://open.tiktokapis.com/v2/post/publish/creator_info/query/";
const TIKTOK_INIT_URL = "https://open.tiktokapis.com/v2/post/publish/video/init/";
const TIKTOK_CONTENT_INIT_URL = "https://open.tiktokapis.com/v2/post/publish/content/init/";

// TikTok's Init Direct Post caps a single chunk at 64MB. This app's scheduler
// already rejects uploads over 50MB (MAX_FILE_BYTES in the scheduler page), so
// every real video fits in exactly one chunk — the multi-chunk path exists for
// correctness but is not expected to run in practice.
const MAX_CHUNK_SIZE = 64 * 1024 * 1024;

/**
 * `new URL(request.url).origin` reports the Next.js dev server's own bind
 * address (localhost:PORT) instead of the actual Host header, breaking
 * redirect_uri when testing behind a tunnel (e.g. ngrok). Reading Host /
 * X-Forwarded-Proto directly matches what the browser actually requested,
 * and still resolves correctly in production (Vercel sets both headers).
 */
export function resolveOrigin(request: Request): string {
  const host = request.headers.get("host") ?? new URL(request.url).host;
  const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  return `${proto}://${host}`;
}

export interface TikTokTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
  openId: string;
  scope: string;
  tokenType: string;
}

interface RawTikTokTokenPayload {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_expires_in?: number;
  open_id?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

async function requestToken(body: Record<string, string>): Promise<TikTokTokenResponse> {
  const res = await fetch(TIKTOK_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cache-Control": "no-cache",
    },
    body: new URLSearchParams(body).toString(),
  });

  const data = (await res.json()) as RawTikTokTokenPayload;

  if (!res.ok || data.error || !data.access_token || !data.refresh_token) {
    throw new Error(
      `TikTok token request failed: ${data.error_description ?? data.error ?? res.statusText}`,
    );
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in ?? 86400,
    refreshExpiresIn: data.refresh_expires_in ?? 0,
    openId: data.open_id ?? "",
    scope: data.scope ?? "",
    tokenType: data.token_type ?? "Bearer",
  };
}

export async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<TikTokTokenResponse> {
  return requestToken({
    client_key: process.env.TIKTOK_CLIENT_KEY!,
    client_secret: process.env.TIKTOK_CLIENT_SECRET!,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });
}

/**
 * TikTok invalidates the old refresh_token on every call and issues a new one —
 * unlike Google's stable refresh_token, callers MUST persist the returned
 * refreshToken (not just accessToken) or the next refresh will fail.
 */
export async function refreshAccessToken(refreshToken: string): Promise<TikTokTokenResponse> {
  return requestToken({
    client_key: process.env.TIKTOK_CLIENT_KEY!,
    client_secret: process.env.TIKTOK_CLIENT_SECRET!,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

export interface TikTokCreatorInfo {
  creatorAvatarUrl: string;
  creatorUsername: string;
  creatorNickname: string;
  privacyLevelOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSec: number;
}

interface RawCreatorInfoResponse {
  data?: {
    creator_avatar_url?: string;
    creator_username?: string;
    creator_nickname?: string;
    privacy_level_options?: string[];
    comment_disabled?: boolean;
    duet_disabled?: boolean;
    stitch_disabled?: boolean;
    max_video_post_duration_sec?: number;
  };
  error?: { code?: string; message?: string; log_id?: string };
}

export async function getCreatorInfo(accessToken: string): Promise<TikTokCreatorInfo> {
  const res = await fetch(TIKTOK_CREATOR_INFO_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
  });

  const json = (await res.json()) as RawCreatorInfoResponse;

  if (!res.ok || (json.error?.code && json.error.code !== "ok") || !json.data) {
    throw new Error(`TikTok creator info query failed: ${json.error?.message ?? res.statusText}`);
  }

  const data = json.data;
  return {
    creatorAvatarUrl: data.creator_avatar_url ?? "",
    creatorUsername: data.creator_username ?? "",
    creatorNickname: data.creator_nickname ?? "",
    privacyLevelOptions: data.privacy_level_options ?? [],
    commentDisabled: data.comment_disabled ?? false,
    duetDisabled: data.duet_disabled ?? false,
    stitchDisabled: data.stitch_disabled ?? false,
    maxVideoPostDurationSec: data.max_video_post_duration_sec ?? 0,
  };
}

export interface TikTokPublishParams {
  accessToken: string;
  videoUrl: string;
  title: string;
  privacyLevel: string;
  brandOrganicToggle: boolean;
  brandContentToggle: boolean;
}

interface RawInitResponse {
  data?: { publish_id?: string; upload_url?: string };
  error?: { code?: string; message?: string; log_id?: string };
}

/**
 * TikTok requires branded content to be publicly viewable (so it can be added
 * to TikTok's Commercial Content Library where legally required) — it must
 * never be combined with SELF_ONLY. Enforced here (not just at the API/UI
 * layer) so a bad combination can never reach TikTok's Init call.
 */
function assertDisclosurePrivacyCompatible(privacyLevel: string, brandContentToggle: boolean): void {
  if (brandContentToggle && privacyLevel === "SELF_ONLY") {
    throw new Error(
      "Branded content cannot be posted with SELF_ONLY privacy — TikTok requires branded content to be publicly viewable.",
    );
  }
}

async function initDirectPost(params: {
  accessToken: string;
  videoSize: number;
  chunkSize: number;
  totalChunkCount: number;
  title: string;
  privacyLevel: string;
  brandOrganicToggle: boolean;
  brandContentToggle: boolean;
}): Promise<{ publishId: string; uploadUrl: string }> {
  assertDisclosurePrivacyCompatible(params.privacyLevel, params.brandContentToggle);

  const res = await fetch(TIKTOK_INIT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({
      post_info: {
        title: params.title,
        privacy_level: params.privacyLevel,
        brand_organic_toggle: params.brandOrganicToggle,
        brand_content_toggle: params.brandContentToggle,
      },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: params.videoSize,
        chunk_size: params.chunkSize,
        total_chunk_count: params.totalChunkCount,
      },
    }),
  });

  const json = (await res.json()) as RawInitResponse;

  if (!res.ok || (json.error?.code && json.error.code !== "ok") || !json.data?.publish_id || !json.data?.upload_url) {
    throw new Error(`TikTok Init Direct Post failed: ${json.error?.message ?? res.statusText}`);
  }

  return { publishId: json.data.publish_id, uploadUrl: json.data.upload_url };
}

async function uploadVideoChunks(
  uploadUrl: string,
  video: Uint8Array<ArrayBuffer>,
  chunkSize: number,
  totalChunkCount: number,
): Promise<void> {
  const total = video.byteLength;
  for (let i = 0; i < totalChunkCount; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, total) - 1;
    const chunk = video.subarray(start, end + 1);

    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Content-Length": String(chunk.byteLength),
      },
      body: chunk,
    });

    if (!res.ok) {
      throw new Error(`TikTok chunk upload failed (chunk ${i + 1}/${totalChunkCount}): HTTP ${res.status}`);
    }
  }
}

/**
 * Publishes a video to TikTok via Init Direct Post (FILE_UPLOAD source) and
 * returns the resulting publish_id. Completion is optimistic: a returned
 * publish_id is treated as "published" — this does not poll TikTok's
 * publish-status endpoint for final processing confirmation (see
 * openspec/changes/tiktok-publish/design.md, Decision 1).
 *
 * The video is fetched once into memory (not just HEAD-checked) so its exact
 * byte size is known and the same bytes can be sliced into chunks without a
 * second network round-trip.
 */
export async function publishToTikTok(params: TikTokPublishParams): Promise<string> {
  assertDisclosurePrivacyCompatible(params.privacyLevel, params.brandContentToggle);

  // Sanity-check the account can actually post before spending an Init call.
  await getCreatorInfo(params.accessToken);

  const videoRes = await fetch(params.videoUrl);
  if (!videoRes.ok || !videoRes.body) {
    throw new Error(`Could not fetch video from storage (HTTP ${videoRes.status}): ${params.videoUrl}`);
  }
  // A plain Uint8Array backed by a real ArrayBuffer (not Node's Buffer, whose
  // .buffer is typed as the wider ArrayBufferLike) so .subarray() slices stay
  // assignable to fetch's BodyInit without any copy — same bytes, just a view.
  const video = new Uint8Array(await videoRes.arrayBuffer());
  const videoSize = video.byteLength;

  const chunkSize = Math.min(videoSize, MAX_CHUNK_SIZE);
  const totalChunkCount = Math.max(1, Math.ceil(videoSize / chunkSize));

  const { publishId, uploadUrl } = await initDirectPost({
    accessToken: params.accessToken,
    videoSize,
    chunkSize,
    totalChunkCount,
    title: params.title,
    privacyLevel: params.privacyLevel,
    brandOrganicToggle: params.brandOrganicToggle,
    brandContentToggle: params.brandContentToggle,
  });

  await uploadVideoChunks(uploadUrl, video, chunkSize, totalChunkCount);

  return publishId;
}

// ─────────────────────────────────────────────────────────────────────────────
// Photo posts (openspec/changes/tiktok-photo-post) — additive only, nothing
// above this line is touched. TikTok's photo endpoint supports ONLY
// PULL_FROM_URL as a source (no FILE_UPLOAD equivalent), so there is no
// upload-bytes step here at all: TikTok fetches each image itself once Init
// succeeds, unlike the video path above.
// ─────────────────────────────────────────────────────────────────────────────

interface RawContentInitResponse {
  data?: { publish_id?: string };
  error?: { code?: string; message?: string; log_id?: string };
}

async function initPhotoPost(params: {
  accessToken: string;
  photoUrls: string[];
  title: string;
  description: string;
  privacyLevel: string;
  brandOrganicToggle: boolean;
  brandContentToggle: boolean;
}): Promise<{ publishId: string }> {
  assertDisclosurePrivacyCompatible(params.privacyLevel, params.brandContentToggle);

  const res = await fetch(TIKTOK_CONTENT_INIT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({
      post_info: {
        title: params.title,
        description: params.description,
        privacy_level: params.privacyLevel,
        brand_organic_toggle: params.brandOrganicToggle,
        brand_content_toggle: params.brandContentToggle,
      },
      source_info: {
        source: "PULL_FROM_URL",
        // Cover photo picker is out of scope for this change — always the
        // first selected photo (see design.md Non-Goals).
        photo_cover_index: 0,
        photo_images: params.photoUrls,
      },
      post_mode: "DIRECT_POST",
      media_type: "PHOTO",
    }),
  });

  const json = (await res.json()) as RawContentInitResponse;

  if (!res.ok || (json.error?.code && json.error.code !== "ok") || !json.data?.publish_id) {
    throw new Error(`TikTok photo Init failed: ${json.error?.message ?? res.statusText}`);
  }

  return { publishId: json.data.publish_id };
}

/**
 * Rewrites a Supabase Storage public photo URL to this app's own
 * `/api/tiktok-photos/` proxy — required because TikTok's PULL_FROM_URL
 * validates the URL against a domain/prefix verified in the TikTok Developer
 * Portal, and `*.supabase.co` isn't ours to verify (see design.md, Decision 1).
 * Throws (rather than silently passing through the original URL) if the URL
 * isn't a recognized `photos/`-prefixed storage URL — sending TikTok a URL
 * that can never pass verification would just surface as a confusing
 * TikTok-side error instead of a clear one here.
 */
function toProxyPhotoUrl(urlOrPath: string, origin: string): string {
  const path = isStorageRelativePath(urlOrPath)
    ? urlOrPath
    : storagePathFromPublicUrl(urlOrPath) ?? storagePathFromSignedUrl(urlOrPath);
  const rest = path ? photoStoragePathToProxyRest(path) : null;
  if (!rest) {
    throw new Error(
      `Photo URL is not a recognized user photo storage path — cannot proxy for TikTok: ${urlOrPath}`,
    );
  }
  return `${origin}/api/tiktok-photos/${rest}`;
}

export interface TikTokPhotoPublishParams {
  accessToken: string;
  photoUrls: string[];
  title: string;
  description: string;
  privacyLevel: string;
  brandOrganicToggle: boolean;
  brandContentToggle: boolean;
  /** This app's own origin (e.g. from resolveOrigin(request) in the cron
   * route) — used to build the verified-domain proxy URL for each photo. */
  origin: string;
}

/**
 * Publishes a photo post (carousel of 1-35 images) to TikTok via Init
 * (`PULL_FROM_URL` source) and returns the resulting publish_id. Completion
 * is optimistic, same as the video path — see design.md Decision 4.
 *
 * Unlike publishToTikTok, there is no upload step: PULL_FROM_URL means
 * TikTok fetches the (proxied) images itself once Init succeeds.
 */
export async function publishPhotoToTikTok(params: TikTokPhotoPublishParams): Promise<string> {
  assertDisclosurePrivacyCompatible(params.privacyLevel, params.brandContentToggle);

  // Sanity-check the account can actually post before spending an Init call.
  await getCreatorInfo(params.accessToken);

  const proxiedUrls = params.photoUrls.map((url) => toProxyPhotoUrl(url, params.origin));

  const { publishId } = await initPhotoPost({
    accessToken: params.accessToken,
    photoUrls: proxiedUrls,
    title: params.title,
    description: params.description,
    privacyLevel: params.privacyLevel,
    brandOrganicToggle: params.brandOrganicToggle,
    brandContentToggle: params.brandContentToggle,
  });

  return publishId;
}
