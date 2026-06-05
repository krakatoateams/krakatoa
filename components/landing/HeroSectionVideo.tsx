"use client";

import { HeroLayout } from "./HeroSection";

const VIDEO_A =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260418_063509_7d167302-4fd4-480b-8260-18ab572333d4.mp4";

function VideoBackdrop({ src }: { src: string }) {
  return (
    <video
      src={src}
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      aria-hidden
      className="absolute inset-0 z-0 h-full w-full object-cover"
    />
  );
}

export function HeroSectionVideoA() {
  return <HeroLayout tone="light" background={<VideoBackdrop src={VIDEO_A} />} />;
}
