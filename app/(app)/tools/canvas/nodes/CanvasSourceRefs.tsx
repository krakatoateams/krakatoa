"use client";

import Image from "next/image";
import { useReactFlow, useStore } from "@xyflow/react";
import { ImageIcon, Plus, Type, X } from "lucide-react";
import { useSignedMediaUrl } from "@/lib/use-signed-media-url";
import type { CanvasUpstreamImage, CanvasUpstreamPrompt } from "@/lib/canvas-graph";
import { useCanvasActions } from "../canvas-actions";
import { useCanvasLibrary } from "../CanvasLibraryPicker";

function ImageRefTile({
  image,
  onRemove,
}: {
  image: CanvasUpstreamImage;
  onRemove: () => void;
}) {
  const signedUrl = useSignedMediaUrl(image.resultStoragePath, image.resultUrl);
  const previewUrl = signedUrl ?? image.resultUrl;
  return (
    <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-white/5">
      {previewUrl ? (
        previewUrl.startsWith("blob:") ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <Image
            key={previewUrl}
            src={previewUrl}
            alt=""
            fill
            className="object-cover"
            sizes="48px"
          />
        )
      ) : (
        <div className="flex h-full w-full items-center justify-center text-text-secondary">
          <ImageIcon className="h-4 w-4" />
        </div>
      )}
      <button
        type="button"
        aria-label="Remove reference"
        className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-N0/70 text-N900 hover:bg-error/80"
        onClick={onRemove}
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}

function TextRefTile({
  prompt,
  onRemove,
}: {
  prompt: CanvasUpstreamPrompt;
  onRemove: () => void;
}) {
  return (
    <div
      className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/5 text-text-secondary"
      title={prompt.text || "Connected text"}
    >
      <Type className="h-4 w-4" />
      <button
        type="button"
        aria-label="Remove reference"
        className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-N0/70 text-N900 hover:bg-error/80"
        onClick={onRemove}
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}

export default function CanvasSourceRefs({
  targetId,
  images,
  prompts = [],
}: {
  targetId: string;
  images: CanvasUpstreamImage[];
  prompts?: CanvasUpstreamPrompt[];
}) {
  const { deleteElements } = useReactFlow();
  const { pushHistory, attachLibraryRef } = useCanvasActions();
  const { openLibrary } = useCanvasLibrary();
  const edges = useStore((s) => s.edges);

  const disconnect = (sourceId: string) => {
    const edge = edges.find((item) => item.source === sourceId && item.target === targetId);
    if (!edge) return;
    pushHistory();
    void deleteElements({ edges: [{ id: edge.id }] });
  };

  return (
    <div className="mb-2 flex flex-wrap items-start gap-1.5">
      {prompts.map((prompt) => (
        <TextRefTile key={prompt.id} prompt={prompt} onRemove={() => disconnect(prompt.id)} />
      ))}
      {images.map((image) => (
        <ImageRefTile key={image.id} image={image} onRemove={() => disconnect(image.id)} />
      ))}
      <button
        type="button"
        title="Add reference from library"
        aria-label="Add reference from library"
        className="flex h-10 w-10 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg bg-white/5 text-[9px] font-semibold uppercase tracking-wide text-text-secondary transition-colors hover:bg-white/10 hover:text-text-primary"
        onClick={() =>
          openLibrary({
            mediaType: "image",
            onPick: (item) => attachLibraryRef(targetId, item),
          })
        }
      >
        <Plus className="h-3.5 w-3.5" />
        Ref
      </button>
    </div>
  );
}
