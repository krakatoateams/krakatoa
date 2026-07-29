import sharp from "sharp";
import { supabaseServer } from "@/lib/supabase-server";
import {
  STORAGE_BUCKET,
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

// Provider-agnostic despite living here originally — re-exported for every
// existing call site (this file, the tiktok connect routes, app/api/cron/route.ts)
// so nothing else needs to change. New callers (e.g. Instagram) should import
// directly from lib/http.ts instead.
export { resolveOrigin } from "@/lib/http";

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

const TIKTOK_STATUS_FETCH_URL = "https://open.tiktokapis.com/v2/post/publish/status/fetch/";

interface RawStatusFetchResponse {
  data?: {
    status?: string;
    fail_reason?: string;
  };
  error?: { code?: string; message?: string; log_id?: string };
}

interface TikTokPublishStatus {
  status: string;
  failReason: string;
}

async function fetchPublishStatus(accessToken: string, publishId: string): Promise<TikTokPublishStatus> {
  const res = await fetch(TIKTOK_STATUS_FETCH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({ publish_id: publishId }),
  });

  const json = (await res.json()) as RawStatusFetchResponse;
  if (!res.ok || (json.error?.code && json.error.code !== "ok") || !json.data?.status) {
    throw new Error(`TikTok status fetch failed: ${json.error?.message ?? res.statusText}`);
  }

  return { status: json.data.status, failReason: json.data.fail_reason ?? "" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Bounded poll budget. This runs inside the cron route's single serverless
// invocation (maxDuration = 60s total, shared with token refresh, Init, and
// everything else in that request), so it must stay comfortably under that
// — not approach it.
const STATUS_POLL_INTERVAL_MS = 3000;
const STATUS_POLL_MAX_WAIT_MS = 24000;

export type TikTokPublishOutcome =
  | { outcome: "complete" }
  | { outcome: "failed"; failReason: string }
  | { outcome: "pending"; lastStatus: string };

/**
 * Polls TikTok's publish status (POST /v2/post/publish/status/fetch/) until
 * a terminal state or a bounded max wait elapses. Init succeeding only means
 * TikTok *accepted* the request (post_status/fetch's own docs: PROCESSING_UPLOAD
 * for FILE_UPLOAD / PROCESSING_DOWNLOAD for PULL_FROM_URL) — the actual
 * upload/download + publish happens asynchronously afterward and can still
 * fail (e.g. `file_format_check_failed` for a PNG photo — see
 * openspec/changes/tiktok-photo-post bug history, where a post sat as
 * "published" in our DB despite never appearing on the actual account).
 *
 * "pending" is a distinct, non-terminal outcome for when TikTok is still
 * processing after the wait budget — not a failure and not a success.
 * Callers must not block indefinitely waiting for it to resolve and must not
 * treat it as either terminal outcome.
 */
export async function waitForTikTokPublishOutcome(
  accessToken: string,
  publishId: string,
): Promise<TikTokPublishOutcome> {
  const deadline = Date.now() + STATUS_POLL_MAX_WAIT_MS;
  let lastStatus = "";
  while (true) {
    const { status, failReason } = await fetchPublishStatus(accessToken, publishId);
    lastStatus = status;
    if (status === "PUBLISH_COMPLETE") return { outcome: "complete" };
    if (status === "FAILED") return { outcome: "failed", failReason: failReason || "Unknown failure reason." };
    // Still going: PROCESSING_UPLOAD (video) / PROCESSING_DOWNLOAD (photo) /
    // SEND_TO_USER_INBOX (draft-review flow, not used by this app's DIRECT_POST).
    if (Date.now() >= deadline) return { outcome: "pending", lastStatus };
    await sleep(STATUS_POLL_INTERVAL_MS);
  }
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
 * Resolves any accepted photo reference (bare storage path, public URL, or
 * signed URL) to a bucket-relative storage path. Throws if it isn't a
 * recognized user photo storage location — sending TikTok a URL that can
 * never pass its domain verification would just surface as a confusing
 * TikTok-side error instead of a clear one here.
 */
function resolvePhotoStoragePath(urlOrPath: string): string {
  const path = isStorageRelativePath(urlOrPath)
    ? urlOrPath
    : storagePathFromPublicUrl(urlOrPath) ?? storagePathFromSignedUrl(urlOrPath);
  if (!path) {
    throw new Error(
      `Photo URL is not a recognized user photo storage path — cannot proxy for TikTok: ${urlOrPath}`,
    );
  }
  return path;
}

/**
 * Rewrites a photo storage path to this app's own `/api/tiktok-photos/`
 * proxy — required because TikTok's PULL_FROM_URL validates the URL against
 * a domain/prefix verified in the TikTok Developer Portal, and `*.supabase.co`
 * isn't ours to verify (see design.md, Decision 1).
 */
function toProxyPhotoUrl(storagePath: string, origin: string): string {
  const rest = photoStoragePathToProxyRest(storagePath);
  if (!rest) {
    throw new Error(
      `Photo URL is not a recognized user photo storage path — cannot proxy for TikTok: ${storagePath}`,
    );
  }
  return `${origin}/api/tiktok-photos/${rest}`;
}

/**
 * Sniffs an image's real format from its magic bytes — not the stored
 * content-type or the file extension, either of which could be wrong or
 * absent. Only the formats relevant to the TikTok format check are
 * distinguished; anything else (or too short to tell) is "unknown".
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
  // RIFF....WEBP — bytes 0-3 "RIFF", bytes 8-11 "WEBP".
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
 * Ensures a photo storage path points to a file TikTok's PULL_FROM_URL will
 * actually accept. Per TikTok's Content Posting API media-transfer guide,
 * photo posts only support JPEG and WebP — PNG (the default output of both
 * Product Photo and Storyboard generation) is rejected at TikTok's async
 * fetch step with `file_format_check_failed`, even though our own Init call
 * and proxy succeed (confirmed by pulling the real publish status for a
 * failed post — see openspec/changes/tiktok-photo-post bug history).
 *
 * Downloads the original, sniffs its *real* format from its magic bytes
 * (not the stored content-type or extension — a mislabeled file shouldn't
 * slip through), and if it isn't already JPEG or WebP, converts it to JPEG
 * via sharp and uploads the result under a sibling path so the existing
 * proxy route serves it with zero changes. Returns the storage path to
 * actually proxy — the original path if no conversion was needed.
 */
async function ensureTikTokCompatiblePhoto(storagePath: string): Promise<string> {
  const { data, error } = await supabaseServer.storage.from(STORAGE_BUCKET).download(storagePath);
  if (error || !data) {
    throw new Error(`Could not read photo from storage for TikTok format check: ${storagePath}`);
  }

  const bytes = new Uint8Array(await data.arrayBuffer());
  const format = sniffImageFormat(bytes);
  if (format === "jpeg" || format === "webp") return storagePath;

  const jpegBuffer = await sharp(Buffer.from(bytes)).jpeg({ quality: 90 }).toBuffer();
  // Sibling path (not overwriting the original) so the source asset — still
  // used elsewhere (Product Photo history, other posts) — is untouched.
  const convertedPath = `${storagePath.replace(/\.[^./]+$/, "")}.tiktok.jpg`;

  const { error: uploadError } = await supabaseServer.storage
    .from(STORAGE_BUCKET)
    .upload(convertedPath, jpegBuffer, { contentType: "image/jpeg", upsert: true });
  if (uploadError) {
    throw new Error(`Failed to upload converted JPEG for TikTok: ${uploadError.message}`);
  }

  return convertedPath;
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
 * Unlike publishToTikTok, there is no upload step for the original bytes:
 * PULL_FROM_URL means TikTok fetches the (proxied) images itself once Init
 * succeeds. Each photo is still individually format-checked and converted
 * if needed (see ensureTikTokCompatiblePhoto) before that proxy URL is built
 * — a carousel can mix a PNG (e.g. AI-generated) with a JPEG (e.g. raw
 * upload), so this happens per-image, not once for the whole batch.
 */
export async function publishPhotoToTikTok(params: TikTokPhotoPublishParams): Promise<string> {
  assertDisclosurePrivacyCompatible(params.privacyLevel, params.brandContentToggle);

  // Sanity-check the account can actually post before spending an Init call.
  await getCreatorInfo(params.accessToken);

  const proxiedUrls = await Promise.all(
    params.photoUrls.map(async (urlOrPath) => {
      const storagePath = resolvePhotoStoragePath(urlOrPath);
      const compatiblePath = await ensureTikTokCompatiblePhoto(storagePath);
      return toProxyPhotoUrl(compatiblePath, params.origin);
    }),
  );

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
