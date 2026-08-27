"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

export function youtubeEmbedSrc(videoId: string): string {
  const params = new URLSearchParams({
    autoplay: "1",
    rel: "0",
    modestbranding: "1",
    playsinline: "1",
  });
  return `https://www.youtube.com/embed/${videoId}?${params}`;
}

export function YouTubeEmbedOverlay({
  open,
  videoId,
  title = "Video",
  onClose,
}: {
  open: boolean;
  videoId: string;
  title?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-N0/90 p-4 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <button
        type="button"
        className="absolute right-4 top-4 z-[201] rounded-full border border-white/10 bg-white/10 p-2 text-N900 transition-colors hover:bg-white/20 sm:right-6 sm:top-6"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Close video"
      >
        <X className="h-5 w-5 sm:h-6 sm:w-6" />
      </button>

      <div
        className="relative w-full max-w-[min(100%,22rem)] overflow-hidden rounded-2xl border border-white/10 bg-N0 shadow-2xl shadow-N0/60 sm:max-w-[min(100%,26rem)] md:max-w-[min(100%,calc(85vh*9/16),32rem)] lg:max-w-[min(100%,calc(88vh*9/16),36rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="aspect-[9/16] w-full">
          <iframe
            src={youtubeEmbedSrc(videoId)}
            title={title}
            className="h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>
      </div>
    </div>
  );
}
