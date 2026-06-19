"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  Download,
  ExternalLink,
  History,
  ImageIcon,
  LayoutGrid,
  Loader2,
  Star,
  User,
  Video,
  X,
  type LucideIcon,
} from "lucide-react";
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
  /** Show the All / Videos / Photos / Favorites tab bar and per-card favorite toggle */
  enableTabs?: boolean;
  /** When false, only the created date is shown on each card (no title / tool label) */
  showMeta?: boolean;
};

type LibraryTab = "all" | "video" | "image" | "character" | "favorite";

const FAVORITES_KEY = "krakatoa:library:favorites";

/** A creation tagged as a Character creation (turnaround sheet) in the omni-form. */
function isCharacterItem(item: CreationHistoryItem): boolean {
  return item.metadata?.creationKind === "character";
}

/** Display name for a character creation (its given name, falling back to title). */
function characterDisplayName(item: CreationHistoryItem): string {
  const name = item.metadata?.characterName;
  if (typeof name === "string" && name.trim()) return name.trim();
  return item.title || "Character";
}

function loadFavorites(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(FAVORITES_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(parsed) ? (parsed as string[]) : []);
  } catch {
    return new Set();
  }
}

function downloadFilename(item: CreationHistoryItem, mimeType?: string): string {
  const ext =
    item.mediaType === "video"
      ? "mp4"
      : mimeType?.includes("png")
        ? "png"
        : mimeType?.includes("webp")
          ? "webp"
          : "jpg";
  const base =
    (item.title || item.toolLabel || "krakatoa")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "krakatoa";
  return `${base}-${item.id.slice(0, 8)}.${ext}`;
}

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
  enableTabs = false,
  showMeta = true,
}: Props) {
  const [items, setItems] = useState<CreationHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<LibraryTab>("all");
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [previewItem, setPreviewItem] = useState<CreationHistoryItem | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const downloadItem = useCallback(async (item: CreationHistoryItem) => {
    setDownloadingId(item.id);
    try {
      const res = await fetch(item.mediaUrl);
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = downloadFilename(item, blob.type);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // Fallback: open in a new tab so the user can save manually
      window.open(item.mediaUrl, "_blank", "noopener,noreferrer");
    } finally {
      setDownloadingId(null);
    }
  }, []);

  useEffect(() => {
    if (!previewItem) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreviewItem(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewItem]);

  // Seed the rename field whenever a new item opens in the preview.
  useEffect(() => {
    if (previewItem) {
      setNameDraft(characterDisplayName(previewItem));
      setNameError(null);
    }
  }, [previewItem]);

  const saveCharacterName = useCallback(async () => {
    if (!previewItem) return;
    const name = nameDraft.trim();
    if (!name) {
      setNameError("Enter a name.");
      return;
    }
    setSavingName(true);
    setNameError(null);
    try {
      const res = await fetch(`/api/creations/${previewItem.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save name");
      const updated = data.item as CreationHistoryItem;
      setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
      setPreviewItem(updated);
    } catch (err: unknown) {
      setNameError(err instanceof Error ? err.message : "Failed to save name");
    } finally {
      setSavingName(false);
    }
  }, [previewItem, nameDraft]);

  useEffect(() => {
    if (enableTabs) setFavorites(loadFavorites());
  }, [enableTabs]);

  const toggleFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        window.localStorage.setItem(
          FAVORITES_KEY,
          JSON.stringify(Array.from(next))
        );
      } catch {
        // localStorage may be unavailable (private mode); favorites stay in-memory
      }
      return next;
    });
  }, []);

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

  const counts = useMemo(
    () => ({
      all: items.length,
      video: items.filter((i) => i.mediaType === "video").length,
      image: items.filter((i) => i.mediaType === "image").length,
      character: items.filter(isCharacterItem).length,
      favorite: items.filter((i) => favorites.has(i.id)).length,
    }),
    [items, favorites]
  );

  const visibleItems = useMemo(() => {
    if (!enableTabs || activeTab === "all") return items;
    if (activeTab === "favorite") return items.filter((i) => favorites.has(i.id));
    if (activeTab === "character") return items.filter(isCharacterItem);
    return items.filter((i) => i.mediaType === activeTab);
  }, [items, enableTabs, activeTab, favorites]);

  const TABS: { id: LibraryTab; label: string; icon: LucideIcon }[] = [
    { id: "all", label: "All", icon: LayoutGrid },
    { id: "video", label: "Videos", icon: Video },
    { id: "image", label: "Photos", icon: ImageIcon },
    { id: "character", label: "Characters", icon: User },
    { id: "favorite", label: "Favorites", icon: Star },
  ];

  const previewMeta = previewItem?.metadata ?? {};
  const previewPrompt =
    typeof previewMeta.prompt === "string" ? previewMeta.prompt.trim() : "";
  const previewScenePrompts = Array.isArray(previewMeta.scenePrompts)
    ? (previewMeta.scenePrompts as unknown[]).filter(
        (s): s is string => typeof s === "string" && s.trim().length > 0
      )
    : [];
  const previewNarration =
    typeof previewMeta.narration === "string" ? previewMeta.narration.trim() : "";
  const hasPreviewDetails =
    !!previewPrompt || previewScenePrompts.length > 0 || !!previewNarration;

  const refreshButton = (
    <button
      type="button"
      onClick={() => load()}
      disabled={loading}
      className="text-sm px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-gray-300 hover:text-white hover:border-white/20 transition-colors disabled:opacity-50 shrink-0"
    >
      {loading ? "Refreshing…" : "Refresh"}
    </button>
  );

  return (
    <section className={`mt-16 pt-12 border-t border-white/10 ${className}`}>
      {!enableTabs && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <History className="w-6 h-6 text-indigo-400" />
              {title}
            </h2>
            <p className="text-sm text-gray-500 mt-1">{description}</p>
          </div>
          {refreshButton}
        </div>
      )}

      {enableTabs && (
        <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
          <div className="flex flex-wrap items-center gap-2">
            {TABS.map((tab) => {
              const active = activeTab === tab.id;
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 text-sm px-3.5 py-1.5 rounded-full border transition-colors ${
                    active
                      ? "bg-violet-500/15 border-violet-400/40 text-violet-200"
                      : "bg-white/[0.03] border-white/10 text-gray-400 hover:text-white hover:border-white/25"
                  }`}
                >
                  <Icon
                    className="h-3.5 w-3.5"
                    fill={
                      tab.id === "favorite" && active ? "currentColor" : "none"
                    }
                  />
                  {tab.label}
                  <span className={active ? "text-violet-300/70" : "text-gray-600"}>
                    ({counts[tab.id]})
                  </span>
                </button>
              );
            })}
          </div>
          {refreshButton}
        </div>
      )}

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
      ) : visibleItems.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.02] py-20 text-center">
          {enableTabs && activeTab === "favorite" ? (
            <>
              <Star className="w-12 h-12 text-gray-600 mx-auto mb-4" />
              <p className="text-gray-400">No favorites yet.</p>
            </>
          ) : (
            <>
              {mediaType === "video" || activeTab === "video" ? (
                <Video className="w-12 h-12 text-gray-600 mx-auto mb-4" />
              ) : (
                <ImageIcon className="w-12 h-12 text-gray-600 mx-auto mb-4" />
              )}
              <p className="text-gray-400">No generations yet.</p>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {visibleItems.map((item) => {
            const selectable = !!onSelect && !enableTabs;
            const isFavorite = favorites.has(item.id);
            const cardClass = `group relative text-left rounded-2xl overflow-hidden border transition-all hover:scale-[1.02] ${
              selectedUrl === item.mediaUrl
                ? "border-indigo-400/60 ring-2 ring-indigo-400/30"
                : "border-white/10 hover:border-white/25"
            }`;

            const media = (
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
                {isCharacterItem(item) && (
                  <span className="absolute left-2 top-2 z-10 inline-flex items-center gap-1 rounded-full bg-purple-500/80 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
                    <User className="h-3 w-3" />
                    Character
                  </span>
                )}
              </div>
            );

            const footer = (
              <div className="p-3 bg-white/[0.04]">
                {showMeta ? (
                  <>
                    <p className="text-xs font-medium text-white truncate">
                      {item.title || item.toolLabel}
                    </p>
                    <p className="text-[10px] text-gray-500 mt-0.5">{item.toolLabel}</p>
                  </>
                ) : (
                  isCharacterItem(item) && (
                    <p className="text-xs font-medium text-white truncate">
                      {characterDisplayName(item)}
                    </p>
                  )
                )}
                <p className="text-[10px] text-gray-500 mt-1">
                  {new Date(item.createdAt).toLocaleDateString()}
                </p>
              </div>
            );

            const isDownloading = downloadingId === item.id;
            const actionsOverlay = enableTabs ? (
              <div className="absolute right-2 top-2 z-10 flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void downloadItem(item);
                  }}
                  disabled={isDownloading}
                  aria-label="Download"
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white/70 opacity-0 backdrop-blur-sm transition-colors hover:text-white group-hover:opacity-100 disabled:opacity-100"
                >
                  {isDownloading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFavorite(item.id);
                  }}
                  aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
                  aria-pressed={isFavorite}
                  className={`flex h-8 w-8 items-center justify-center rounded-full backdrop-blur-sm transition-colors ${
                    isFavorite
                      ? "bg-amber-400/20 text-amber-300"
                      : "bg-black/40 text-white/70 opacity-0 group-hover:opacity-100 hover:text-white"
                  }`}
                >
                  <Star
                    className="h-4 w-4"
                    fill={isFavorite ? "currentColor" : "none"}
                  />
                </button>
              </div>
            ) : null;

            if (selectable) {
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelect?.(item)}
                  className={cardClass}
                >
                  {media}
                  {footer}
                </button>
              );
            }

            return (
              <div key={item.id} className={cardClass}>
                {actionsOverlay}
                <button
                  type="button"
                  onClick={() => setPreviewItem(item)}
                  className="block w-full cursor-pointer text-left"
                  aria-label={`Preview ${item.title || item.toolLabel}`}
                >
                  {media}
                </button>
                {footer}
              </div>
            );
          })}
        </div>
      )}

      {previewItem && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Asset preview"
          onClick={() => setPreviewItem(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-gray-950"
          >
            <button
              type="button"
              onClick={() => setPreviewItem(null)}
              aria-label="Close preview"
              className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/70 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="flex items-center justify-center bg-black">
                {previewItem.mediaType === "video" ? (
                  <video
                    src={previewItem.mediaUrl}
                    className="max-h-[70vh] w-full object-contain"
                    controls
                    autoPlay
                    playsInline
                  />
                ) : (
                  <Image
                    src={previewItem.mediaUrl}
                    alt={previewItem.title || previewItem.toolLabel}
                    width={1080}
                    height={1350}
                    unoptimized
                    className="max-h-[70vh] w-auto object-contain"
                  />
                )}
              </div>

              {enableTabs && isCharacterItem(previewItem) && (
                <div className="border-b border-white/10 px-4 py-4">
                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                    Character name
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      maxLength={80}
                      placeholder="Name this character"
                      className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-purple-400/40 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={saveCharacterName}
                      disabled={savingName}
                      className="flex h-9 items-center gap-1.5 rounded-xl bg-purple-500/20 px-4 text-sm font-medium text-purple-200 transition-colors hover:bg-purple-500/30 disabled:opacity-50"
                    >
                      {savingName ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                    </button>
                  </div>
                  {nameError && <p className="mt-1.5 text-xs text-red-400">{nameError}</p>}
                </div>
              )}

              {hasPreviewDetails && (
                <div className="space-y-4 px-4 py-4">
                  {previewPrompt && (
                    <div>
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                        Prompt
                      </p>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-300">
                        {previewPrompt}
                      </p>
                    </div>
                  )}

                  {previewScenePrompts.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                        Scene prompts
                      </p>
                      <ol className="space-y-1.5">
                        {previewScenePrompts.map((scenePrompt, i) => (
                          <li
                            key={i}
                            className="flex gap-2 text-sm leading-relaxed text-gray-300"
                          >
                            <span className="shrink-0 text-gray-600 tabular-nums">
                              {String(i + 1).padStart(2, "0")}
                            </span>
                            <span className="whitespace-pre-wrap">{scenePrompt}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}

                  {previewNarration && (
                    <div>
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                        Narration
                      </p>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-300">
                        {previewNarration}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-4 border-t border-white/10 px-4 py-3">
              <p className="text-xs text-gray-400">
                {new Date(previewItem.createdAt).toLocaleDateString()}
              </p>
              <div className="flex items-center gap-2">
                {enableTabs && (
                  <button
                    type="button"
                    onClick={() => toggleFavorite(previewItem.id)}
                    aria-pressed={favorites.has(previewItem.id)}
                    className={`flex h-8 items-center gap-1.5 rounded-full px-3 text-xs transition-colors ${
                      favorites.has(previewItem.id)
                        ? "bg-amber-400/20 text-amber-300"
                        : "bg-white/5 text-gray-300 hover:text-white"
                    }`}
                  >
                    <Star
                      className="h-3.5 w-3.5"
                      fill={favorites.has(previewItem.id) ? "currentColor" : "none"}
                    />
                    {favorites.has(previewItem.id) ? "Favorited" : "Favorite"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => downloadItem(previewItem)}
                  disabled={downloadingId === previewItem.id}
                  className="flex h-8 items-center gap-1.5 rounded-full bg-white/5 px-3 text-xs text-gray-300 transition-colors hover:text-white disabled:opacity-60"
                >
                  {downloadingId === previewItem.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  Download
                </button>
                <a
                  href={previewItem.mediaUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-8 items-center gap-1.5 rounded-full bg-white/5 px-3 text-xs text-gray-300 transition-colors hover:text-white"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open original
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
