"use client";

import CreationsHistory from "@/components/CreationsHistory";

export default function AssetsPage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">My Library</h1>
        <p className="mt-1 text-sm text-gray-500">
          Everything you have generated across Krakatoa tools.
        </p>
      </div>

      <CreationsHistory
        title="Your generations"
        description="Every successful generation appears here."
        className="!mt-0 !border-t-0 !pt-0"
        enableTabs
        showMeta={false}
      />
    </div>
  );
}
