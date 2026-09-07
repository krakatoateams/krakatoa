"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { CreationPreviewModal } from "@/components/CreationPreviewModal";
import type { CreationHistoryItem } from "@/lib/creations";
import {
  fetchCreationForPreview,
  previewIdFromGenerateResponse,
} from "@/lib/generation-preview";
import { useCreationItemActions } from "@/lib/use-creation-item-actions";

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

  const closePreview = useCallback(() => setPreviewItem(null), []);

  const {
    favorites,
    downloadingId,
    mutatingId,
    toggleFavorite,
    downloadItem,
    trashItem,
    restoreItem,
    deleteForever,
  } = useCreationItemActions({
    onLibraryChanged: () => {
      setPreviewItem(null);
      onHistoryChange?.();
    },
  });

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

  const applyItemUpdate = useCallback((updated: CreationHistoryItem) => {
    setPreviewItem(updated);
  }, []);

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
