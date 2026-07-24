"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSignedUrl } from "@/lib/storage-sign-client";
import { storagePathFromStorageUrl } from "@/lib/storage-buckets";

/** Re-sign 5 min before expiry (ui TTL = 1h). */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;
const MIN_REFRESH_MS = 60_000;

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
 * Re-signs before expiry so previews/downloads stay valid past 1h.
 * `seedUrl` — optional signed URL from the generate response for instant first paint.
 */
export function useSignedMediaUrl(
  storagePath: string | null | undefined,
  seedUrl?: string | null,
): string | null {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
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
      clearTimer();
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const signed = await fetchSignedUrl({ path });
        if (cancelled) return;
        setSignedUrl(signed.url);
        clearTimer();
        const ms = new Date(signed.expiresAt).getTime() - Date.now() - REFRESH_BUFFER_MS;
        timerRef.current = setTimeout(() => void load(), Math.max(ms, MIN_REFRESH_MS));
      } catch {
        if (!cancelled) setSignedUrl(null);
      }
    };

    void load();
    return () => {
      cancelled = true;
      clearTimer();
    };
  }, [storagePath, clearTimer]);

  const path = storagePath?.trim();
  if (!path) return seedUrl ?? null;
  return signedUrl ?? seedUrl ?? null;
}
