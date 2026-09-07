"use client";

import { FolderOpen, Upload } from "lucide-react";

export default function CanvasAssetActions({
  onLibrary,
  onUpload,
}: {
  onLibrary: () => void;
  onUpload: () => void;
}) {
  return (
    <div className="nodrag absolute bottom-2 right-2 z-10 flex items-center gap-1">
      <button
        type="button"
        onClick={onLibrary}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-N50/90 px-2 text-[11px] font-medium text-text-primary backdrop-blur-sm hover:bg-white/10"
      >
        <FolderOpen className="h-3 w-3" />
        Library
      </button>
      <button
        type="button"
        onClick={onUpload}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-N50/90 px-2 text-[11px] font-medium text-text-primary backdrop-blur-sm hover:bg-white/10"
      >
        <Upload className="h-3 w-3" />
        Upload
      </button>
    </div>
  );
}
