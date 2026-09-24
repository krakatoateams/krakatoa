"use client";

import { Suspense } from "react";
import { StudioGenerationPreviewProvider } from "@/components/studio";
import EditorWorkspace from "./EditorWorkspace";
import { EditorLibraryProvider } from "./EditorLibraryPicker";

export default function EditorPage() {
  return (
    <StudioGenerationPreviewProvider>
      <EditorLibraryProvider>
        <Suspense fallback={<div className="h-full bg-N50" />}>
          <EditorWorkspace />
        </Suspense>
      </EditorLibraryProvider>
    </StudioGenerationPreviewProvider>
  );
}
