"use client";

import { useEffect, useState } from "react";
import { useSignedMediaUrl } from "@/lib/use-signed-media-url";
import {
  FILMSTRIP_ROW_PX,
  filmstripCount,
  filmstripGridIndex,
  filmstripTileTime,
  filmstripTileWidth,
  FILMSTRIP_GRID_FPS,
} from "@/lib/editor-filmstrip";

// Frames are keyed by source (storage path or device object URL) + capture DPR bucket +
// 1/30 s source-time slot, so moves never re-extract and trims only capture times not yet seen.
// Session memory only; a tile frame is a few KB of data URL.
const FRAME_CACHE_LIMIT = 1500;
const frameCache = new Map<string, Map<number, string>>();
let frameCacheSize = 0;
const aspectCache = new Map<string, number>();
/** Sources that could not be captured (decode error, tainted canvas): plain block, no retries. */
const failedPaths = new Set<string>();

const IDLE_MS = 300;
const WAIT_TIMEOUT_MS = 15_000;
const JPEG_QUALITY = 0.85;

function dprBucket(): number {
  return Math.min(3, Math.max(1, Math.round(globalThis.devicePixelRatio || 1)));
}

function cacheFrame(sourceKey: string, slot: number, dataUrl: string) {
  let frames = frameCache.get(sourceKey);
  if (!frames) frameCache.set(sourceKey, (frames = new Map()));
  if (!frames.has(slot)) frameCacheSize++;
  frames.set(slot, dataUrl);
  while (frameCacheSize > FRAME_CACHE_LIMIT) {
    const oldestSource = frameCache.keys().next().value;
    if (oldestSource === undefined) break;
    const bucket = frameCache.get(oldestSource)!;
    const oldestSlot = bucket.keys().next().value;
    if (oldestSlot !== undefined && bucket.delete(oldestSlot)) frameCacheSize--;
    if (bucket.size === 0) frameCache.delete(oldestSource);
  }
}

/** Exact frame for the slot, else the nearest cached frame of the same source, else null. */
function frameFor(sourceKey: string, slot: number): string | null {
  const frames = frameCache.get(sourceKey);
  if (!frames) return null;
  const exact = frames.get(slot);
  if (exact) return exact;
  let best: string | null = null;
  let bestDist = Infinity;
  for (const [s, src] of frames) {
    const dist = Math.abs(s - slot);
    if (dist < bestDist) {
      bestDist = dist;
      best = src;
    }
  }
  return best;
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

export type FilmstripTile = { index: number; left: number; src: string | null };

/** Tile indices covering the viewport [viewLeft, viewRight] (block-local px). */
function visibleRange(count: number, tileWidth: number, viewLeft: number, viewRight: number): [number, number] {
  const first = Math.min(count - 1, Math.max(0, Math.floor(viewLeft / tileWidth)));
  const last = Math.min(count - 1, Math.max(first, Math.floor(viewRight / tileWidth)));
  return [first, last];
}

/**
 * Filmstrip tiles for a timeline clip: fixed-width, aspect-correct tiles over the trimmed
 * source range, one frame per tile, only near the scroll viewport. A tile without its exact
 * frame shows the nearest cached frame of the same source, else `src: null` (placeholder).
 * Loads one hidden video (device object URL, else the stable signed URL), seeks through the
 * missing times, and releases it. Returns null when there is no source or it cannot be captured.
 */
export function useClipFilmstrip(
  storagePath: string | null | undefined,
  localUrl: string | null | undefined,
  inSec: number,
  outSec: number,
  blockWidthPx: number,
  /** Visible scroll range in block-local px (already padded by the caller). */
  viewLeft: number,
  viewRight: number
): { tileWidth: number; tiles: FilmstripTile[] } | null {
  const storage = storagePath?.trim() || null;
  const url = useSignedMediaUrl(localUrl ? null : storage, localUrl);
  const path = localUrl || storage;
  const [, setVersion] = useState(0);
  const dpr = dprBucket();

  const aspect = (path && aspectCache.get(path)) || 16 / 9;
  const tileWidth = filmstripTileWidth(aspect);
  const count = filmstripCount(blockWidthPx, aspect);
  const [first, last] = visibleRange(count, tileWidth, viewLeft, viewRight);

  useEffect(() => {
    if (!path || !url || failedPaths.has(path)) return;
    const sourceKey = `${path}|${dpr}`;
    const slotsFor = (a: number) => {
      const tw = filmstripTileWidth(a);
      const [f, l] = visibleRange(filmstripCount(blockWidthPx, a), tw, viewLeft, viewRight);
      const slots: number[] = [];
      for (let i = f; i <= l; i++) slots.push(filmstripGridIndex(filmstripTileTime(i, inSec, outSec, blockWidthPx, tw)));
      return slots;
    };
    const knownAspect = aspectCache.get(path);
    if (knownAspect && slotsFor(knownAspect).every((slot) => frameCache.get(sourceKey)?.has(slot))) return;

    let cancelled = false;
    let video: HTMLVideoElement | null = null;
    const release = () => {
      if (!video) return;
      video.removeAttribute("src");
      video.load();
      video = null;
    };

    // Debounced so a trim drag or scroll extracts once it settles, not on every pointermove.
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
        const realAspect = el.videoWidth > 0 && el.videoHeight > 0 ? el.videoWidth / el.videoHeight : 16 / 9;
        const aspectChanged = aspectCache.get(path) !== realAspect;
        aspectCache.set(path, realAspect);
        if (aspectChanged) setVersion((v) => v + 1);
        const canvas = document.createElement("canvas");
        canvas.height = FILMSTRIP_ROW_PX * dpr;
        canvas.width = filmstripTileWidth(realAspect) * dpr;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no 2d context");
        const lastSec = Number.isFinite(el.duration) ? Math.max(0, el.duration - 0.05) : Infinity;
        for (const slot of slotsFor(realAspect)) {
          if (frameCache.get(sourceKey)?.has(slot)) continue;
          el.currentTime = Math.min(slot / FILMSTRIP_GRID_FPS, lastSec);
          await waitFor(el, "seeked");
          if (cancelled) return;
          ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
          cacheFrame(sourceKey, slot, canvas.toDataURL("image/jpeg", JPEG_QUALITY));
          setVersion((v) => v + 1);
        }
      } catch (error) {
        // A timeout (busy tab, slow network) retries on the next change; real failures stay plain.
        if (!cancelled && !(error instanceof Error && error.message === "timeout")) {
          failedPaths.add(path);
          setVersion((v) => v + 1);
        }
      } finally {
        if (video === el) release();
      }
    }, IDLE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      release();
    };
    // first/last stand in for viewLeft/viewRight so sub-tile scrolling does not restart extraction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, url, inSec, outSec, blockWidthPx, first, last, dpr]);

  if (!path || failedPaths.has(path)) return null;
  const sourceKey = `${path}|${dpr}`;
  const tiles: FilmstripTile[] = [];
  for (let index = first; index <= last; index++) {
    const slot = filmstripGridIndex(filmstripTileTime(index, inSec, outSec, blockWidthPx, tileWidth));
    tiles.push({ index, left: index * tileWidth, src: frameFor(sourceKey, slot) });
  }
  return { tileWidth, tiles };
}
