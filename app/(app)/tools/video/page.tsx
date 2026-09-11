"use client";

import { Suspense, useCallback, useState } from "react";
import { StudioGenerationPreviewProvider } from "@/components/studio";
import VideoStudioShell from "./VideoStudioShell";

function VideoStudioPage() {
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const onHistoryRefresh = useCallback(() => setHistoryRefreshKey((k) => k + 1), []);

  return (
    <StudioGenerationPreviewProvider onHistoryChange={onHistoryRefresh}>
      <VideoStudioShell historyRefreshKey={historyRefreshKey} onHistoryRefresh={onHistoryRefresh} />
    </StudioGenerationPreviewProvider>
  );
}

export default function VideoOmniPageWrapper() {
  return (
    <Suspense fallback={null}>
      <VideoStudioPage />
    </Suspense>
  );
}
