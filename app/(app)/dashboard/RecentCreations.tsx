"use client";

import CreationsHistory from "@/components/CreationsHistory";

export default function RecentCreations() {
  return (
    <section className="mb-10">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">
        Recent creations
      </h2>
      <CreationsHistory
        title="Your generations"
        description="Every successful generation appears here."
        className="!mt-0 !border-t-0 !pt-0"
        enableTabs
        showTrashTab={false}
        showMeta={false}
        showRefresh={false}
        limit={10}
      />
    </section>
  );
}
