"use client";

import { useRef, useState } from "react";
import { useReactFlow, type Node, type NodeProps } from "@xyflow/react";
import { Volume2 } from "lucide-react";
import { uploadRefFile } from "@/components/studio";
import { CANVAS_KIND_LABELS } from "@/lib/canvas-graph";
import { useSignedMediaUrl } from "@/lib/use-signed-media-url";
import CanvasNodeFrame from "./CanvasNodeFrame";
import CanvasAssetActions from "./CanvasAssetActions";
import { useCanvasLibrary } from "../CanvasLibraryPicker";
import type { SoundNodeData } from "../node-data";

export type SoundFlowNode = Node<SoundNodeData, "sound">;

export default function SoundNode({
  id,
  data,
  selected,
}: NodeProps<SoundFlowNode>) {
  const fileRef = useRef<HTMLInputElement>(null);
  const { updateNodeData, deleteElements } = useReactFlow();
  const { openLibrary } = useCanvasLibrary();
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const signedUrl = useSignedMediaUrl(data.resultStoragePath, data.resultUrl);
  const previewUrl = localPreview ?? signedUrl ?? data.resultUrl;

  const patch = (next: Partial<SoundNodeData>) => updateNodeData(id, next);

  const handleUpload = async (file: File) => {
    if (localPreview) URL.revokeObjectURL(localPreview);
    const preview = URL.createObjectURL(file);
    setLocalPreview(preview);
    patch({ uploading: true, error: null });
    try {
      const uploaded = await uploadRefFile(file);
      patch({
        resultUrl: uploaded.url,
        resultStoragePath: uploaded.path,
        creationId: null,
        imported: true,
        uploading: false,
        error: null,
      });
      URL.revokeObjectURL(preview);
      setLocalPreview(null);
    } catch (err) {
      patch({
        uploading: false,
        error: err instanceof Error ? err.message : "Upload failed.",
      });
    }
  };

  return (
    <CanvasNodeFrame
      kind="sound"
      title={data.label.trim() || CANVAS_KIND_LABELS.sound}
      selected={selected}
      onRemove={() => void deleteElements({ nodes: [{ id }] })}
      asset={
        <div className="relative min-h-[120px] overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
          {previewUrl ? (
            <div className="flex min-h-[120px] items-center px-3 py-4">
              <audio
                src={previewUrl}
                controls
                className="nodrag nowheel w-full"
                preload="metadata"
              />
            </div>
          ) : (
            <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 text-text-secondary">
              <Volume2 className="h-7 w-7 text-icon-low-emphasis" />
              <p className="text-xs">Output will appear here…</p>
            </div>
          )}
          {data.uploading && <div className="absolute inset-0 animate-pulse bg-white/10" />}
          {!previewUrl && (
            <CanvasAssetActions
              onLibrary={() =>
                openLibrary({
                  mediaType: "video",
                  title: "Pick from library",
                  onPick: (item) => {
                    if (localPreview) URL.revokeObjectURL(localPreview);
                    setLocalPreview(null);
                    patch({
                      resultUrl: item.mediaUrl,
                      resultStoragePath: item.storagePath || null,
                      creationId: item.id,
                      imported: true,
                      error: null,
                      uploading: false,
                    });
                  },
                })
              }
              onUpload={() => fileRef.current?.click()}
            />
          )}
          <input
            ref={fileRef}
            type="file"
            accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/aac,audio/ogg,audio/webm,audio/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void handleUpload(file);
            }}
          />
          {data.error && (
            <p className="nodrag absolute bottom-2 left-2 right-2 truncate text-[11px] text-error">
              {data.error}
            </p>
          )}
        </div>
      }
    />
  );
}
