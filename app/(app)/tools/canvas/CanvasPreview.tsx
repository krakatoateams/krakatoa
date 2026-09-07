"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
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
                ) : media.url.startsWith("blob:") ? (
                  // Local upload preview only.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={media.url}
                    alt=""
                    className="max-h-[88vh] max-w-[min(92vw,1100px)] object-contain"
                  />
                ) : (
                  <PreviewSignedImage url={media.url} />
                )}
              </div>
            </div>,
            document.body
          )
        : null}
    </CanvasPreviewContext.Provider>
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
