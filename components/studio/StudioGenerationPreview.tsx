"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { CreationPreviewModal } from "@/components/CreationPreviewModal";
import type { CreationHistoryItem } from "@/lib/creations";
import {
  fetchCreationForPreview,
  previewIdFromGenerateResponse,
} from "@/lib/generation-preview";
import {
  LIBRARY_FAVORITES_KEY,
  loadLibraryFavorites,
} from "@/lib/library-favorites";

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
    (item.title || item.toolLabel || "kelolako")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "kelolako";
  return `${base}-${item.id.slice(0, 8)}.${ext}`;
}

type StudioGenerationPreviewContextValue = {
  openPreview: (id: string) => Promise<void>;
  openPreviewFromResponse: (data: unknown) => Promise<void>;
  closePreview: () => void;
};

const StudioGenerationPreviewContext =
  createContext<StudioGenerationPreviewContextValue | null>(null);

export function useStudioGenerationPreview(): StudioGenerationPreviewContextValue {
  const ctx = useContext(StudioGenerationPreviewContext);
  if (!ctx) {
    throw new Error(
      "useStudioGenerationPreview must be used within StudioGenerationPreviewProvider"
    );
  }
  return ctx;
}

export function StudioGenerationPreviewProvider({
  children,
  onHistoryChange,
}: {
  children: ReactNode;
  onHistoryChange?: () => void;
}) {
  const [previewItem, setPreviewItem] = useState<CreationHistoryItem | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  useEffect(() => {
    setFavorites(loadLibraryFavorites());
  }, []);

  const closePreview = useCallback(() => setPreviewItem(null), []);

  const openPreview = useCallback(async (id: string) => {
    const item = await fetchCreationForPreview(id);
    if (item) setPreviewItem(item);
  }, []);

  const openPreviewFromResponse = useCallback(
    async (data: unknown) => {
      const id = previewIdFromGenerateResponse(data);
      if (!id) return;
      await openPreview(id);
    },
    [openPreview]
  );

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
      window.open(item.mediaUrl, "_blank", "noopener,noreferrer");
    } finally {
      setDownloadingId(null);
    }
  }, []);

  const toggleFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        window.localStorage.setItem(
          LIBRARY_FAVORITES_KEY,
          JSON.stringify(Array.from(next))
        );
      } catch {
        // localStorage may be unavailable
      }
      return next;
    });
  }, []);

  const forgetFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      try {
        window.localStorage.setItem(
          LIBRARY_FAVORITES_KEY,
          JSON.stringify(Array.from(next))
        );
      } catch {
        // localStorage may be unavailable
      }
      return next;
    });
  }, []);

  const applyItemUpdate = useCallback((updated: CreationHistoryItem) => {
    setPreviewItem(updated);
  }, []);

  const trashItem = useCallback(
    async (item: CreationHistoryItem) => {
      setMutatingId(item.id);
      try {
        const res = await fetch(`/api/creations/${item.id}`, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to move to Trash");
        setPreviewItem(null);
        onHistoryChange?.();
      } finally {
        setMutatingId(null);
      }
    },
    [onHistoryChange]
  );

  const restoreItem = useCallback(
    async (item: CreationHistoryItem) => {
      setMutatingId(item.id);
      try {
        const res = await fetch(`/api/creations/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "restore" }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to restore");
        setPreviewItem(null);
        onHistoryChange?.();
      } finally {
        setMutatingId(null);
      }
    },
    [onHistoryChange]
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
      try {
        const res = await fetch(`/api/creations/${item.id}?permanent=1`, {
          method: "DELETE",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to delete");
        forgetFavorite(item.id);
        setPreviewItem(null);
        onHistoryChange?.();
      } finally {
        setMutatingId(null);
      }
    },
    [forgetFavorite, onHistoryChange]
  );

  return (
    <StudioGenerationPreviewContext.Provider
      value={{ openPreview, openPreviewFromResponse, closePreview }}
    >
      {children}
      {previewItem && (
        <CreationPreviewModal
          key={previewItem.id}
          item={previewItem}
          richUI
          isFavorite={favorites.has(previewItem.id)}
          isDownloading={downloadingId === previewItem.id}
          isMutating={mutatingId === previewItem.id}
          onClose={closePreview}
          onToggleFavorite={toggleFavorite}
          onDownload={downloadItem}
          onTrash={trashItem}
          onRestore={restoreItem}
          onDeleteForever={deleteForever}
          onItemUpdated={applyItemUpdate}
        />
      )}
    </StudioGenerationPreviewContext.Provider>
  );
}
