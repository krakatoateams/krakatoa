"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Loader2, ImageIcon, Video } from "lucide-react";
import { CreationHistoryItem } from "@/lib/creations";

export default function RecentCreations() {
  const [items, setItems] = useState<CreationHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/creations/history?limit=12");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load");
        setItems(data.items || []);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <section className="mb-10">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">
        Recent creations
      </h2>
      {loading ? (
        <div className="flex items-center gap-2 text-gray-500 text-sm py-8">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading…
        </div>
      ) : error ? (
        <p className="text-sm text-amber-400/90">{error}</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-500">
          No generations yet. Try{" "}
          <Link
            href="/tools/video?type=reels-creator"
            className="text-indigo-400 hover:underline"
          >
            Reels
          </Link>{" "}
          or{" "}
          <Link href="/tools/photo" className="text-purple-400 hover:underline">
            Product Photo
          </Link>
          .
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {items.map((item) => (
            <Link
              key={item.id}
              href={item.tool === "product_photo" ? "/tools/photo" : "/tools/video"}
              className="rounded-xl overflow-hidden border border-white/10 bg-white/[0.03] hover:border-white/20 transition-colors"
            >
              <div
                className={`relative bg-black/50 ${
                  item.mediaType === "video" ? "aspect-video" : "aspect-[4/5]"
                }`}
              >
                {item.mediaType === "video" ? (
                  <video
                    src={item.mediaUrl}
                    className="w-full h-full object-cover"
                    muted
                    playsInline
                    preload="metadata"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.mediaUrl} alt="" className="w-full h-full object-cover" />
                )}
                <span className="absolute top-1.5 right-1.5 p-1 rounded-md bg-black/60">
                  {item.mediaType === "video" ? (
                    <Video className="w-3 h-3 text-white" />
                  ) : (
                    <ImageIcon className="w-3 h-3 text-white" />
                  )}
                </span>
              </div>
              <div className="p-2">
                <p className="text-[10px] text-gray-400 truncate">{item.toolLabel}</p>
                <p className="text-xs text-white truncate">{item.title || "Untitled"}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
