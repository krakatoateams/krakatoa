"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { Maximize2, Pause, Play } from "lucide-react";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

export function isPngAsset(...values: Array<string | null | undefined>): boolean {
  return values.some((value) => {
    if (!value) return false;
    const path = decodeURIComponent(value.split("?")[0] ?? "").toLowerCase();
    return path.endsWith(".png") || path.endsWith(".apng");
  });
}

export default function CanvasMediaBox({
  kind,
  url,
  empty,
  onOpen,
  overlay,
  checkerboard,
}: {
  kind: "image" | "video";
  url: string | null;
  empty: ReactNode;
  onOpen?: () => void;
  overlay?: ReactNode;
  checkerboard?: boolean;
}) {
  const [ratio, setRatio] = useState<number | null>(null);
  const pngBoard = kind === "image" && (checkerboard || isPngAsset(url));

  useEffect(() => {
    setRatio(null);
  }, [url]);

  const fallback = kind === "video" ? "16 / 9" : "1 / 1";

  return (
    <div
      className={`relative w-full overflow-hidden rounded-xl border border-white/10 ${
        pngBoard ? "kk-canvas-png-board" : "bg-white/[0.03]"
      }`}
      style={{ aspectRatio: ratio ? String(ratio) : fallback }}
    >
      {url ? (
        kind === "video" ? (
          <CanvasVideoThumb url={url} onOpen={onOpen} onRatio={setRatio} />
        ) : url.startsWith("blob:") ? (
          // Local upload preview only — generated media uses next/image below.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt=""
            className="h-full w-full object-contain"
            onLoad={(event) => {
              const image = event.currentTarget;
              if (image.naturalWidth && image.naturalHeight) {
                setRatio(image.naturalWidth / image.naturalHeight);
              }
            }}
          />
        ) : (
          <Image
            key={url}
            src={url}
            alt=""
            fill
            className="object-contain"
            sizes="340px"
            onLoad={(event) => {
              const image = event.currentTarget;
              if (image.naturalWidth && image.naturalHeight) {
                setRatio(image.naturalWidth / image.naturalHeight);
              }
            }}
          />
        )
      ) : (
        empty
      )}
      {url && kind === "image" && onOpen && (
        <>
          <button
            type="button"
            aria-label="Open preview"
            className="nodrag absolute inset-0"
            onClick={onOpen}
          />
          <span className="pointer-events-none absolute left-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-N50/80 text-text-primary">
            <Maximize2 className="h-3.5 w-3.5" />
          </span>
        </>
      )}
      {overlay}
    </div>
  );
}

function CanvasVideoThumb({
  url,
  onOpen,
  onRatio,
}: {
  url: string;
  onOpen?: () => void;
  onRatio: (ratio: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    setPlaying(false);
    setDuration(0);
    setCurrent(0);
  }, [url]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  };

  const seek = (next: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = next;
    setCurrent(next);
  };

  return (
    <>
      <video
        ref={videoRef}
        src={url}
        className="h-full w-full object-contain"
        playsInline
        preload="metadata"
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          if (video.videoWidth && video.videoHeight) {
            onRatio(video.videoWidth / video.videoHeight);
          }
          if (Number.isFinite(video.duration)) setDuration(video.duration);
        }}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      {!playing && (
        <button
          type="button"
          aria-label="Play"
          className="nodrag nowheel absolute left-1/2 top-1/2 z-10 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-N50/80 text-text-primary shadow-lg backdrop-blur-sm hover:bg-N50"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            togglePlay();
          }}
        >
          <Play className="h-5 w-5 translate-x-px fill-current" />
        </button>
      )}
      {onOpen && (
        <button
          type="button"
          aria-label="Open preview"
          className="nodrag absolute left-2 top-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-N50/80 text-text-primary hover:bg-white/10"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      )}
      <div
        className="nodrag nowheel absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/70 to-transparent px-2 pb-2 pt-6"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={playing ? "Pause" : "Play"}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white hover:bg-white/10"
            onClick={togglePlay}
          >
            {playing ? (
              <Pause className="h-3.5 w-3.5 fill-current" />
            ) : (
              <Play className="h-3.5 w-3.5 translate-x-px fill-current" />
            )}
          </button>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.05}
            value={Math.min(current, duration || 0)}
            disabled={!duration}
            aria-label="Seek"
            className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-white/20 accent-white disabled:opacity-40"
            onChange={(event) => seek(Number(event.target.value))}
          />
          <span className="shrink-0 text-[10px] font-medium tabular-nums text-white/80">
            {formatTime(current)}
            {duration ? ` / ${formatTime(duration)}` : ""}
          </span>
        </div>
      </div>
    </>
  );
}
