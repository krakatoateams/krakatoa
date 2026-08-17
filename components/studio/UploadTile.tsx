"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ImagePlus, Plus, Upload, Users, X } from "lucide-react";

export type ImageUpload = {
  file: File | null;
  preview: string | null;
  inputRef: React.RefObject<HTMLInputElement>;
  open: () => void;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  clear: () => void;
};

// Encapsulates one optional image slot: file state, object-URL preview lifecycle,
// hidden <input> ref, and open/clear helpers. Used for product, character, and
// reference uploads so each tile manages itself.
export function useImageUpload(): ImageUpload {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const set = (next: File | null) => {
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return next ? URL.createObjectURL(next) : null;
    });
    setFile(next);
  };

  return {
    file,
    preview,
    inputRef,
    open: () => inputRef.current?.click(),
    onChange: (e) => {
      const next = e.target.files?.[0];
      if (next) set(next);
    },
    clear: () => {
      set(null);
      if (inputRef.current) inputRef.current.value = "";
    },
  };
}

// A 64×64 upload tile (PRODUCT / CHARACTER / REFERENCE). Shows the picked image
// with a clear button, or a "+ label" prompt when empty.
export function UploadTile({
  label,
  upload,
  disabled,
  fluid = false,
  iconOnly = false,
}: {
  label: string;
  upload: ImageUpload;
  disabled?: boolean;
  fluid?: boolean;
  /** Compact + button with no label — used inline beside the prompt on desktop. */
  iconOnly?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={upload.open}
      disabled={disabled}
      className={`group relative flex overflow-hidden font-semibold normal-case tracking-wide transition-colors ${
        fluid
          ? "h-16 w-full flex-1 flex-row items-center justify-center gap-2 rounded-radius-xl text-xs"
          : iconOnly
            ? upload.preview
              ? "h-16 w-16 shrink-0 items-center justify-center rounded-radius-xl"
              : "h-10 w-10 shrink-0 items-center justify-center rounded-[10px]"
            : "h-16 w-20 shrink-0 flex-col items-start justify-between rounded-radius-sm p-2 text-xs"
      } ${
        upload.preview
          ? ""
          : "bg-white/5 text-text-secondary hover:bg-white/10 hover:text-N900"
      }`}
      title={upload.preview ? `Change ${label.toLowerCase()} image` : `Add ${label.toLowerCase()} image`}
    >
      {upload.preview ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={upload.preview}
            alt={label}
            className="absolute inset-0 h-full w-full object-cover"
          />
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              upload.clear();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                upload.clear();
              }
            }}
            className="absolute right-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-N0/70 text-N900 hover:bg-error/80"
          >
            <X className="h-3 w-3" />
          </span>
        </>
      ) : iconOnly ? (
        <ImagePlus className="h-4 w-4" />
      ) : (
        <>
          <Plus className={fluid ? "h-5 w-5" : "h-4 w-4"} />
          <span>{label}</span>
        </>
      )}
    </button>
  );
}

// Character slot for Product Try-on: shows the chosen image (uploaded OR a saved
// character) with a clear button, or a "+ Character" button that opens a small
// menu to either upload an image or pick a previously generated character.
export function CharacterTile({
  preview,
  onUpload,
  onPick,
  onClear,
  disabled,
  fluid = false,
}: {
  preview: string | null;
  onUpload: () => void;
  onPick: () => void;
  onClear: () => void;
  disabled?: boolean;
  fluid?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [sheetShown, setSheetShown] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  // Track the mobile breakpoint (< md) so the menu can present as a bottom sheet.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        ref.current &&
        !ref.current.contains(t) &&
        (!sheetRef.current || !sheetRef.current.contains(t))
      ) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  // Lock body scroll while the mobile sheet is open, and drive the slide-up.
  useEffect(() => {
    if (!menuOpen || !isMobile) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const raf = requestAnimationFrame(() => setSheetShown(true));
    return () => {
      document.body.style.overflow = prev;
      cancelAnimationFrame(raf);
      setSheetShown(false);
    };
  }, [menuOpen, isMobile]);

  if (preview) {
    return (
      <div
        className={`relative h-16 ${
          fluid ? "w-full flex-1 rounded-radius-xl" : "w-20 shrink-0 rounded-radius-sm"
        } overflow-hidden`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={preview} alt="Character" className="absolute inset-0 h-full w-full object-cover" />
        <span
          role="button"
          tabIndex={0}
          onClick={onClear}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") onClear();
          }}
          className="absolute right-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-N0/70 text-N900 hover:bg-error/80"
        >
          <X className="h-3 w-3" />
        </span>
      </div>
    );
  }

  return (
    <div ref={ref} className={`relative ${fluid ? "w-full flex-1" : "shrink-0"}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setMenuOpen((o) => !o)}
        className={`group flex h-16 bg-white/5 font-semibold normal-case tracking-wide text-text-secondary transition-colors hover:bg-white/10 hover:text-N900 ${
          fluid
            ? "w-full flex-row items-center justify-center gap-2 rounded-radius-xl text-xs"
            : "w-20 flex-col items-start justify-between rounded-radius-sm p-2 text-xs"
        }`}
        title="Add character"
      >
        <Plus className={fluid ? "h-5 w-5" : "h-4 w-4"} />
        <span>Character</span>
      </button>

      {/* Desktop: anchored menu under the tile. */}
      {menuOpen && !isMobile && (
        <div className="absolute left-0 z-50 mt-2 w-52 overflow-hidden rounded-2xl border border-white/10 bg-N50 p-1.5 shadow-2xl shadow-N0/50">
          {renderMenuOptions(false)}
        </div>
      )}

      {/* Mobile: bottom sheet. */}
      {menuOpen &&
        isMobile &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div
              onClick={() => setMenuOpen(false)}
              aria-hidden="true"
              className={`fixed inset-0 z-[90] bg-N0/60 backdrop-blur-sm transition-opacity duration-200 ${
                sheetShown ? "opacity-100" : "opacity-0"
              }`}
            />
            <div
              ref={sheetRef}
              role="dialog"
              aria-modal="true"
              className={`fixed inset-x-0 bottom-0 z-[90] rounded-t-2xl border-t border-white/10 bg-N50 p-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] shadow-2xl shadow-N0/60 transition-transform duration-200 ease-out ${
                sheetShown ? "translate-y-0" : "translate-y-full"
              }`}
            >
              <div className="mx-auto mb-2 mt-1 h-1.5 w-10 rounded-full bg-white/20" />
              <p className="mb-2 px-3 text-lg font-semibold text-N900">Add character</p>
              <div className="max-h-[70vh] overflow-y-auto">{renderMenuOptions(true)}</div>
            </div>
          </>,
          document.body
        )}
    </div>
  );

  function renderMenuOptions(big: boolean) {
    const rowClass = `flex w-full items-center gap-2 rounded-xl text-left text-text-secondary transition-colors hover:bg-white/5 ${
      big ? "px-4 py-3 text-base" : "px-3 py-2 text-sm"
    }`;
    return (
      <>
        <button
          type="button"
          onClick={() => {
            setMenuOpen(false);
            onUpload();
          }}
          className={rowClass}
        >
          <Upload className="h-4 w-4 text-text-secondary" />
          Upload image
        </button>
        <button
          type="button"
          onClick={() => {
            setMenuOpen(false);
            onPick();
          }}
          className={rowClass}
        >
          <Users className="h-4 w-4 text-text-secondary" />
          Use a saved character
        </button>
      </>
    );
  }
}
