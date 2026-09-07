"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { FolderOpen, RefreshCw, X } from "lucide-react";
import CreationsHistory from "@/components/CreationsHistory";
import { useAuthModal } from "@/components/auth/AuthModalProvider";
import { useCurrentUser } from "@/lib/auth-context";
import { canDropOnEditor } from "@/lib/editor-handoff";
import type { CreationHistoryItem } from "@/lib/creations";

type PickerRequest = {
  mediaType?: "image" | "video";
  title?: string;
  onPick: (item: CreationHistoryItem) => void;
};

type LibraryCtx = {
  openLibrary: (request: PickerRequest) => void;
  pickerOpen: boolean;
};

const EditorLibraryContext = createContext<LibraryCtx | null>(null);

export function useEditorLibrary(): LibraryCtx {
  const ctx = useContext(EditorLibraryContext);
  if (!ctx) {
    throw new Error("useEditorLibrary must be used inside EditorLibraryProvider");
  }
  return ctx;
}

export function EditorLibraryProvider({ children }: { children: React.ReactNode }) {
  const { status } = useCurrentUser();
  const { openSignInModal } = useAuthModal();
  const [request, setRequest] = useState<PickerRequest | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const close = useCallback(() => setRequest(null), []);

  const openLibrary = useCallback(
    (next: PickerRequest) => {
      if (status !== "authenticated") {
        openSignInModal();
        return;
      }
      setRequest(next);
    },
    [openSignInModal, status]
  );

  useEffect(() => {
    if (!request) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, request]);

  const handleSelect = (item: CreationHistoryItem) => {
    if (!canDropOnEditor(item)) return;
    request?.onPick(item);
    close();
  };

  return (
    <EditorLibraryContext.Provider value={{ openLibrary, pickerOpen: !!request }}>
      {children}
      {request && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[70] flex justify-end bg-black/55 backdrop-blur-sm">
              <button
                type="button"
                aria-label="Close library"
                className="absolute inset-0 cursor-default"
                onClick={close}
              />
              <aside
                role="dialog"
                aria-modal="true"
                aria-labelledby="editor-library-title"
                className="relative flex h-full w-full max-w-md flex-col border-l border-white/10 bg-N50 shadow-2xl shadow-black/50"
              >
                <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4">
                  <div className="flex min-w-0 items-center gap-2">
                    <FolderOpen className="h-4 w-4 shrink-0 text-text-secondary" />
                    <h2
                      id="editor-library-title"
                      className="truncate text-sm font-semibold text-text-primary"
                    >
                      {request.title
                        ? request.title
                        : request.mediaType === "image"
                          ? "Pick an image"
                          : request.mediaType === "video"
                            ? "Pick a video"
                            : "My library"}
                    </h2>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      aria-label="Refresh library"
                      onClick={() => setRefreshKey((k) => k + 1)}
                      className="rounded-lg p-1.5 text-icon-low-emphasis transition-colors hover:bg-white/10 hover:text-text-primary"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Close library"
                      onClick={close}
                      className="rounded-lg p-1.5 text-icon-low-emphasis transition-colors hover:bg-white/10 hover:text-text-primary"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </header>
                <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
                  <CreationsHistory
                    title="My library"
                    hideHeader
                    showRefresh={false}
                    showMeta={false}
                    showCreateCta
                    mediaType={request.mediaType}
                    limit={20}
                    refreshKey={refreshKey}
                    itemFilter={canDropOnEditor}
                    onSelect={handleSelect}
                    gridClassName="grid grid-cols-2 gap-3"
                    className="!mt-4 !border-t-0 !pt-0"
                  />
                </div>
              </aside>
            </div>,
            document.body
          )
        : null}
    </EditorLibraryContext.Provider>
  );
}
