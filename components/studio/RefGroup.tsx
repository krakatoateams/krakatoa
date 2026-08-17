"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Film, Image as ImageIcon, Info, Loader2, Music, Plus, X } from "lucide-react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { fetchSignedUrl } from "@/lib/storage-sign-client";
import { Tooltip } from "./Tooltip";

export type RefKind = "image" | "video" | "audio";
export type RefStatus = "uploading" | "done" | "error";

export type MediaRef = {
  id: string;
  file: File;
  preview: string | null;
  kind: RefKind;
  status: RefStatus;
  url?: string;
  path?: string;
  error?: string;
};

// Mint a signed upload URL and push the bytes straight to Supabase (videos/temp/refs/).
export async function uploadRefFile(file: File): Promise<{ url: string; path: string }> {
  const signRes = await fetch("/api/upload/ref/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type,
      size: file.size,
    }),
  });
  const signData = await signRes.json().catch(() => null);
  if (!signRes.ok || !signData) {
    throw new Error(signData?.error || "Couldn't start the upload (server error).");
  }
  const { bucket, path, token, storagePath } = signData as {
    bucket: string;
    path: string;
    token: string;
    storagePath?: string;
  };
  const { error } = await getSupabaseBrowser()
    .storage.from(bucket)
    .uploadToSignedUrl(path, token, file, { contentType: file.type });
  if (error) throw new Error(error.message || "Upload failed.");
  const resolvedPath = storagePath || path;
  const signed = await fetchSignedUrl({ path: resolvedPath });
  return { url: signed.url, path: resolvedPath };
}

export type RefGroupApi = {
  items: MediaRef[];
  add: (files: FileList | File[]) => void;
  remove: (id: string) => void;
  reset: () => void;
  max: number;
  /** at least one item still uploading */
  uploading: boolean;
  /** done items as { url, path } */
  done: { url: string; path: string }[];
};

// Manages a list of media references (auto-uploads on add, dedupes uploads in a
// strict-mode-safe effect, and revokes object URLs on remove/unmount).
export function useMediaRefs(kind: RefKind, max: number): RefGroupApi {
  const [items, setItems] = useState<MediaRef[]>([]);
  const startedRef = useRef<Set<string>>(new Set());
  const itemsRef = useRef<MediaRef[]>([]);
  itemsRef.current = items;

  useEffect(() => {
    return () => {
      itemsRef.current.forEach((it) => {
        if (it.preview) URL.revokeObjectURL(it.preview);
      });
    };
  }, []);

  // Kick off uploads for any freshly-added item (deduped by id).
  useEffect(() => {
    for (const it of items) {
      if (it.status === "uploading" && !startedRef.current.has(it.id)) {
        startedRef.current.add(it.id);
        uploadRefFile(it.file)
          .then(({ url, path }) =>
            setItems((cur) =>
              cur.map((x) => (x.id === it.id ? { ...x, status: "done", url, path } : x))
            )
          )
          .catch((e) =>
            setItems((cur) =>
              cur.map((x) =>
                x.id === it.id
                  ? {
                      ...x,
                      status: "error",
                      error: e instanceof Error ? e.message : "Upload failed.",
                    }
                  : x
              )
            )
          );
      }
    }
  }, [items]);

  const add = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files);
      setItems((prev) => {
        const room = Math.max(0, max - prev.length);
        const accepted: MediaRef[] = list.slice(0, room).map((file) => ({
          id: crypto.randomUUID(),
          file,
          preview: kind === "audio" ? null : URL.createObjectURL(file),
          kind,
          status: "uploading" as const,
        }));
        return [...prev, ...accepted];
      });
    },
    [kind, max]
  );

  const remove = useCallback((id: string) => {
    setItems((prev) => {
      const target = prev.find((x) => x.id === id);
      if (target?.preview) URL.revokeObjectURL(target.preview);
      return prev.filter((x) => x.id !== id);
    });
  }, []);

  const reset = useCallback(() => {
    setItems((prev) => {
      prev.forEach((x) => {
        if (x.preview) URL.revokeObjectURL(x.preview);
      });
      return [];
    });
  }, []);

  const uploading = items.some((x) => x.status === "uploading");
  const done = items
    .filter((x) => x.status === "done" && x.url)
    .map((x) => ({ url: x.url as string, path: x.path ?? "" }));

  return { items, add, remove, reset, max, uploading, done };
}

export function RefTile({ item, onRemove }: { item: MediaRef; onRemove: () => void }) {
  return (
    <div className="relative h-16 w-20 shrink-0 overflow-hidden rounded-radius-sm bg-white/5">
      {item.kind === "image" && item.preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.preview} alt="reference" className="absolute inset-0 h-full w-full object-cover" />
      ) : item.kind === "video" && item.preview ? (
        <video src={item.preview} muted playsInline className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-text-secondary">
          <Music className="h-5 w-5" />
          <span className="max-w-full truncate px-1 text-xs">{item.file.name}</span>
        </div>
      )}

      {item.status === "uploading" && (
        <div className="absolute inset-0 flex items-center justify-center bg-N0/60">
          <Loader2 className="h-5 w-5 animate-spin text-text-secondary" />
        </div>
      )}
      {item.status === "error" && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-error/40 px-1"
          title={item.error || "Upload failed"}
        >
          <AlertCircle className="h-5 w-5 shrink-0 text-error" />
          {item.error ? (
            <span className="line-clamp-2 w-full text-center text-[10px] leading-tight text-R800">
              {item.error}
            </span>
          ) : null}
        </div>
      )}

      <span
        role="button"
        tabIndex={0}
        onClick={onRemove}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onRemove();
        }}
        className="absolute right-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-N0/70 text-N900 hover:bg-error/80"
      >
        <X className="h-3 w-3" />
      </span>
    </div>
  );
}

export function RefGroup({
  icon,
  label,
  hint,
  accept,
  multiple,
  group,
  disabled,
  disabledReason,
  bare = false,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  accept: string;
  multiple: boolean;
  group: RefGroupApi;
  disabled?: boolean;
  disabledReason?: string;
  /** Render without the card wrapper / header / count — for inline use beside a prompt. */
  bare?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const full = group.items.length >= group.max;
  const addDisabled = disabled || full;

  return (
    <div className={bare ? "" : "rounded-2xl bg-white/[0.03] p-3"}>
      {!bare && (
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-semibold capitalize text-text-secondary sm:text-sm">
            <span className="text-text-secondary">{icon}</span>
            {label}
            {hint ? (
              <Tooltip label={hint}>
                <Info
                  className="h-3.5 w-3.5 text-text-disabled transition-colors hover:text-text-secondary"
                  aria-label={hint}
                />
              </Tooltip>
            ) : null}
          </div>
          <span className="text-xs text-text-disabled">
            {group.items.length}/{group.max}
          </span>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {group.items.map((it) => (
          <RefTile key={it.id} item={it} onRemove={() => group.remove(it.id)} />
        ))}
        {!full && (
          <button
            type="button"
            disabled={addDisabled}
            onClick={() => inputRef.current?.click()}
            title={disabled ? disabledReason : bare ? hint ?? `Add ${label.toLowerCase()}` : `Add ${label.toLowerCase()}`}
            className="group flex h-16 w-20 shrink-0 flex-col items-start justify-between rounded-radius-sm bg-white/5 p-2 text-left text-xs font-semibold normal-case leading-tight tracking-wide text-text-secondary transition-colors hover:bg-white/10 hover:text-N900 disabled:cursor-not-allowed disabled:opacity-30"
          >
            {bare ? <span className="text-text-secondary">{icon}</span> : <Plus className="h-4 w-4" />}
            <span>{bare ? label : "Add"}</span>
          </button>
        )}
      </div>

      {disabled && disabledReason ? (
        <p className="mt-2 text-sm leading-snug text-warning/85">{disabledReason}</p>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) group.add(e.target.files);
          if (inputRef.current) inputRef.current.value = "";
        }}
      />
    </div>
  );
}

// A single inline "Reference" tile that accepts BOTH images and videos, routing
// each dropped file to the right group by MIME type. The video (Film) icon and
// video acceptance only appear when a videoGroup is supplied (i.e. the model
// supports reference video). Card-less, sized to match the bare RefGroup tiles.
export function RefMediaGroup({
  imageGroup,
  videoGroup,
  imageAccept,
  videoAccept,
  label,
  disabled,
  disabledReason,
  hint,
}: {
  imageGroup: RefGroupApi;
  videoGroup?: RefGroupApi;
  imageAccept: string;
  videoAccept?: string;
  label: string;
  disabled?: boolean;
  disabledReason?: string;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const acceptsVideo = !!videoGroup && !!videoAccept;

  const canAddImage = imageGroup.items.length < imageGroup.max;
  const canAddVideo = acceptsVideo && videoGroup!.items.length < videoGroup!.max;
  const canAdd = canAddImage || canAddVideo;

  const accept = [canAddImage ? imageAccept : null, canAddVideo ? videoAccept : null]
    .filter(Boolean)
    .join(",");

  const routeFiles = (files: FileList | File[]) => {
    const list = Array.from(files);
    const images = list.filter((f) => !f.type.startsWith("video/"));
    const videos = list.filter((f) => f.type.startsWith("video/"));
    if (images.length && canAddImage) imageGroup.add(images);
    if (videos.length && canAddVideo) videoGroup!.add(videos);
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {imageGroup.items.map((it) => (
          <RefTile key={it.id} item={it} onRemove={() => imageGroup.remove(it.id)} />
        ))}
        {acceptsVideo &&
          videoGroup!.items.map((it) => (
            <RefTile key={it.id} item={it} onRemove={() => videoGroup!.remove(it.id)} />
          ))}
        {canAdd && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            title={disabled ? disabledReason : hint ?? `Add ${label.toLowerCase()}`}
            className="group flex h-16 w-20 shrink-0 flex-col items-start justify-between rounded-radius-sm bg-white/5 p-2 text-left text-xs font-semibold normal-case leading-tight tracking-wide text-text-secondary transition-colors hover:bg-white/10 hover:text-N900 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <span className="flex items-center gap-1 text-text-secondary">
              <ImageIcon className="h-3.5 w-3.5" />
              {acceptsVideo && <Film className="h-3.5 w-3.5" />}
            </span>
            <span>{label}</span>
          </button>
        )}
      </div>

      {disabled && disabledReason ? (
        <p className="mt-2 text-sm leading-snug text-warning/85">{disabledReason}</p>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) routeFiles(e.target.files);
          if (inputRef.current) inputRef.current.value = "";
        }}
      />
    </div>
  );
}
