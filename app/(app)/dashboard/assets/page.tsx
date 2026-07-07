"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import CreationsHistory from "@/components/CreationsHistory";
import PageContainer from "../PageContainer";
import PageHeader from "../PageHeader";

export default function AssetsPage() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <PageContainer>
      <PageHeader
        title="My Library"
        actions={
          <button
            type="button"
            onClick={() => setRefreshKey((k) => k + 1)}
            className="flex shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-gray-300 transition-colors hover:border-white/20 hover:text-white"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        }
      />

      <CreationsHistory
        title="Your generations"
        description="Every successful generation appears here."
        className="!mt-0 !border-t-0 !pt-0"
        enableTabs
        showMeta={false}
        showRefresh={false}
        limit={20}
        refreshKey={refreshKey}
      />
    </PageContainer>
  );
}
