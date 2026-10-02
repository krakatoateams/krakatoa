"use client";

import { useEffect, useState } from "react";
import { useSignedMediaUrl } from "@/lib/use-signed-media-url";
import { FILMSTRIP_ROW_PX, filmstripCount, filmstripTimes } from "@/lib/editor-filmstrip";

// Frames are keyed by source (storage path or device object URL) + 0.1 s source time,
// so moves never re-extract and trims only capture the times they have not seen.
// Session memory only; data URLs at 2x row height are a few KB each.
const FRAME_CACHE_LIMIT = 600;
const frameCache = new Map<string, string>();
const aspectCache = new Map<string, number>();
/** Sources that could not be captured (decode error, tainted canvas): plain block, no retries. */
const failedPaths = new Set<string>();

const THUMB_HEIGHT_PX = FILMSTRIP_ROW_PX * 2;
const IDLE_MS = 300;
const WAIT_TIMEOUT_MS = 15_000;

function frameKey(path: string, sec: number): string {
  return `${path}@${sec.toFixed(1)}`;
}

function cacheFrame(key: string, dataUrl: string) {
  frameCache.set(key, dataUrl);
  while (frameCache.size > FRAME_CACHE_LIMIT) {
    const oldest = frameCache.keys().next().value;
    if (oldest === undefined) break;
    frameCache.delete(oldest);
  }
}

function cachedFrames(path: string, times: number[]): string[] | null {
  const frames = times.map((t) => frameCache.get(frameKey(path, t)));
  return frames.every((f): f is string => f !== undefined) ? frames : null;
}

function waitFor(video: HTMLVideoElement, event: "loadedmetadata" | "seeked"): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (fn: () => void) => {
      clearTimeout(timer);
      video.removeEventListener(event, onEvent);
      video.removeEventListener("error", onError);
      fn();
    };
    const onEvent = () => done(resolve);
    const onError = () => done(() => reject(new Error("video error")));
    const timer = setTimeout(() => done(() => reject(new Error("timeout"))), WAIT_TIMEOUT_MS);
    video.addEventListener(event, onEvent);
    video.addEventListener("error", onError);
  });
}

/**
 * Filmstrip frames for a timeline clip over its trimmed source range. Loads one hidden
 * video from the device file's object URL (no network) or else the stable signed URL,
 * seeks through the missing times, and releases it.
 * Returns null while loading or when the source cannot be captured (plain block).
 */
export function useClipFilmstrip(
  storagePath: string | null | undefined,
  localUrl: string | null | undefined,
  inSec: number,
  outSec: number,
  blockWidthPx: number
): string[] | null {
  const storage = storagePath?.trim() || null;
  const url = useSignedMediaUrl(localUrl ? null : storage, localUrl);
  const path = localUrl || storage;
  const [frames, setFrames] = useState<string[] | null>(null);

  useEffect(() => {
    if (!path || !url || failedPaths.has(path)) return;
    const knownAspect = aspectCache.get(path);
    if (knownAspect) {
      const hit = cachedFrames(path, filmstripTimes(inSec, outSec, filmstripCount(blockWidthPx, knownAspect)));
      if (hit) {
        setFrames(hit);
        return;
      }
    }

    let cancelled = false;
    let video: HTMLVideoElement | null = null;
    const release = () => {
      if (!video) return;
      video.removeAttribute("src");
      video.load();
      video = null;
    };

    // Debounced so a trim drag extracts once it settles, not on every pointermove.
    const timer = setTimeout(async () => {
      const el = document.createElement("video");
      video = el;
      el.crossOrigin = "anonymous";
      el.muted = true;
      el.playsInline = true;
      // "metadata" + seeks fetches only the byte ranges the frames need (see docs/ops/supabase-egress.md).
      el.preload = "metadata";
      el.src = url;
      try {
        await waitFor(el, "loadedmetadata");
        if (cancelled) return;
        const aspect = el.videoWidth > 0 && el.videoHeight > 0 ? el.videoWidth / el.videoHeight : 16 / 9;
        aspectCache.set(path, aspect);
        const times = filmstripTimes(inSec, outSec, filmstripCount(blockWidthPx, aspect));
        const canvas = document.createElement("canvas");
        canvas.height = THUMB_HEIGHT_PX;
        canvas.width = Math.max(1, Math.round(THUMB_HEIGHT_PX * aspect));
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no 2d context");
        const lastSec = Number.isFinite(el.duration) ? Math.max(0, el.duration - 0.05) : Infinity;
        for (const t of times) {
          const key = frameKey(path, t);
          if (frameCache.has(key)) continue;
          el.currentTime = Math.min(t, lastSec);
          await waitFor(el, "seeked");
          if (cancelled) return;
          ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
          cacheFrame(key, canvas.toDataURL("image/jpeg", 0.6));
        }
        const next = cachedFrames(path, times);
        if (next) setFrames(next);
      } catch (error) {
        // A timeout (busy tab, slow network) retries on the next change; real failures stay plain.
        if (!cancelled && !(error instanceof Error && error.message === "timeout")) failedPaths.add(path);
      } finally {
        if (video === el) release();
      }
    }, IDLE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      release();
    };
  }, [path, url, inSec, outSec, blockWidthPx]);

  return frames;
}
