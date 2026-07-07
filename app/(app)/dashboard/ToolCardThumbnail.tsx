"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import type { CreationHistoryItem } from "@/lib/creations";

/**
 * Shows a small stacked thumbnail of the most recent creation for a given media
 * type in the top-right of a tool card. Renders nothing until a creation loads,
 * so it never leaves a broken placeholder.
 */
export default function ToolCardThumbnail({
  mediaType,
  outlined = false,
}: {
  mediaType: "image" | "video";
  outlined?: boolean;
}) {
  const [item, setItem] = useState<CreationHistoryItem | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/creations/history?mediaType=${mediaType}&limit=1`)
      .then((res) => (res.ok ? res.json() : { items: [] }))
      .then((data) => {
        if (active) setItem(data.items?.[0] ?? null);
      })
      .catch(() => {
        if (active) setItem(null);
      });
    return () => {
      active = false;
    };
  }, [mediaType]);

  if (!item) return null;

  return (
    <div className="pointer-events-none absolute -top-2 right-3 h-20 w-20 translate-x-[-5px] translate-y-[5px]">
      {/* Stacked cards behind for a layered look */}
      <div className="absolute inset-0 translate-x-2 rotate-[-22deg] rounded-lg border border-white/10 bg-white/[0.06] outline outline-2 outline-white" />
      <div className="absolute inset-0 translate-x-1 rotate-[-12deg] rounded-lg border border-white/10 bg-white/[0.08] outline outline-2 outline-white" />
      <div
        className={`relative h-full w-full overflow-hidden rounded-[10px] border border-white/15 bg-black/40 shadow-lg shadow-black/40${
          outlined ? " outline outline-[5px] outline-offset-0 outline-white" : ""
        }`}
      >
        {item.mediaType === "video" ? (
          <video
            src={item.mediaUrl}
            className="h-full w-full object-cover"
            muted
            playsInline
            preload="metadata"
          />
        ) : (
          <Image
            src={item.mediaUrl}
            alt={item.title}
            fill
            className="object-cover"
            unoptimized
          />
        )}
      </div>
    </div>
  );
}
