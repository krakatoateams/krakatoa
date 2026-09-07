"use client";

import { Suspense } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import CanvasWorkspace from "./CanvasWorkspace";
import { CanvasPreviewProvider } from "./CanvasPreview";
import { CanvasLibraryProvider } from "./CanvasLibraryPicker";

export default function CanvasPage() {
  return (
    <ReactFlowProvider>
      <CanvasPreviewProvider>
        <CanvasLibraryProvider>
          <Suspense fallback={<div className="h-full bg-N50" />}>
            <CanvasWorkspace />
          </Suspense>
        </CanvasLibraryProvider>
      </CanvasPreviewProvider>
    </ReactFlowProvider>
  );
}
