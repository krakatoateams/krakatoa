"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { History, ImageIcon, Loader2, Video } from "lucide-react";
import { CreationHistoryItem, CreationTool } from "@/lib/creations";

type Props = {
  title?: string;
  description?: string;
  tools?: CreationTool[];
  mediaType?: "image" | "video";
  limit?: number;
  onSelect?: (item: CreationHistoryItem) => void;
  selectedUrl?: string | null;
  className?: string;
  /** Increment to refetch after a new generation completes */
  refreshKey?: number;
};

export default function CreationsHistory({
  title = "Your generations",
  description = "Every successful generation appears here.",
  tools,
  mediaType,
  limit = 100,
  onSelect,
  selectedUrl,
  className = "",
  refreshKey = 0,
}: Props) {
  const [items, setItems] = useState<CreationHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (tools?.length) params.set("tool", tools.join(","));
    if (mediaType) params.set("mediaType", mediaType);
    params.set("limit", String(limit));

    try {
      const res = await fetch(`/api/creations/history?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load history");
      setItems(data.items || []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to load history";
      setError(message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [tools, mediaType, limit]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <section className={`mt-16 pt-12 border-t border-white/10 ${className}`}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <History className="w-6 h-6 text-indigo-400" />
            {title}
          </h2>
          <p className="text-sm text-gray-500 mt-1">{description}</p>
        </div>
        <button
          type="button"
          onClick={() => load()}
          disabled={loading}
          className="text-sm px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-gray-300 hover:text-white hover:border-white/20 transition-colors disabled:opacity-50 shrink-0"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <p className="text-sm text-amber-400/90 mb-6">
          {error} Run <code className="text-amber-200/80">npm run db:setup</code> or apply{" "}
          <code className="text-amber-200/80">002_user_creations.sql</code> in Supabase.
        </p>
      )}

      {loading && items.length === 0 ? (
        <div className="flex items-center justify-center py-20 text-gray-500">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.02] py-20 text-center">
          {mediaType === "video" ? (
            <Video className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          ) : (
            <ImageIcon className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          )}
          <p className="text-gray-400">No generations yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect?.(item)}
              className={`text-left rounded-2xl overflow-hidden border transition-all hover:scale-[1.02] ${
                selectedUrl === item.mediaUrl
                  ? "border-indigo-400/60 ring-2 ring-indigo-400/30"
                  : "border-white/10 hover:border-white/25"
              }`}
            >
              <div
                className={`relative w-full bg-black/40 ${
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
                  <Image
                    src={item.mediaUrl}
                    alt={item.title}
                    fill
                    className="object-cover"
                    unoptimized
                  />
                )}
              </div>
              <div className="p-3 bg-white/[0.04]">
                <p className="text-xs font-medium text-white truncate">
                  {item.title || item.toolLabel}
                </p>
                <p className="text-[10px] text-gray-500 mt-0.5">{item.toolLabel}</p>
                <p className="text-[10px] text-gray-500 mt-1">
                  {new Date(item.createdAt).toLocaleString()}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
