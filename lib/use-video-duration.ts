"use client";

import { useEffect, useState } from "react";

/** Read clip length from a video URL or blob URL (metadata only). */
export function probeVideoDurationSec(src: string): Promise<number | null> {
  return new Promise((resolve) => {
    const el = document.createElement("video");
    el.preload = "metadata";
    // Do not set crossOrigin — on public CDNs without ACAO it blocks metadata.
    const cleanup = () => {
      el.removeAttribute("src");
      el.load();
    };
    el.onloadedmetadata = () => {
      const d = el.duration;
      cleanup();
      resolve(typeof d === "number" && Number.isFinite(d) && d > 0 ? d : null);
    };
    el.onerror = () => {
      cleanup();
      resolve(null);
    };
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
