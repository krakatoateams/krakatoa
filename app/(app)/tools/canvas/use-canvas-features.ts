"use client";

import { useSyncExternalStore } from "react";
import {
  mapVideoComposerEnablement,
  type VideoComposerKey,
} from "@/lib/video-composer-features";
import type { CanvasImageEnablement, CanvasVideoEnablement } from "@/lib/canvas-model-options";

/** Loading / ready / failed. `data` keeps the last good value across a failed refresh. */
export type FeatureState<T> = { status: "loading" | "ready" | "error"; data: T | null };

/**
 * One module-level fetch shared by every Canvas node (not per render, not per
 * node). Refreshes when the tab regains focus, which also retries a failure.
 */
function createFeatureStore<T>(load: () => Promise<T>) {
  let state: FeatureState<T> = { status: "loading", data: null };
  const listeners = new Set<() => void>();
  let inflight = false;

  const set = (next: FeatureState<T>) => {
    state = next;
    listeners.forEach((l) => l());
  };
  const refresh = () => {
    if (inflight) return;
    inflight = true;
    load()
      .then((data) => set({ status: "ready", data }))
      .catch(() => set({ status: "error", data: state.data }))
      .finally(() => {
        inflight = false;
      });
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") refresh();
  };

  return {
    subscribe(listener: () => void) {
      if (listeners.size === 0) {
        document.addEventListener("visibilitychange", onVisible);
        refresh();
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) document.removeEventListener("visibilitychange", onVisible);
      };
    },
    getSnapshot: () => state,
  };
}

async function getJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

const videoStore = createFeatureStore<CanvasVideoEnablement>(async () => {
  const data = await getJson("/api/tools/video/features");
  if (!Array.isArray(data?.composers)) throw new Error("bad video features");
  const raw = {} as Record<VideoComposerKey, { enabledTiers: string[]; defaultTier: string }>;
  for (const c of data.composers) {
    if (c.key) {
      raw[c.key as VideoComposerKey] = {
        enabledTiers: c.enabledModelIds ?? [],
        defaultTier: c.defaultModelId ?? "",
      };
    }
  }
  return mapVideoComposerEnablement(raw);
});

// Canvas Image nodes submit `mode: "image"`, so the `image` feature governs them.
const imageStore = createFeatureStore<CanvasImageEnablement>(async () => {
  const data = await getJson("/api/tools/photo/features");
  const feature = Array.isArray(data?.features)
    ? data.features.find((f: { key?: string }) => f.key === "image")
    : null;
  if (!feature) throw new Error("bad photo features");
  return { enabledTiers: feature.enabledTiers ?? [], defaultTier: feature.defaultTier ?? null };
});

const loadingState: FeatureState<never> = { status: "loading", data: null };

export function useCanvasVideoFeatures(): FeatureState<CanvasVideoEnablement> {
  return useSyncExternalStore(videoStore.subscribe, videoStore.getSnapshot, () => loadingState);
}

export function useCanvasImageFeatures(): FeatureState<CanvasImageEnablement> {
  return useSyncExternalStore(imageStore.subscribe, imageStore.getSnapshot, () => loadingState);
}
