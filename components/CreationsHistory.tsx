"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  History,
  ImageIcon,
  Layers,
  LayoutGrid,
  Loader2,
  RotateCcw,
  Star,
  Trash2,
  User,
  Video,
  X,
  type LucideIcon,
} from "lucide-react";
import { CreationHistoryItem, CreationTool } from "@/lib/creations";
import { getCreationModelLabel } from "@/lib/creation-model-label";

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
  /** When false, the Trash tab (and its empty-trash controls) is hidden. Defaults to true. */
  showTrashTab?: boolean;
  /** Enable library-style hover actions + rich preview modal (favorite, download, delete, prev/next) WITHOUT the tab bar. */
  showActions?: boolean;
  /** When false, only the created date is shown on each card (no title / tool label) */
  showMeta?: boolean;
  /** When false, the built-in Refresh button is hidden (parent provides its own). */
  showRefresh?: boolean;
  /** Skip the title/description header row (parent supplies its own section label). */
  hideHeader?: boolean;
  /** Override the asset grid layout classes (defaults to 5 columns on lg). */
  gridClassName?: string;
};

/** Windowed page numbers with ellipses, e.g. [1, "…", 4, 5, 6, "…", 12]. */
function pageWindow(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set<number>([1, total, current, current - 1, current + 1]);
  const sorted = Array.from(pages)
    .filter((p) => p >= 1 && p <= total)
    .sort((a, b) => a - b);
  const out: (number | "ellipsis")[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) out.push("ellipsis");
    out.push(p);
    prev = p;
  }
  return out;
}

type LibraryTab =
  | "all"
  | "video"
  | "image"
  | "character"
  | "storyboard"
  | "favorite"
  | "trash";

type TabCounts = {
  all: number;
  image: number;
  video: number;
  character: number;
  storyboard: number;
  trash: number;
};

type CachedHistory = {
  items: CreationHistoryItem[];
  total: number;
  counts: TabCounts | null;
};

// Stale-while-revalidate cache for the library/history views, keyed by the full
// request query string (tab + page + filters). Serving a cached snapshot makes
// re-opening a previously loaded chip feel instant; a background refetch still
// runs to keep it fresh. Cleared on any mutation or parent refresh.
// ponytail: unbounded module-level Map — fine for a per-session library where
// (tabs × pages) is small. If it ever caches very large histories, cap it with a
// tiny LRU.
const historyCache = new Map<string, CachedHistory>();

const FAVORITES_KEY = "krakatoa:library:favorites";

/** A creation tagged as a Character creation (turnaround sheet) in the omni-form. */
function isCharacterItem(item: CreationHistoryItem): boolean {
  return item.metadata?.creationKind === "character";
}

/** A creation that has been soft-deleted (lives in Trash until purged). */
function isTrashedItem(item: CreationHistoryItem): boolean {
  const deletedAt = item.metadata?.deletedAt;
  return typeof deletedAt === "string" && deletedAt.trim().length > 0;
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

/** Muted hover preview for library video cards (first frame at rest). */
function HoverPlayVideo({ src, className }: { src: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);

  const play = () => {
    const el = ref.current;
    if (!el) return;
    el.currentTime = 0;
    void el.play().catch(() => {});
  };

  const pause = () => {
    const el = ref.current;
    if (!el) return;
    el.pause();
    el.currentTime = 0;
  };

  return (
    <div
      className="h-full w-full"
      onMouseEnter={play}
      onMouseLeave={pause}
    >
      <video
        ref={ref}
        src={src}
        className={className}
        muted
        playsInline
        loop
        preload="metadata"
      />
    </div>
  );
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
  showTrashTab = true,
  showActions = false,
  showMeta = true,
  showRefresh = true,
  hideHeader = false,
  gridClassName,
}: Props) {
  // Library-grade cards + preview (hover actions, rich preview modal) ride on the
  // tab bar today; `showActions` lets a tab-less surface (e.g. the Photo tool
  // history) opt into the same UI without rendering the chips.
  const richUI = enableTabs || showActions;
  // `limit` doubles as the page size; pages are fetched from the server.
  const pageSize = limit;
  const [items, setItems] = useState<CreationHistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [serverCounts, setServerCounts] = useState<TabCounts | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards for the SWR cache: ignore responses for a chip the user already left,
  // and detect a real parent refresh (vs. the initial mount) to drop stale cache.
  const latestKeyRef = useRef<string>("");
  const prevRefreshKeyRef = useRef(refreshKey);
  const [activeTab, setActiveTab] = useState<LibraryTab>("all");
  const [page, setPage] = useState(1);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [previewItem, setPreviewItem] = useState<CreationHistoryItem | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [emptyingTrash, setEmptyingTrash] = useState(false);
  const [confirmEmptyTrash, setConfirmEmptyTrash] = useState(false);
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

  // Navigate the preview across the currently loaded page of items.
  const previewIndex = previewItem
    ? items.findIndex((i) => i.id === previewItem.id)
    : -1;
  const hasPrevPreview = previewIndex > 0;
  const hasNextPreview = previewIndex >= 0 && previewIndex < items.length - 1;

  const showPrevPreview = useCallback(() => {
    setPreviewItem((cur) => {
      if (!cur) return cur;
      const idx = items.findIndex((i) => i.id === cur.id);
      return idx > 0 ? items[idx - 1] : cur;
    });
  }, [items]);

  const showNextPreview = useCallback(() => {
    setPreviewItem((cur) => {
      if (!cur) return cur;
      const idx = items.findIndex((i) => i.id === cur.id);
      return idx >= 0 && idx < items.length - 1 ? items[idx + 1] : cur;
    });
  }, [items]);

  useEffect(() => {
    if (!previewItem) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreviewItem(null);
      else if (e.key === "ArrowLeft") showPrevPreview();
      else if (e.key === "ArrowRight") showNextPreview();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewItem, showPrevPreview, showNextPreview]);

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
      historyCache.clear();
    } catch (err: unknown) {
      setNameError(err instanceof Error ? err.message : "Failed to save name");
    } finally {
      setSavingName(false);
    }
  }, [previewItem, nameDraft]);

  useEffect(() => {
    if (richUI) setFavorites(loadFavorites());
  }, [richUI]);

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

  // The active tab maps to server-side filters so paging stays correct without
  // loading the whole library. mediaType prop (picker usage) takes precedence.
  const tabMediaType =
    enableTabs && activeTab === "video"
      ? "video"
      : enableTabs && activeTab === "image"
        ? "image"
        : undefined;
  const effectiveMediaType = mediaType ?? tabMediaType;
  const tabKind = enableTabs && activeTab === "character" ? "character" : undefined;
  const isStoryboardTab = enableTabs && activeTab === "storyboard";
  const isFavoriteTab = enableTabs && activeTab === "favorite";
  const isTrashTab = enableTabs && activeTab === "trash";
  // Favorites live in localStorage; serialize the ids so the fetch re-runs when
  // they change while the Favorites tab is open.
  const favoriteIdsKey = isFavoriteTab
    ? Array.from(favorites).sort().join(",")
    : "";
  const toolsKey = tools?.length ? tools.join(",") : "";

  const load = useCallback(async () => {
    setError(null);
    const params = new URLSearchParams();
    if (toolsKey) params.set("tool", toolsKey);
    // The Storyboards tab narrows the listing to storyboards via a separate param
    // so the pill counts (scoped to `tool`) don't shift when the tab is active.
    if (isStoryboardTab) params.set("tabTool", "storyboard");
    if (effectiveMediaType) params.set("mediaType", effectiveMediaType);
    if (tabKind) params.set("kind", tabKind);
    if (isTrashTab) params.set("trashed", "1");
    params.set("limit", String(pageSize));
    params.set("offset", String((page - 1) * pageSize));
    if (enableTabs) params.set("counts", "1");
    if (isFavoriteTab) params.set("ids", favoriteIdsKey);

    const cacheKey = params.toString();
    latestKeyRef.current = cacheKey;

    // Serve a cached snapshot instantly (stale-while-revalidate) so re-opening a
    // chip that was loaded before feels immediate; the fetch below still runs to
    // refresh it. Only show the spinner on a true cache miss.
    const cached = historyCache.get(cacheKey);
    if (cached) {
      setItems(cached.items);
      setTotal(cached.total);
      if (cached.counts) setServerCounts(cached.counts);
      setLoading(false);
    } else {
      setLoading(true);
    }

    try {
      const res = await fetch(`/api/creations/history?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load history");
      const nextItems: CreationHistoryItem[] = data.items || [];
      const nextTotal =
        typeof data.total === "number" ? data.total : nextItems.length;
      const nextCounts: TabCounts | null = data.counts ?? null;
      historyCache.set(cacheKey, {
        items: nextItems,
        total: nextTotal,
        counts: nextCounts,
      });
      // Drop a slow response for a chip the user already switched away from.
      if (latestKeyRef.current !== cacheKey) return;
      setItems(nextItems);
      setTotal(nextTotal);
      if (nextCounts) setServerCounts(nextCounts);
    } catch (err: unknown) {
      if (latestKeyRef.current !== cacheKey) return;
      const message = err instanceof Error ? err.message : "Failed to load history";
      setError(message);
      // Keep any cached items on a background-revalidation failure.
      if (!cached) {
        setItems([]);
        setTotal(0);
      }
    } finally {
      if (latestKeyRef.current === cacheKey) setLoading(false);
    }
  }, [
    toolsKey,
    effectiveMediaType,
    tabKind,
    isStoryboardTab,
    isFavoriteTab,
    isTrashTab,
    favoriteIdsKey,
    enableTabs,
    pageSize,
    page,
  ]);

  // A real parent refresh (new generation, manual Refresh) means the server data
  // changed — drop the SWR cache so the next load refetches instead of serving a
  // stale snapshot. Skips the initial mount so cross-navigation caching survives.
  useEffect(() => {
    if (prevRefreshKeyRef.current === refreshKey) return;
    prevRefreshKeyRef.current = refreshKey;
    historyCache.clear();
  }, [refreshKey]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // Back to page 1 whenever the filter or the underlying data changes.
  useEffect(() => {
    setPage(1);
  }, [activeTab, refreshKey, effectiveMediaType, toolsKey]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Keep the page in range if the total shrinks (e.g. unfavoriting, deletes).
  useEffect(() => {
    setPage((p) => Math.min(p, totalPages));
  }, [totalPages]);

  // Drop an id from the client-side favorites set (used after permanent delete).
  const forgetFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      try {
        window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(next)));
      } catch {
        // localStorage may be unavailable; favorites stay in-memory
      }
      return next;
    });
  }, []);

  const trashItem = useCallback(
    async (item: CreationHistoryItem) => {
      setMutatingId(item.id);
      setError(null);
      try {
        const res = await fetch(`/api/creations/${item.id}`, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to move to Trash");
        setPreviewItem(null);
        historyCache.clear();
        await load();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to move to Trash");
      } finally {
        setMutatingId(null);
      }
    },
    [load]
  );

  const restoreItem = useCallback(
    async (item: CreationHistoryItem) => {
      setMutatingId(item.id);
      setError(null);
      try {
        const res = await fetch(`/api/creations/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "restore" }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to restore");
        setPreviewItem(null);
        historyCache.clear();
        await load();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to restore");
      } finally {
        setMutatingId(null);
      }
    },
    [load]
  );

  const deleteForever = useCallback(
    async (item: CreationHistoryItem) => {
      if (
        !window.confirm(
          "Permanently delete this asset? This can't be undone."
        )
      ) {
        return;
      }
      setMutatingId(item.id);
      setError(null);
      try {
        const res = await fetch(`/api/creations/${item.id}?permanent=1`, {
          method: "DELETE",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to delete");
        forgetFavorite(item.id);
        setPreviewItem(null);
        historyCache.clear();
        await load();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to delete");
      } finally {
        setMutatingId(null);
      }
    },
    [load, forgetFavorite]
  );

  const emptyTrash = useCallback(async () => {
    setEmptyingTrash(true);
    setError(null);
    try {
      const res = await fetch(`/api/creations/trash/empty`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to empty Trash");
      setPreviewItem(null);
      setConfirmEmptyTrash(false);
      historyCache.clear();
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to empty Trash");
    } finally {
      setEmptyingTrash(false);
    }
  }, [load]);

  // Tab pill counts come from the server (favorites are client-side only).
  const counts = {
    all: serverCounts?.all ?? 0,
    video: serverCounts?.video ?? 0,
    image: serverCounts?.image ?? 0,
    character: serverCounts?.character ?? 0,
    storyboard: serverCounts?.storyboard ?? 0,
    favorite: favorites.size,
    trash: serverCounts?.trash ?? 0,
  };

  // Items are already filtered + paged by the server.
  const pagedItems = items;

  const TABS: { id: LibraryTab; label: string; icon: LucideIcon }[] = [
    { id: "all", label: "All", icon: LayoutGrid },
    { id: "video", label: "Videos", icon: Video },
    { id: "image", label: "Photos", icon: ImageIcon },
    { id: "character", label: "Characters", icon: User },
    { id: "storyboard", label: "Storyboards", icon: Layers },
    { id: "favorite", label: "Favorites", icon: Star },
    ...(showTrashTab
      ? [{ id: "trash" as LibraryTab, label: "Trash", icon: Trash2 }]
      : []),
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
  const previewModelLabel = previewItem ? getCreationModelLabel(previewItem) : null;

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
      {!enableTabs && !hideHeader && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <History className="w-6 h-6 text-indigo-400" />
              {title}
            </h2>
            <p className="text-sm text-gray-500 mt-1">{description}</p>
          </div>
          {showRefresh && refreshButton}
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
          {showRefresh && refreshButton}
        </div>
      )}

      {error && (
        <p className="text-sm text-amber-400/90 mb-6">
          {error} Run <code className="text-amber-200/80">npm run db:setup</code> or apply{" "}
          <code className="text-amber-200/80">002_user_creations.sql</code> in Supabase.
        </p>
      )}

      {loading ? (
        // `loading` is only true on a cache miss (a cached chip serves instantly
        // and revalidates silently), so this spinner marks a real fresh load —
        // including switching to a chip that hasn't been opened yet.
        <div className="flex items-center justify-center py-20 text-gray-500">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      ) : pagedItems.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.02] py-20 text-center">
          {enableTabs && activeTab === "favorite" ? (
            <>
              <Star className="w-12 h-12 text-gray-600 mx-auto mb-4" />
              <p className="text-gray-400">No favorites yet.</p>
            </>
          ) : enableTabs && activeTab === "trash" ? (
            <>
              <Trash2 className="w-12 h-12 text-gray-600 mx-auto mb-4" />
              <p className="text-gray-400">Trash is empty.</p>
            </>
          ) : enableTabs && activeTab === "storyboard" ? (
            <>
              <Layers className="w-12 h-12 text-gray-600 mx-auto mb-4" />
              <p className="text-gray-400">No storyboards yet.</p>
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
        <>
        <div
          className={
            gridClassName ??
            "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4"
          }
        >
          {pagedItems.map((item) => {
            const selectable = !!onSelect && !richUI;
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
                  <HoverPlayVideo
                    src={item.mediaUrl}
                    className="w-full h-full object-cover"
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
                <p className="text-xs text-white mt-1">
                  {new Date(item.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              </div>
            );

            const isDownloading = downloadingId === item.id;
            const actionsOverlay = richUI ? (
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
                {!isTrashedItem(item) && (
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
                )}
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

        {totalPages > 1 && (
          <div className="mt-8 flex flex-col items-center justify-between gap-3 sm:flex-row">
            <p className="text-xs text-gray-500">
              {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
            </p>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                aria-label="Previous page"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-gray-300 transition-colors hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              {pageWindow(page, totalPages).map((p, i) =>
                p === "ellipsis" ? (
                  <span key={`e${i}`} className="px-1 text-sm text-gray-600">
                    …
                  </span>
                ) : (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPage(p)}
                    aria-current={p === page ? "page" : undefined}
                    className={`h-8 min-w-8 rounded-lg border px-2 text-sm transition-colors ${
                      p === page
                        ? "border-violet-400/40 bg-violet-500/15 text-violet-200"
                        : "border-white/10 bg-white/[0.03] text-gray-300 hover:border-white/25 hover:text-white"
                    }`}
                  >
                    {p}
                  </button>
                )
              )}
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                aria-label="Next page"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-gray-300 transition-colors hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
        </>
      )}

      {enableTabs && activeTab === "trash" && counts.trash > 0 && (
        <div className="mt-8 flex flex-col items-center gap-3 border-t border-white/10 pt-6">
          <p className="text-xs text-gray-500">
            Items in Trash are kept for 14 days, then deleted automatically.
          </p>
          <button
            type="button"
            onClick={() => setConfirmEmptyTrash(true)}
            disabled={emptyingTrash}
            className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 transition-colors hover:bg-red-500/20 hover:text-red-200 disabled:opacity-50"
          >
            {emptyingTrash ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Empty Trash
          </button>
        </div>
      )}

      {confirmEmptyTrash && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm empty trash"
          onClick={() => !emptyingTrash && setConfirmEmptyTrash(false)}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl border border-white/10 bg-gray-950 p-6"
          >
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/15 text-red-300">
                <Trash2 className="h-5 w-5" />
              </span>
              <h3 className="text-base font-semibold text-white">Empty Trash?</h3>
            </div>
            <p className="mb-6 text-sm text-gray-400">
              This permanently deletes all {counts.trash} item
              {counts.trash === 1 ? "" : "s"} in Trash. This can&apos;t be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmEmptyTrash(false)}
                disabled={emptyingTrash}
                className="flex h-9 items-center rounded-full bg-white/5 px-4 text-sm text-gray-300 transition-colors hover:text-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={emptyTrash}
                disabled={emptyingTrash}
                className="flex h-9 items-center gap-1.5 rounded-full bg-red-500/90 px-4 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-50"
              >
                {emptyingTrash ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Delete permanently
              </button>
            </div>
          </div>
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
              className="absolute right-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/70 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>

            {hasPrevPreview && (
              <button
                type="button"
                onClick={showPrevPreview}
                aria-label="Previous asset"
                className="absolute left-3 top-1/2 z-20 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/70 hover:text-white"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
            {hasNextPreview && (
              <button
                type="button"
                onClick={showNextPreview}
                aria-label="Next asset"
                className="absolute right-3 top-1/2 z-20 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/70 hover:text-white"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            )}

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

              {richUI && isCharacterItem(previewItem) && (
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
                {previewItem &&
                  new Date(previewItem.createdAt).toLocaleDateString()}
                {previewModelLabel ? ` · ${previewModelLabel}` : ""}
              </p>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {richUI && !isTrashedItem(previewItem) && (
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
                {richUI &&
                  (isTrashedItem(previewItem) ? (
                    <>
                      <button
                        type="button"
                        onClick={() => restoreItem(previewItem)}
                        disabled={mutatingId === previewItem.id}
                        className="flex h-8 items-center gap-1.5 rounded-full bg-white/5 px-3 text-xs text-gray-300 transition-colors hover:text-white disabled:opacity-60"
                      >
                        {mutatingId === previewItem.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RotateCcw className="h-3.5 w-3.5" />
                        )}
                        Restore
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteForever(previewItem)}
                        disabled={mutatingId === previewItem.id}
                        className="flex h-8 items-center gap-1.5 rounded-full bg-red-500/15 px-3 text-xs text-red-300 transition-colors hover:bg-red-500/25 hover:text-red-200 disabled:opacity-60"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete permanently
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => trashItem(previewItem)}
                      disabled={mutatingId === previewItem.id}
                      className="flex h-8 items-center gap-1.5 rounded-full bg-red-500/15 px-3 text-xs text-red-300 transition-colors hover:bg-red-500/25 hover:text-red-200 disabled:opacity-60"
                    >
                      {mutatingId === previewItem.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                      Delete
                    </button>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
