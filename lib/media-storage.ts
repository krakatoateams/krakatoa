/**
 * The only module that talks to object storage.
 * Writes follow MEDIA_STORAGE_PROVIDER (default supabase). Reads try R2 first
 * when it is configured, then Supabase, so older generations keep opening.
 */
import "server-only";

import { AwsClient } from "aws4fetch";
import { supabaseServer } from "@/lib/supabase-server";
import { MEDIA_CACHE_CONTROL, STORAGE_BUCKET } from "@/lib/storage-buckets";
import {
  cacheControlHeader,
  logicalKeyFromR2,
  mediaWriteProvider,
  presignPlan,
  r2Configured,
  r2KeyPrefix,
  r2ObjectKey,
} from "@/lib/media-storage-pure";

type StorageError = { message: string };

export type MediaListEntry = {
  name: string;
  id: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  metadata?: { size?: number } | null;
};

type ListOptions = {
  limit?: number;
  offset?: number;
  search?: string;
  sortBy?: { column: string; order?: string };
};

type UploadBody = Blob | ArrayBuffer | ArrayBufferView | string;

type UploadOptions = {
  contentType?: string;
  cacheControl?: string;
  upsert?: boolean;
};

type ProviderName = "supabase" | "r2";

function env(): Record<string, string | undefined> {
  return process.env;
}

function r2On(): boolean {
  return r2Configured(env());
}

function writeProvider(): ProviderName {
  return mediaWriteProvider(env());
}

function r2Settings(): { accountId: string; bucket: string; client: AwsClient } {
  const accountId = process.env.R2_ACCOUNT_ID!.trim();
  const bucket = process.env.R2_BUCKET!.trim();
  const client = new AwsClient({
    accessKeyId: process.env.R2_ACCESS_KEY_ID!.trim(),
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!.trim(),
    service: "s3",
    region: "auto",
  });
  return { accountId, bucket, client };
}

function encodeKey(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function r2Key(path: string): string {
  return r2ObjectKey(r2KeyPrefix(env()), path);
}

function r2ObjectUrl(path: string): string {
  const { accountId, bucket } = r2Settings();
  return `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${encodeKey(r2Key(path))}`;
}

function r2BucketUrl(): string {
  const { accountId, bucket } = r2Settings();
  return `https://${accountId}.r2.cloudflarestorage.com/${bucket}`;
}

function toBytes(body: UploadBody): Buffer {
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  }
  throw new Error("Unsupported storage body.");
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Buffer.from(bytes));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function xmlValues(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}>([^<]*)</${tag}>`, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) {
    out.push(
      match[1]
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"'),
    );
  }
  return out;
}

async function r2Request(url: string, init: RequestInit): Promise<Response> {
  const { client } = r2Settings();
  if (init.body == null) return client.fetch(url, init);
  // Next's patched fetch rebuilds a Request input with its body as a stream,
  // dropping Content-Length, and R2 rejects chunked uploads with 411. Sign
  // only, then send the original sized body.
  // ponytail: uploads skip aws4fetch's 5xx retries; add a loop if R2 flakes.
  const signed = await client.sign(url, init);
  return fetch(signed.url, { method: signed.method, headers: signed.headers, body: init.body });
}

async function r2Head(path: string): Promise<{ size: number; sha256: string | null } | null> {
  const res = await r2Request(r2ObjectUrl(path), { method: "HEAD" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`R2 head failed (${res.status}).`);
  const size = Number(res.headers.get("content-length") ?? "0");
  return { size: Number.isFinite(size) ? size : 0, sha256: res.headers.get("x-amz-meta-sha256") };
}

async function r2Exists(path: string): Promise<boolean> {
  return (await r2Head(path)) !== null;
}

async function r2Put(
  path: string,
  body: UploadBody,
  options: UploadOptions,
): Promise<void> {
  if (options.upsert === false && (await r2Exists(path))) {
    throw new Error("The resource already exists");
  }
  const bytes = toBytes(body instanceof Blob ? Buffer.from(await body.arrayBuffer()) : body);
  const headers: Record<string, string> = {
    "content-type": options.contentType || "application/octet-stream",
  };
  if (options.cacheControl) headers["cache-control"] = cacheControlHeader(options.cacheControl);
  headers["x-amz-meta-sha256"] = await sha256Hex(bytes);
  const res = await r2Request(r2ObjectUrl(path), {
    method: "PUT",
    headers,
    body: new Blob([new Uint8Array(bytes)]),
  });
  if (!res.ok) throw new Error(`R2 upload failed (${res.status}).`);
}

async function r2Delete(path: string): Promise<void> {
  const res = await r2Request(r2ObjectUrl(path), { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`R2 delete failed (${res.status}).`);
}

async function r2Download(path: string): Promise<Blob | null> {
  const res = await r2Request(r2ObjectUrl(path), { method: "GET" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`R2 download failed (${res.status}).`);
  const type = res.headers.get("content-type") || "application/octet-stream";
  return new Blob([await res.arrayBuffer()], { type });
}

async function r2SignGet(path: string, ttlSec: number): Promise<{ url: string; expiresIn: number }> {
  const plan = presignPlan(Date.now(), ttlSec);
  const url = new URL(r2ObjectUrl(path));
  url.searchParams.set("X-Amz-Expires", String(plan.expiresSec));
  const { client } = r2Settings();
  const signed = await client.sign(url.toString(), {
    method: "GET",
    aws: { signQuery: true, datetime: plan.datetime },
  });
  return { url: signed.url, expiresIn: plan.validForSec };
}

async function r2SignPut(
  path: string,
  options: { contentType?: string; cacheControl?: string },
): Promise<{ url: string; headers: Record<string, string> }> {
  const headers: Record<string, string> = {
    "content-type": options.contentType || "application/octet-stream",
  };
  if (options.cacheControl) headers["cache-control"] = cacheControlHeader(options.cacheControl);
  const url = new URL(r2ObjectUrl(path));
  url.searchParams.set("X-Amz-Expires", "3600");
  const { client } = r2Settings();
  const signed = await client.sign(url.toString(), {
    method: "PUT",
    headers,
    aws: { signQuery: true },
  });
  return { url: signed.url, headers };
}

type R2Listed = { key: string; size: number; modified: string | null };

async function r2ListAll(prefix: string, delimiter?: string): Promise<{ keys: R2Listed[]; prefixes: string[] }> {
  const keys: R2Listed[] = [];
  const prefixes: string[] = [];
  let token: string | undefined;
  do {
    const url = new URL(r2BucketUrl());
    url.searchParams.set("list-type", "2");
    url.searchParams.set("max-keys", "1000");
    const scoped = r2Key(prefix);
    if (scoped) url.searchParams.set("prefix", scoped);
    if (delimiter) url.searchParams.set("delimiter", delimiter);
    if (token) url.searchParams.set("continuation-token", token);
    const res = await r2Request(url.toString(), { method: "GET" });
    if (!res.ok) throw new Error(`R2 list failed (${res.status}).`);
    const xml = await res.text();
    const blocks = xml.split("<Contents>").slice(1);
    for (const block of blocks) {
      const rawKey = xmlValues(`<Contents>${block}`, "Key")[0];
      const key = rawKey ? logicalKeyFromR2(r2KeyPrefix(env()), rawKey) : null;
      if (!key) continue;
      const size = Number(xmlValues(`<Contents>${block}`, "Size")[0] ?? "0");
      keys.push({
        key,
        size: Number.isFinite(size) ? size : 0,
        modified: xmlValues(`<Contents>${block}`, "LastModified")[0] ?? null,
      });
    }
    const folder = r2KeyPrefix(env());
    prefixes.push(
      ...xmlValues(xml, "Prefix")
        .map((item) => logicalKeyFromR2(folder, item))
        .filter((item): item is string => item !== null && item !== prefix),
    );
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
      ? xmlValues(xml, "NextContinuationToken")[0]
      : undefined;
  } while (token);
  return { keys, prefixes };
}

function folderPrefix(prefix: string): string {
  if (!prefix) return "";
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

async function r2ListFolder(prefix: string): Promise<MediaListEntry[]> {
  const base = folderPrefix(prefix);
  const { keys, prefixes } = await r2ListAll(base, "/");
  const folders: MediaListEntry[] = prefixes
    .map((full) => ({
      name: full.slice(base.length).replace(/\/$/, ""),
      id: null,
    }))
    .filter((entry) => entry.name.length > 0);
  const files: MediaListEntry[] = keys
    .filter((item) => item.key !== base)
    .map((item) => ({
      name: item.key.slice(base.length),
      id: item.key,
      created_at: item.modified,
      updated_at: item.modified,
      metadata: { size: item.size },
    }));
  return [...folders, ...files];
}

function bucket() {
  return supabaseServer.storage.from(STORAGE_BUCKET);
}

async function supabaseListAll(prefix: string): Promise<MediaListEntry[]> {
  const out: MediaListEntry[] = [];
  let offset = 0;
  const limit = 1000;
  for (;;) {
    const { data, error } = await bucket().list(prefix, {
      limit,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error(error.message);
    const entries = (data ?? []) as MediaListEntry[];
    out.push(...entries);
    if (entries.length < limit) break;
    offset += limit;
  }
  return out;
}

function mergeEntries(supabaseRows: MediaListEntry[], r2Rows: MediaListEntry[]): MediaListEntry[] {
  const byName = new Map<string, MediaListEntry>();
  for (const row of [...supabaseRows, ...r2Rows]) {
    const prev = byName.get(row.name);
    if (!prev) {
      byName.set(row.name, row);
      continue;
    }
    if (prev.id === null && row.id !== null) byName.set(row.name, row);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function listMedia(
  prefix: string,
  options: ListOptions = {},
): Promise<{ data: MediaListEntry[] | null; error: StorageError | null }> {
  try {
    if (!r2On()) {
      const { data, error } = await bucket().list(prefix, options);
      if (error) return { data: null, error: { message: error.message } };
      return { data: (data ?? []) as MediaListEntry[], error: null };
    }
    const [fromSupabase, fromR2] = await Promise.all([
      supabaseListAll(prefix),
      r2ListFolder(prefix).catch(() => [] as MediaListEntry[]),
    ]);
    let merged = mergeEntries(fromSupabase, fromR2);
    if (options.search) {
      const needle = options.search;
      merged = merged.filter((entry) => entry.name.includes(needle));
    }
    const offset = options.offset ?? 0;
    const limit = options.limit ?? merged.length;
    return { data: merged.slice(offset, offset + limit), error: null };
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : "storage.list failed" } };
  }
}

export async function uploadMedia(
  path: string,
  body: UploadBody,
  options: UploadOptions = {},
): Promise<{ error: StorageError | null }> {
  try {
    if (writeProvider() === "r2") {
      if (!r2On()) throw new Error("R2 storage is not configured.");
      await r2Put(path, body, options);
      return { error: null };
    }
    const { error } = await bucket().upload(path, body, options);
    return { error: error ? { message: error.message } : null };
  } catch (e) {
    return { error: { message: e instanceof Error ? e.message : "storage upload failed" } };
  }
}

export async function removeMedia(paths: string[]): Promise<{ error: StorageError | null }> {
  if (paths.length === 0) return { error: null };
  try {
    const { error } = await bucket().remove(paths);
    if (error) return { error: { message: error.message } };
    if (r2On()) {
      for (const path of paths) await r2Delete(path);
    }
    return { error: null };
  } catch (e) {
    return { error: { message: e instanceof Error ? e.message : "storage remove failed" } };
  }
}

export async function downloadMedia(
  path: string,
): Promise<{ data: Blob | null; error: StorageError | null }> {
  try {
    if (r2On() && (await r2Exists(path))) {
      const blob = await r2Download(path);
      if (blob) return { data: blob, error: null };
    }
    const { data, error } = await bucket().download(path);
    if (error || !data) return { data: null, error: error ? { message: error.message } : { message: "Not found" } };
    return { data, error: null };
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : "storage download failed" } };
  }
}

/** `data === false` means both providers confirmed the object is missing. */
export async function mediaExists(
  path: string,
): Promise<{ data: boolean | null; error: StorageError | null }> {
  try {
    if (r2On() && (await r2Exists(path))) return { data: true, error: null };
    const { data, error } = await bucket().exists(path);
    // supabase-js reports a missing object as { data: false, error: "Bad Request" }.
    if (data === false) return { data: false, error: null };
    if (error) return { data: null, error: { message: error.message } };
    return { data: data ?? null, error: null };
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : "storage exists failed" } };
  }
}

export async function signMediaGet(
  path: string,
  expiresIn: number,
): Promise<{ data: { signedUrl: string; expiresIn: number } | null; error: StorageError | null }> {
  try {
    if (r2On() && (await r2Exists(path))) {
      const signed = await r2SignGet(path, expiresIn);
      return { data: { signedUrl: signed.url, expiresIn: signed.expiresIn }, error: null };
    }
    const { data, error } = await bucket().createSignedUrl(path, expiresIn);
    if (error || !data?.signedUrl) {
      return { data: null, error: { message: error?.message ?? "Failed to create signed URL." } };
    }
    return { data: { signedUrl: data.signedUrl, expiresIn }, error: null };
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : "Failed to create signed URL." } };
  }
}

export async function createMediaUploadUrl(
  path: string,
  options: { contentType?: string; cacheControl?: string } = {},
): Promise<{
  data: { signedUrl: string; token: string; path: string; headers: Record<string, string> } | null;
  error: StorageError | null;
}> {
  const headers: Record<string, string> = {
    "content-type": options.contentType || "application/octet-stream",
  };
  if (options.cacheControl) headers["cache-control"] = cacheControlHeader(options.cacheControl);
  try {
    if (writeProvider() === "r2") {
      if (!r2On()) throw new Error("R2 storage is not configured.");
      const signed = await r2SignPut(path, options);
      return { data: { signedUrl: signed.url, token: "", path, headers: signed.headers }, error: null };
    }
    const { data, error } = await bucket().createSignedUploadUrl(path);
    if (error || !data?.signedUrl) {
      return { data: null, error: { message: error?.message ?? "Failed to create signed upload URL." } };
    }
    headers["x-upsert"] = "false";
    return { data: { signedUrl: data.signedUrl, token: data.token, path: data.path, headers }, error: null };
  } catch (e) {
    return {
      data: null,
      error: { message: e instanceof Error ? e.message : "Failed to create signed upload URL." },
    };
  }
}

async function walkKeys(provider: ProviderName, prefix: string): Promise<{ path: string; size: number }[]> {
  if (provider === "r2") {
    const { keys } = await r2ListAll(prefix);
    return keys.map((item) => ({ path: item.key, size: item.size }));
  }
  const out: { path: string; size: number }[] = [];
  async function walk(folder: string): Promise<void> {
    const entries = await supabaseListAll(folder);
    for (const entry of entries) {
      const full = folder ? `${folder}/${entry.name}` : entry.name;
      if (entry.id === null) await walk(full);
      else out.push({ path: full, size: entry.metadata?.size ?? 0 });
    }
  }
  await walk(prefix);
  return out;
}

/** Every object in one provider. The copy script uses this; app reads do not. */
export async function listKeysFrom(provider: ProviderName): Promise<{ path: string; size: number }[]> {
  if (provider === "r2" && !r2On()) throw new Error("R2 storage is not configured.");
  return walkKeys(provider, "");
}

export async function downloadFrom(provider: ProviderName, path: string): Promise<Uint8Array | null> {
  if (provider === "r2") {
    const blob = r2On() ? await r2Download(path) : null;
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  }
  const { data, error } = await bucket().download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

export async function putObjectOnR2(
  path: string,
  bytes: Uint8Array,
  contentType: string,
  cacheControl: string,
): Promise<{ size: number; sha256: string }> {
  if (!r2On()) throw new Error("R2 storage is not configured.");
  const sha256 = await sha256Hex(bytes);
  const res = await r2Request(r2ObjectUrl(path), {
    method: "PUT",
    headers: {
      "content-type": contentType,
      "cache-control": cacheControlHeader(cacheControl),
      "x-amz-meta-sha256": sha256,
    },
    body: Buffer.from(bytes),
  });
  if (!res.ok) throw new Error(`R2 upload failed (${res.status}).`);
  const head = await r2Head(path);
  if (!head || head.size !== bytes.byteLength || head.sha256 !== sha256) {
    throw new Error(`R2 verify failed for ${path}.`);
  }
  return { size: bytes.byteLength, sha256 };
}

/** Copy an object onto the write provider and delete the source from both. */
export async function moveMedia(
  from: string,
  to: string,
): Promise<{ error: StorageError | null }> {
  try {
    if (writeProvider() === "supabase") {
      const existing = await bucket().exists(from);
      if (existing.data) {
        const { error } = await bucket().move(from, to);
        if (error) return { error: { message: error.message } };
        if (r2On()) await r2Delete(from);
        return { error: null };
      }
    }
    const downloaded = await downloadMedia(from);
    if (downloaded.error || !downloaded.data) {
      return { error: downloaded.error ?? { message: "Not found" } };
    }
    const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
    const uploaded = await uploadMedia(to, bytes, {
      contentType: downloaded.data.type || "application/octet-stream",
      cacheControl: MEDIA_CACHE_CONTROL,
      upsert: false,
    });
    if (uploaded.error) return uploaded;
    return removeMedia([from]);
  } catch (e) {
    return { error: { message: e instanceof Error ? e.message : "storage move failed" } };
  }
}

export async function headObjectOnR2(
  path: string,
): Promise<{ size: number; sha256: string | null } | null> {
  if (!r2On()) throw new Error("R2 storage is not configured.");
  return r2Head(path);
}
