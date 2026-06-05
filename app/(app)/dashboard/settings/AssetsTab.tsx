"use client";

import CreationsHistory from "@/components/CreationsHistory";

export default function AssetsTab() {
  return (
    <div className="space-y-2">
      <header>
        <h2 className="text-lg font-semibold text-white">Assets</h2>
        <p className="mt-1 text-sm text-gray-500">
          Everything you have generated across Krakatoa tools.
        </p>
      </header>

      <CreationsHistory
        title="Your generations"
        description="Every successful generation appears here."
        className="!mt-6 !border-t-0 !pt-0"
      />
    </div>
  );
}
