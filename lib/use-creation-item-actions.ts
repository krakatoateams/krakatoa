"use client";

import { useCallback, useEffect, useState } from "react";
import type { CreationHistoryItem } from "@/lib/creations";
import {
  LIBRARY_FAVORITES_KEY,
  loadLibraryFavorites,
} from "@/lib/library-favorites";

export const PERMANENT_DELETE_CONFIRM =
  "Permanently delete this asset? This can't be undone.";

export function creationItemDownloadFilename(
  item: CreationHistoryItem,
  mimeType?: string
): string {
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

function persistFavorites(next: Set<string>): void {
  try {
    window.localStorage.setItem(
      LIBRARY_FAVORITES_KEY,
      JSON.stringify(Array.from(next))
    );
  } catch {
    // localStorage may be unavailable (private mode); favorites stay in-memory
  }
}

export type UseCreationItemActionsOptions = {
  /** Load/sync favorites from localStorage when true (default true). */
  favoritesEnabled?: boolean;
  /** Called at the start of trash/restore/permanent delete (e.g. clear error banner). */
  onBeforeMutation?: () => void;
  /** Called after trash/restore/permanent delete succeeds. */
  onLibraryChanged?: () => void | Promise<void>;
  /** Called when trash/restore/permanent delete fails. */
  onError?: (message: string) => void;
};

export function useCreationItemActions(
  options: UseCreationItemActionsOptions = {}
) {
  const {
    favoritesEnabled = true,
    onBeforeMutation,
    onLibraryChanged,
    onError,
  } = options;

  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [mutatingId, setMutatingId] = useState<string | null>(null);

  useEffect(() => {
    if (favoritesEnabled) setFavorites(loadLibraryFavorites());
  }, [favoritesEnabled]);

  const downloadItem = useCallback(async (item: CreationHistoryItem) => {
    setDownloadingId(item.id);
    try {
      const res = await fetch(item.mediaUrl);
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = creationItemDownloadFilename(item, blob.type);
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
      persistFavorites(next);
      return next;
    });
  }, []);

  const forgetFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      persistFavorites(next);
      return next;
    });
  }, []);

  const runMutation = useCallback(
    async (
      item: CreationHistoryItem,
      request: () => Promise<Response>,
      fallbackError: string
    ) => {
      setMutatingId(item.id);
      onBeforeMutation?.();
      try {
        const res = await request();
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            (data as { error?: string }).error || fallbackError
          );
        }
        await onLibraryChanged?.();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : fallbackError;
        if (onError) onError(message);
        else throw err;
      } finally {
        setMutatingId(null);
      }
    },
    [onBeforeMutation, onLibraryChanged, onError]
  );

  const trashItem = useCallback(
    (item: CreationHistoryItem) =>
      runMutation(
        item,
        () => fetch(`/api/creations/${item.id}`, { method: "DELETE" }),
        "Failed to move to Trash"
      ),
    [runMutation]
  );

  const restoreItem = useCallback(
    (item: CreationHistoryItem) =>
      runMutation(
        item,
        () =>
          fetch(`/api/creations/${item.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "restore" }),
          }),
        "Failed to restore"
      ),
    [runMutation]
  );

  const deleteForever = useCallback(
    async (item: CreationHistoryItem) => {
      if (!window.confirm(PERMANENT_DELETE_CONFIRM)) return;
      setMutatingId(item.id);
      onBeforeMutation?.();
      try {
        const res = await fetch(`/api/creations/${item.id}?permanent=1`, {
          method: "DELETE",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            (data as { error?: string }).error || "Failed to delete"
          );
        }
        forgetFavorite(item.id);
        await onLibraryChanged?.();
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to delete";
        if (onError) onError(message);
        else throw err;
      } finally {
        setMutatingId(null);
      }
    },
    [forgetFavorite, onBeforeMutation, onLibraryChanged, onError]
  );

  return {
    favorites,
    downloadingId,
    mutatingId,
    toggleFavorite,
    forgetFavorite,
    downloadItem,
    trashItem,
    restoreItem,
    deleteForever,
  };
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`use-creation-item-actions self-check: ${message}`);
  }
}

/** ponytail: runnable without React — `npx tsx lib/use-creation-item-actions.ts`. */
export function creationItemActionsSelfCheck(): void {
  const videoItem = {
    id: "abc12345-0000-0000-0000-000000000000",
    mediaType: "video" as const,
    title: "My Reel!",
    toolLabel: "Reels",
  };
  assert(
    creationItemDownloadFilename(videoItem as CreationHistoryItem) ===
      "my-reel-abc12345.mp4",
    "video uses mp4 extension"
  );

  const pngItem = {
    id: "def67890-0000-0000-0000-000000000000",
    mediaType: "image" as const,
    toolLabel: "Product Photo",
  };
  assert(
    creationItemDownloadFilename(
      pngItem as CreationHistoryItem,
      "image/png"
    ) === "product-photo-def67890.png",
    "png mime maps to png extension"
  );

  assert(
    creationItemDownloadFilename(
      { ...pngItem, title: "" } as CreationHistoryItem,
      "image/webp"
    ) === "product-photo-def67890.webp",
    "webp mime maps to webp extension"
  );

  assert(
    creationItemDownloadFilename(
      { ...pngItem, title: "" } as CreationHistoryItem,
      "image/jpeg"
    ) === "product-photo-def67890.jpg",
    "default image mime maps to jpg extension"
  );

  assert(
    creationItemDownloadFilename({
      id: "xyz00000-0000-0000-0000-000000000000",
      mediaType: "image",
      title: "!!!",
      toolLabel: "",
    } as CreationHistoryItem) === "kelolako-xyz00000.jpg",
    "empty slug falls back to kelolako"
  );

  assert(
    PERMANENT_DELETE_CONFIRM ===
      "Permanently delete this asset? This can't be undone.",
    "permanent delete copy unchanged"
  );
}

const isDirectRun =
  typeof process !== "undefined" &&
  !!process.argv[1]?.endsWith("use-creation-item-actions.ts");

if (isDirectRun) {
  creationItemActionsSelfCheck();
  console.log("use-creation-item-actions self-check passed");
}
