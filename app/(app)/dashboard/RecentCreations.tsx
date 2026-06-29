"use client";

import CreationsHistory from "@/components/CreationsHistory";

export default function RecentCreations() {
  return (
    <section className="mb-10">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">
        Recent creations
      </h2>
      <CreationsHistory
        hideHeader
        showActions
        showRefresh={false}
        limit={12}
        className="!mt-0 !border-t-0 !pt-0"
        gridClassName="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3"
      />
    </section>
  );
}
