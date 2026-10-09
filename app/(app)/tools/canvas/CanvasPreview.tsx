"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { isPngAsset } from "./nodes/CanvasMediaBox";

export type CanvasPreviewMedia = {
  kind: "image" | "video";
  url: string;
  checkerboard?: boolean;
  createdBy?: string;
  onShowInLibrary?: () => void;
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
                className={`relative flex max-h-[88vh] flex-col overflow-hidden rounded-2xl border border-white/10 shadow-2xl ${
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
                    className={`${media.createdBy || media.onShowInLibrary ? "max-h-[calc(88vh-4rem)]" : "max-h-[88vh]"} max-w-[min(92vw,1100px)] bg-black`}
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
                    className={`${media.createdBy || media.onShowInLibrary ? "max-h-[calc(88vh-4rem)]" : "max-h-[88vh]"} max-w-[min(92vw,1100px)] object-contain`}
                  />
                ) : (
                  <PreviewSignedImage
                    url={media.url}
                    capped={Boolean(media.createdBy || media.onShowInLibrary)}
                  />
                )}
                {media.createdBy || media.onShowInLibrary ? (
                  <div className="flex shrink-0 items-center justify-between gap-3 border-t border-white/10 bg-N50 px-4 py-3">
                    {media.createdBy ? (
                      <p className="min-w-0 truncate text-sm text-text-secondary">
                        Created by {media.createdBy}
                      </p>
                    ) : (
                      <span />
                    )}
                    {media.onShowInLibrary ? (
                      <Button
                        variant="tertiary"
                        size="sm"
                        aria-label="Show in library"
                        onClick={() => {
                          const openLibrary = media.onShowInLibrary;
                          close();
                          openLibrary?.();
                        }}
                      >
                        Show in library
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>,
            document.body
          )
        : null}
    </CanvasPreviewContext.Provider>
  );
}

function PreviewSignedImage({ url, capped }: { url: string; capped?: boolean }) {
  const [ratio, setRatio] = useState<number | null>(null);

  useEffect(() => {
    setRatio(null);
  }, [url]);

  const aspect = ratio ?? 1;
  const height = capped ? "(88vh - 4rem)" : "88vh";

  return (
    <div
      className="relative max-h-full"
      style={{
        aspectRatio: String(aspect),
        width: `min(92vw, 1100px, calc(${height} * ${aspect}))`,
        maxHeight: capped ? "calc(88vh - 4rem)" : "88vh",
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
