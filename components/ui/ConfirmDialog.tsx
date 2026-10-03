"use client";

import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { Button } from "./Button";

// Native <dialog> + showModal(): top layer (stacks above any z-index), inert
// background, focus moved inside and restored to the opener on close.
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onKeyDown={(event) => {
        // Keep Escape from also reaching window-level handlers (e.g. a drawer behind).
        if (event.key === "Escape") event.stopPropagation();
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
      // Browsers may force-close despite preventDefault; keep `open` in sync.
      onClose={() => {
        if (open) onCancel();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-white/10 bg-N50 p-0 text-text-primary shadow-2xl shadow-black/50 backdrop:bg-black/55 backdrop:backdrop-blur-sm"
    >
      <div className="p-5">
        <h2 id={titleId} className="text-base font-semibold text-text-primary">
          {title}
        </h2>
        {description ? (
          <p id={descriptionId} className="mt-2 text-sm text-text-secondary">
            {description}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="sm" autoFocus disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
