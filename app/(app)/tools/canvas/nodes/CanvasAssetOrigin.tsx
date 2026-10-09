"use client";

import { useCurrentUser } from "@/lib/auth-context";
import { storagePathOwnerUserId } from "@/lib/storage-buckets";
import { useCanvasActions } from "../canvas-actions";
import { useCanvasLibrary } from "../CanvasLibraryPicker";

/** Credit shown in the preview popup: own library files, or who made someone else's. */
export function useCanvasAssetOrigin(
  path: string | null | undefined,
  creationId: string | null | undefined,
  mediaType: "image" | "video"
) {
  const { user } = useCurrentUser();
  const { fileCreators } = useCanvasActions();
  const { openLibrary } = useCanvasLibrary();
  const ownerId = path ? storagePathOwnerUserId(path) : null;
  if (!ownerId) return {};

  if (user?.id === ownerId) {
    if (!creationId) return {};
    return {
      onShowInLibrary: () =>
        openLibrary({
          mediaType,
          title: "Your library",
          onPick: () => {},
        }),
    };
  }

  const createdBy = fileCreators[ownerId];
  return createdBy ? { createdBy } : {};
}
