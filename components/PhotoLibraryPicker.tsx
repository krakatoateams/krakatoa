"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Loader2, AlertCircle, Check } from "lucide-react";

export type LibraryImage = { id: string; url: string; title: string };

export type PhotoLibrarySource = "upload" | "library";

type RefTileItem = {
  id: string;
  preview: string | null;
  status: "uploading" | "done" | "error";
  error?: string;
};

export type PhotoUploadGroup = {
  items: RefTileItem[];
  add: (files: FileList | File[]) => void;
  remove: (id: string) => void;
  uploading: boolean;
};

function RefTile({
  item,
  onRemove,
}: {
  item: RefTileItem;
  onRemove: () => void;
}) {
  return (
    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-[4px] border border-white/10 bg-black/40">
      {item.preview && item.status !== "error" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.preview} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[10px] text-gray-500">
          {item.status === "uploading" ? (
            <Loader2 className="h-4 w-4 animate-spin text-purple-300" />
          ) : (
            "Error"
          )}
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white hover:bg-red-500/80"
      >
        ×
      </button>
    </div>
  );
}

/** Upload or pick a saved Photo Studio image from the user's library. */
export default function PhotoLibraryPicker({
  label,
  icon,
  accept,
  group,
  source,
  onSourceChange,
  selected,
  onSelect,
  disabled,
  libraryHref = "/tools/photo-v2",
  libraryEmptyLabel = "No saved images yet.",
  libraryTool = "product_photo",
  libraryKind,
}: {
  label: string;
  icon: React.ReactNode;
  accept: string;
  group: PhotoUploadGroup;
  source: PhotoLibrarySource;
  onSourceChange: (s: PhotoLibrarySource) => void;
  selected: LibraryImage | null;
  onSelect: (img: LibraryImage | null) => void;
  disabled?: boolean;
  hint?: string;
  libraryHref?: string;
  libraryEmptyLabel?: string;
  /** Creations `tool` to list from (default "product_photo"). */
  libraryTool?: string;
  /** When set, only keep items whose `metadata.creationKind` matches (e.g. "character"). */
  libraryKind?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<LibraryImage[]>([]);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const startedRef = useRef(false);

  const loadLibrary = useCallback(() => {
    startedRef.current = true;
    setLoadState("loading");
    fetch(
      `/api/creations/history?tool=${encodeURIComponent(libraryTool)}&mediaType=image&limit=100${
        libraryKind ? `&kind=${encodeURIComponent(libraryKind)}` : ""
      }`
    )
      .then((r) => r.json())
      .then(
        (d: {
          items?: {
            id: string;
            mediaUrl?: string;
            title?: string;
            metadata?: { creationKind?: string } | null;
          }[];
        }) => {
          const list: LibraryImage[] = (d.items ?? [])
            .filter((it) => !!it.mediaUrl)
            .filter((it) => !libraryKind || it.metadata?.creationKind === libraryKind)
            .map((it) => ({
              id: it.id,
              url: it.mediaUrl as string,
              title: it.title || "Image",
            }));
          setItems(list);
          setLoadState("loaded");
        }
      )
      .catch(() => setLoadState("error"));
  }, [libraryTool, libraryKind]);

  useEffect(() => {
    if (source !== "library" || startedRef.current) return;
    loadLibrary();
  }, [source, loadLibrary]);

  const uploaded = group.items[0];

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          <span className="text-purple-300">{icon}</span>
          {label}
        </span>
        <div className="flex items-center gap-0.5 rounded-full border border-white/10 bg-white/5 p-0.5">
          {(
            [
              { id: "upload", label: "Upload" },
              { id: "library", label: "My library" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              disabled={disabled}
              onClick={() => onSourceChange(opt.id)}
              className={`rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors disabled:opacity-40 ${
                source === opt.id
                  ? "bg-purple-500/25 text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {source === "upload" ? (
        <>
          <div className="flex flex-wrap gap-2">
            {uploaded ? (
              <RefTile item={uploaded} onRemove={() => group.remove(uploaded.id)} />
            ) : (
              <button
                type="button"
                disabled={disabled}
                onClick={() => inputRef.current?.click()}
                className="flex h-16 w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-[4px] border border-dashed border-white/15 bg-white/5 text-[10px] font-semibold uppercase tracking-wide text-gray-400 transition-colors hover:border-purple-400/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
              >
                <Plus className="h-4 w-4" />
                <span>Add</span>
              </button>
            )}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) group.add(e.target.files);
              if (inputRef.current) inputRef.current.value = "";
            }}
          />
        </>
      ) : loadState === "loading" || loadState === "idle" ? (
        <div className="flex h-16 items-center gap-2 text-[11px] text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin text-purple-300" />
          Loading your library…
        </div>
      ) : loadState === "error" ? (
        <div className="flex h-16 flex-wrap items-center gap-2 text-[11px] text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Couldn&apos;t load your library.
          <button
            type="button"
            onClick={loadLibrary}
            className="font-semibold text-purple-300 underline-offset-2 hover:underline"
          >
            Try again
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="flex h-16 flex-col justify-center gap-1 text-[11px] text-gray-500">
          <span>{libraryEmptyLabel}</span>
          <a href={libraryHref} className="font-semibold text-purple-300 hover:text-purple-200">
            Create one in Photo Studio →
          </a>
        </div>
      ) : (
        <div className="grid max-h-44 grid-cols-3 gap-2 overflow-y-auto pr-1">
          {items.map((img) => {
            const active = selected?.id === img.id;
            return (
              <button
                key={img.id}
                type="button"
                disabled={disabled}
                onClick={() => onSelect(active ? null : img)}
                title={img.title}
                className={`relative aspect-square overflow-hidden rounded-[6px] border transition-colors disabled:opacity-40 ${
                  active
                    ? "border-purple-400 ring-2 ring-purple-400/40"
                    : "border-white/10 hover:border-white/30"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt={img.title}
                  className="absolute inset-0 h-full w-full object-cover"
                />
                {active && (
                  <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-purple-500 text-white">
                    <Check className="h-2.5 w-2.5" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {source === "library" && selected ? (
        <p className="mt-2 text-[10px] text-gray-600">Selected: {selected.title}</p>
      ) : null}
    </div>
  );
}
