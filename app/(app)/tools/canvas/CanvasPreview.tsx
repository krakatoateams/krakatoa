"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { X } from "lucide-react";
import { isPngAsset } from "./nodes/CanvasMediaBox";

export type CanvasPreviewMedia = {
  kind: "image" | "video";
  url: string;
  checkerboard?: boolean;
};

const CanvasPreviewContext = createContext<(media: CanvasPreviewMedia) => void>(() => {});

export function useCanvasPreview() {
  return useContext(CanvasPreviewContext);
}

export function CanvasPreviewProvider({ children }: { children: React.ReactNode }) {
  const [media, setMedia] = useState<CanvasPreviewMedia | null>(null);
  const open = useCallback((next: CanvasPreviewMedia) => setMedia(next), []);
  const close = useCallback(() => setMedia(null), []);

  useEffect(() => {
    if (!media) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [media, close]);

  return (
    <CanvasPreviewContext.Provider value={open}>
      {children}
      {media && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
              onClick={close}
            >
              <button
                type="button"
                aria-label="Close preview"
                className="absolute right-4 top-4 rounded-xl border border-white/10 bg-white/10 p-2 text-text-primary hover:bg-white/20"
                onClick={close}
              >
                <X className="h-4 w-4" />
              </button>
              <div
                className={`relative overflow-hidden rounded-2xl border border-white/10 shadow-2xl ${
                  media.kind === "image" && (media.checkerboard || isPngAsset(media.url))
                    ? "kk-canvas-png-board"
                    : "bg-N50"
                }`}
                onClick={(event) => event.stopPropagation()}
              >
                {media.kind === "video" ? (
                  <video
                    key={media.url}
                    src={media.url}
                    className="max-h-[88vh] max-w-[min(92vw,1100px)] bg-black"
                    controls
                    autoPlay
                    playsInline
                  />
                ) : (
                  <ZoomSurface key={media.url}>
                    {media.url.startsWith("blob:") ? (
                      // Local upload preview only.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={media.url}
                        alt=""
                        draggable={false}
                        className="max-h-[88vh] max-w-[min(92vw,1100px)] object-contain"
                      />
                    ) : (
                      <PreviewSignedImage url={media.url} />
                    )}
                  </ZoomSurface>
                )}
              </div>
            </div>,
            document.body
          )
        : null}
    </CanvasPreviewContext.Provider>
  );
}

const MAX_ZOOM = 8;

/** Wheel/pinch zoom toward the pointer, drag to pan, double-click to reset. Keyed by URL so it resets per image. */
function ZoomSurface({ children }: { children: React.ReactNode }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  // Keep the image covering the frame: translation limited to the scaled overflow.
  const clamp = (s: number, x: number, y: number) => {
    const rect = frameRef.current?.getBoundingClientRect();
    const mx = rect ? ((s - 1) * rect.width) / 2 : 0;
    const my = rect ? ((s - 1) * rect.height) / 2 : 0;
    return { s, x: Math.min(mx, Math.max(-mx, x)), y: Math.min(my, Math.max(-my, y)) };
  };

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      setView((v) => {
        // Trackpad two-finger scroll (horizontal delta) pans while zoomed; everything else zooms.
        if (!event.ctrlKey && v.s > 1 && event.deltaX !== 0) {
          return clamp(v.s, v.x - event.deltaX, v.y - event.deltaY);
        }
        const s = Math.min(MAX_ZOOM, Math.max(1, v.s * Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.002))));
        const px = event.clientX - (rect.left + rect.width / 2);
        const py = event.clientY - (rect.top + rect.height / 2);
        const k = s / v.s;
        return clamp(s, px - (px - v.x) * k, py - (py - v.y) * k);
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div
      ref={frameRef}
      className={`touch-none select-none ${view.s > 1 ? "cursor-grab active:cursor-grabbing" : ""}`}
      onDoubleClick={() => setView({ s: 1, x: 0, y: 0 })}
      onPointerDown={(event) => {
        if (view.s <= 1) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { px: event.clientX, py: event.clientY, x: view.x, y: view.y };
      }}
      onPointerMove={(event) => {
        const d = drag.current;
        if (d) setView(clamp(view.s, d.x + event.clientX - d.px, d.y + event.clientY - d.py));
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    >
      <div style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}>{children}</div>
    </div>
  );
}

function PreviewSignedImage({ url }: { url: string }) {
  const [ratio, setRatio] = useState<number | null>(null);

  useEffect(() => {
    setRatio(null);
  }, [url]);

  const aspect = ratio ?? 1;

  return (
    <div
      className="relative max-h-[88vh]"
      style={{
        aspectRatio: String(aspect),
        width: `min(92vw, 1100px, calc(88vh * ${aspect}))`,
      }}
    >
      <Image
        src={url}
        alt=""
        fill
        className="object-contain"
        sizes="92vw"
        onLoad={(event) => {
          const image = event.currentTarget;
          if (image.naturalWidth && image.naturalHeight) {
            setRatio(image.naturalWidth / image.naturalHeight);
          }
        }}
      />
    </div>
  );
}
