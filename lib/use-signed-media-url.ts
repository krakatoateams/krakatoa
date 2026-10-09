"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSignedUrl } from "@/lib/storage-sign-client";
import { storagePathFromStorageUrl } from "@/lib/storage-buckets";

/** Re-sign 5 min before expiry. */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;
const MIN_REFRESH_MS = 60_000;
/**
 * setTimeout stores its delay in a signed 32-bit int, so anything past ~24.8 days
 * overflows and fires immediately — which would turn the long UI TTL into a re-sign
 * loop. Cap the wait; a page open longer than this re-signs once, harmlessly.
 */
const MAX_REFRESH_MS = 12 * 60 * 60 * 1000;

/** Extract `storagePath` from generate-* JSON (top-level or historyItem). */
export function pickGenerateStoragePath(data: {
  storagePath?: string | null;
  historyItem?: { storagePath?: string } | null;
  videoUrl?: string | null;
  imageUrl?: string | null;
}): string | null {
  const direct = data.storagePath?.trim();
  if (direct) return direct;
  const fromHistory = data.historyItem?.storagePath?.trim();
  if (fromHistory) return fromHistory;
  const media = data.videoUrl ?? data.imageUrl;
  return storagePathFromStorageUrl(media) ?? null;
}

/**
 * Resolve a fetchable media URL from a canonical storage path.
 * Re-signs before expiry so previews/downloads stay valid.
 * `seedUrl` — optional signed URL from the generate response for instant first paint.
 */
export function useSignedMediaUrlState(
  storagePath: string | null | undefined,
  seedUrl?: string | null,
): { url: string | null; failed: boolean } {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const path = storagePath?.trim();
    if (!path) {
      setSignedUrl(null);
      setFailed(false);
      clearTimer();
      return;
    }
    setFailed(false);

    let cancelled = false;

    const load = async () => {
      try {
        const signed = await fetchSignedUrl({ path });
        if (cancelled) return;
        setSignedUrl(signed.url);
        setFailed(false);
        clearTimer();
        const ms = new Date(signed.expiresAt).getTime() - Date.now() - REFRESH_BUFFER_MS;
        const delay = Math.min(Math.max(ms, MIN_REFRESH_MS), MAX_REFRESH_MS);
        timerRef.current = setTimeout(() => void load(), delay);
      } catch {
        if (!cancelled) {
          setSignedUrl(null);
          setFailed(true);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
      clearTimer();
    };
  }, [storagePath, clearTimer]);

  const path = storagePath?.trim();
  if (!path) return { url: seedUrl ?? null, failed: false };
  return {
    url: signedUrl ?? seedUrl ?? null,
    failed: failed && !signedUrl && !seedUrl,
  };
}

export function useSignedMediaUrl(
  storagePath: string | null | undefined,
  seedUrl?: string | null,
): string | null {
  return useSignedMediaUrlState(storagePath, seedUrl).url;
}
