"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Download,
  Loader2,
  RotateCcw,
  Star,
  Trash2,
  X,
} from "lucide-react";
import {
  CreationHistoryItem,
  characterDisplayName,
  isCharacterItem,
  isTrashedItem,
} from "@/lib/creations";
import { animateVideoHref, canAnimateCreation } from "@/lib/animate-handoff";
import { getCreationModelLabel } from "@/lib/creation-model-label";

type Props = {
  item: CreationHistoryItem;
  /** Library-grade chrome (favorite, animate, delete). Picker surfaces pass false. */
  richUI: boolean;
  isFavorite: boolean;
  isDownloading: boolean;
  isMutating: boolean;
  onClose: () => void;
  /** Omitted when there is no neighbour in that direction. */
  onPrev?: () => void;
  onNext?: () => void;
  onToggleFavorite: (id: string) => void;
  onDownload: (item: CreationHistoryItem) => void;
  onTrash: (item: CreationHistoryItem) => void;
  onRestore: (item: CreationHistoryItem) => void;
  onDeleteForever: (item: CreationHistoryItem) => void;
  /** Renaming a character re-reads the row upstream and drops the list cache. */
  onItemUpdated: (item: CreationHistoryItem) => void;
};

/**
 * Full-bleed preview for one creation: the media, its prompt/narration details,
 * and the per-asset actions.
 *
 * Mount this with `key={item.id}` — per-item state (which media has painted, the
 * character-name draft) is plain state that resets on remount, so nothing has to
 * be un-set in an effect afterwards.
 */
export function CreationPreviewModal({
  item,
  richUI,
  isFavorite,
  isDownloading,
  isMutating,
  onClose,
  onPrev,
  onNext,
  onToggleFavorite,
  onDownload,
  onTrash,
  onRestore,
  onDeleteForever,
  onItemUpdated,
}: Props) {
  const [mediaReady, setMediaReady] = useState(false);
  const [nameDraft, setNameDraft] = useState(() => characterDisplayName(item));
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") onPrev?.();
      else if (e.key === "ArrowRight") onNext?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext]);

  const saveCharacterName = useCallback(async () => {
    const name = nameDraft.trim();
    if (!name) {
      setNameError("Enter a name.");
      return;
    }
    setSavingName(true);
    setNameError(null);
    try {
      const res = await fetch(`/api/creations/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save name");
      onItemUpdated(data.item as CreationHistoryItem);
    } catch (err: unknown) {
      setNameError(err instanceof Error ? err.message : "Failed to save name");
    } finally {
      setSavingName(false);
    }
  }, [item.id, nameDraft, onItemUpdated]);

  const meta = item.metadata ?? {};
  const prompt = typeof meta.prompt === "string" ? meta.prompt.trim() : "";
  const scenePrompts = Array.isArray(meta.scenePrompts)
    ? (meta.scenePrompts as unknown[]).filter(
        (s): s is string => typeof s === "string" && s.trim().length > 0
      )
    : [];
  const narration =
    typeof meta.narration === "string" ? meta.narration.trim() : "";
  const hasDetails = !!prompt || scenePrompts.length > 0 || !!narration;
  const modelLabel = getCreationModelLabel(item);
  const trashed = isTrashedItem(item);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Asset preview"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-gray-950"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          className="absolute right-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/70 hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>

        {onPrev && (
          <button
            type="button"
            onClick={onPrev}
            aria-label="Previous asset"
            className="absolute left-3 top-1/2 z-20 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/70 hover:text-white"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
        {onNext && (
          <button
            type="button"
            onClick={onNext}
            aria-label="Next asset"
            className="absolute right-3 top-1/2 z-20 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/70 hover:text-white"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* The frame is held open until the media paints, otherwise the preview
              opens as a bare description strip and the picture pops in later.
              onError clears it too, so a broken asset can't pulse forever. */}
          <div
            className={`relative flex items-center justify-center bg-black ${
              mediaReady ? "" : "min-h-[45vh]"
            }`}
          >
            {!mediaReady && (
              <div className="absolute inset-0 animate-pulse bg-white/[0.06]" aria-busy="true">
                <span className="sr-only">Loading asset</span>
              </div>
            )}
            {item.mediaType === "video" ? (
              <video
                src={item.mediaUrl}
                className={`max-h-[70vh] w-full object-contain transition-opacity duration-200 ${
                  mediaReady ? "opacity-100" : "opacity-0"
                }`}
                controls
                autoPlay
                playsInline
                onLoadedData={() => setMediaReady(true)}
                onError={() => setMediaReady(true)}
              />
            ) : (
              <Image
                src={item.mediaUrl}
                alt={item.title || item.toolLabel}
                width={1080}
                height={1350}
                sizes="(min-width: 768px) 720px, 100vw"
                className={`max-h-[70vh] w-auto object-contain transition-opacity duration-200 ${
                  mediaReady ? "opacity-100" : "opacity-0"
                }`}
                onLoad={() => setMediaReady(true)}
                onError={() => setMediaReady(true)}
              />
            )}
          </div>

          {richUI && isCharacterItem(item) && (
            <div className="border-b border-white/10 px-4 py-4">
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-widest text-gray-500 sm:text-sm">
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

          {hasDetails && (
            <div className="space-y-4 px-4 py-4">
              {prompt && (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-gray-500 sm:text-sm">
                    Prompt
                  </p>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-300">
                    {prompt}
                  </p>
                </div>
              )}

              {scenePrompts.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-gray-500 sm:text-sm">
                    Scene prompts
                  </p>
                  <ol className="space-y-1.5">
                    {scenePrompts.map((scenePrompt, i) => (
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

              {narration && (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-gray-500 sm:text-sm">
                    Narration
                  </p>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-300">
                    {narration}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-white/10 px-4 py-3">
          <p className="text-xs text-gray-400">
            {new Date(item.createdAt).toLocaleDateString()}
            {modelLabel ? ` · ${modelLabel}` : ""}
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {richUI && !trashed && (
              <button
                type="button"
                onClick={() => onToggleFavorite(item.id)}
                aria-pressed={isFavorite}
                className={`flex h-8 items-center gap-1.5 rounded-full px-3 text-xs transition-colors ${
                  isFavorite
                    ? "bg-amber-400/20 text-amber-300"
                    : "bg-white/5 text-gray-300 hover:text-white"
                }`}
              >
                <Star
                  className="h-3.5 w-3.5"
                  fill={isFavorite ? "currentColor" : "none"}
                />
                {isFavorite ? "Favorited" : "Favorite"}
              </button>
            )}
            {/* Hand-off to the Video studio. A link (not a router push) so the
                photo can be animated in a new tab. Hidden on picker surfaces
                (no richUI) where leaving the page would drop the selection. */}
            {richUI && canAnimateCreation(item) && (
              <Link
                href={animateVideoHref(item.id)}
                className="flex h-8 items-center gap-1.5 rounded-full border border-purple-400/30 bg-purple-500/15 px-3 text-xs font-semibold text-purple-100 transition-colors hover:bg-purple-500/25"
              >
                <Clapperboard className="h-3.5 w-3.5" />
                Animate
              </Link>
            )}
            <button
              type="button"
              onClick={() => onDownload(item)}
              disabled={isDownloading}
              className="flex h-8 items-center gap-1.5 rounded-full bg-white/5 px-3 text-xs text-gray-300 transition-colors hover:text-white disabled:opacity-60"
            >
              {isDownloading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              Download
            </button>
            {richUI &&
              (trashed ? (
                <>
                  <button
                    type="button"
                    onClick={() => onRestore(item)}
                    disabled={isMutating}
                    className="flex h-8 items-center gap-1.5 rounded-full bg-white/5 px-3 text-xs text-gray-300 transition-colors hover:text-white disabled:opacity-60"
                  >
                    {isMutating ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3.5 w-3.5" />
                    )}
                    Restore
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteForever(item)}
                    disabled={isMutating}
                    className="flex h-8 items-center gap-1.5 rounded-full bg-red-500/15 px-3 text-xs text-red-300 transition-colors hover:bg-red-500/25 hover:text-red-200 disabled:opacity-60"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete permanently
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => onTrash(item)}
                  disabled={isMutating}
                  className="flex h-8 items-center gap-1.5 rounded-full bg-red-500/15 px-3 text-xs text-red-300 transition-colors hover:bg-red-500/25 hover:text-red-200 disabled:opacity-60"
                >
                  {isMutating ? (
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
  );
}
