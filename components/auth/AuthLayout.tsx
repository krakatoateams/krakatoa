"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

// Same background clips as the homepage hero (components/landing/HeroSectionVideo.tsx),
// served from our own Supabase Storage (the *.r2.dev dev domain was flaky).
const VIDEO_BASE =
  "https://ybfmllqcvvexldsteuaw.supabase.co/storage/v1/object/public/Internal%20Assets/Videos";
const VIDEO_FILES = [
  "Badminton (GPT)-optimized.mp4",
  "Car Racing 1 (Seedence)-optimized.mp4",
  "Car Racing 2 (seedence)-optimized.mp4",
  "Dinosaur (Kling)-optimized.mp4",
];
const VIDEOS = VIDEO_FILES.map(
  (name) => `${VIDEO_BASE}/${encodeURIComponent(name)}`
);

export function AuthLayout({ children }: { children: React.ReactNode }) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [opacity, setOpacity] = useState(1);
  const videoRef = useRef<HTMLVideoElement>(null);
  const advancingRef = useRef(false);

  const advance = useCallback(() => {
    if (advancingRef.current) return;
    advancingRef.current = true;
    // Fade out over 500ms, then swap src, then fade back in.
    // The gradient fallback shows through the brief invisible gap.
    setOpacity(0);
    setTimeout(() => {
      setCurrentIdx((c) => (c + 1) % VIDEOS.length);
    }, 500);
    setTimeout(() => {
      setOpacity(1);
      advancingRef.current = false;
    }, 750);
  }, []);

  // When currentIdx changes, load and play the new video.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.load();
    el.play().catch(() => {});
  }, [currentIdx]);

  return (
    <div className="flex min-h-screen">
      {/* ── Video panel — hidden below lg, sticky so it stays in viewport as form scrolls ── */}
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-gray-900 to-gray-950 lg:sticky lg:top-0 lg:block lg:h-screen lg:w-[62%]">
        <video
          ref={videoRef}
          src={VIDEOS[currentIdx]}
          autoPlay
          muted
          playsInline
          aria-hidden
          onEnded={advance}
          className="absolute inset-0 h-full w-full object-cover"
          style={{ opacity, transition: "opacity 0.5s ease" }}
        />
        {/* Right-edge vignette softens the hard seam into the form panel */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-gray-950/60" />
        {/* Bottom vignette for visual depth */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-gray-950/40 via-transparent to-transparent" />
      </div>

      {/* ── Form panel — full width on mobile, 38% on lg+ ── */}
      <div className="flex w-full flex-col items-center justify-center bg-gray-950 px-6 py-12 lg:w-[38%]">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <Link
              href="/"
              className="font-display text-lg font-black tracking-normal text-white"
            >
              KELOLAKO.
            </Link>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
