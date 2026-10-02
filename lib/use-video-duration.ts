"use client";

import { useEffect, useState } from "react";

// A background tab may never load metadata; give up so a later pass can retry.
export const VIDEO_PROBE_TIMEOUT_MS = 15_000;

/** Read clip length from a video URL or blob URL (metadata only). Null on error or timeout. */
export function probeVideoDurationSec(src: string): Promise<number | null> {
  return new Promise((resolve) => {
    const el = document.createElement("video");
    el.preload = "metadata";
    // Do not set crossOrigin — on public CDNs without ACAO it blocks metadata.
    let settled = false;
    const finish = (d: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      el.removeAttribute("src");
      el.load();
      resolve(d);
    };
    const timer = setTimeout(() => finish(null), VIDEO_PROBE_TIMEOUT_MS);
    el.onloadedmetadata = () => {
      const d = el.duration;
      finish(typeof d === "number" && Number.isFinite(d) && d > 0 ? d : null);
    };
    el.onerror = () => finish(null);
    el.src = src;
  });
}

export function useVideoDurationSec(src: string | null | undefined): {
  durationSec: number | null;
  measuring: boolean;
  failed: boolean;
} {
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!src) {
      setDurationSec(null);
      setMeasuring(false);
      setFailed(false);
      return;
    }

    let cancelled = false;
    setDurationSec(null);
    setMeasuring(true);
    setFailed(false);

    void probeVideoDurationSec(src).then((d) => {
      if (cancelled) return;
      setMeasuring(false);
      if (d == null) setFailed(true);
      else setDurationSec(d);
    });

    return () => {
      cancelled = true;
    };
  }, [src]);

  return { durationSec, measuring, failed };
}
