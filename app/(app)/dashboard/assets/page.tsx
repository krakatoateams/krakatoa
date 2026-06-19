"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import CreationsHistory from "@/components/CreationsHistory";

export default function AssetsPage() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">My Library</h1>
          <p className="mt-1 text-sm text-gray-500">
            Everything you have generated across Krakatoa tools.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRefreshKey((k) => k + 1)}
          className="flex shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-gray-300 transition-colors hover:border-white/20 hover:text-white"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

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
    </div>
  );
}
