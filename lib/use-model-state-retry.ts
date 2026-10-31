"use client";

import { useEffect } from "react";

/**
 * While a model-state read has failed, retry it when the tab or window becomes active again
 * (Video and Canvas refresh the same way), so a temporary outage clears without a reload.
 */
export function useRetryWhenVisible(failed: boolean, retry: () => void): void {
  useEffect(() => {
    if (!failed) return;
    // One tab return fires both events: retry once.
    let last = 0;
    const onActive = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 1_000) return;
      last = Date.now();
      retry();
    };
    document.addEventListener("visibilitychange", onActive);
    window.addEventListener("focus", onActive);
    return () => {
      document.removeEventListener("visibilitychange", onActive);
      window.removeEventListener("focus", onActive);
    };
  }, [failed, retry]);
}

/** A skill only depends on its own kind's model list: a failed photo read must not block a video skill. */
export function skillModelsUnavailable(p: { isVideo: boolean; photoFailed: boolean; videoFailed: boolean }): boolean {
  return p.isVideo ? p.videoFailed : p.photoFailed;
}
