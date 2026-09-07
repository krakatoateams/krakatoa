"use client";

import { Suspense } from "react";
import EditorWorkspace from "./EditorWorkspace";
import { EditorLibraryProvider } from "./EditorLibraryPicker";

export default function EditorPage() {
  return (
    <EditorLibraryProvider>
      <Suspense fallback={<div className="h-full bg-N50" />}>
        <EditorWorkspace />
      </Suspense>
    </EditorLibraryProvider>
  );
}
