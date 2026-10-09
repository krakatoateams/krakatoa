"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import {
  EXPORT_STAGE_LABEL,
  formatElapsed,
  stageValueText,
  type ExportStage,
} from "@/lib/editor-export-progress";

export type ExportProgressState = {
  outcome: "running" | "success" | "failed" | "cancelled";
  stage: ExportStage;
  /** Real percentage 0-99, or null = indeterminate. */
  pct: number | null;
  uploadDone: number;
  uploadTotal: number;
  startedAt: number;
  endedAt: number | null;
  error: string | null;
  creationId: string | null;
  cancelAllowed: boolean;
  cancelling: boolean;
};

export const EXPORT_BUTTON_ID = "editor-export-button";

// Native <dialog> + showModal() (same pattern as ConfirmDialog): focus trap, top layer, inert background.
export function EditorExportProgressDialog({
  open,
  state,
  onClose,
  onCancel,
  onRetry,
  onOpenLibrary,
}: {
  open: boolean;
  state: ExportProgressState;
  onClose: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onOpenLibrary: (creationId: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { outcome, stage, pct } = state;
  const running = outcome === "running";

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!open || !running) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [open, running]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) {
      dialog.close();
      document.getElementById(EXPORT_BUTTON_ID)?.focus();
    }
  }, [open]);

  const title =
    outcome === "success"
      ? "Export complete"
      : outcome === "failed"
        ? "Export failed"
        : outcome === "cancelled"
          ? "Export cancelled"
          : "Exporting video";
  const stageLabel =
    stage === "uploading" && state.uploadTotal > 0
      ? `${EXPORT_STAGE_LABEL.uploading}: ${Math.min(state.uploadDone + 1, state.uploadTotal)} of ${state.uploadTotal}`
      : EXPORT_STAGE_LABEL[stage];
  const elapsed = formatElapsed((state.endedAt ?? now) - state.startedAt);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-modal="true"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-white/10 bg-N50 p-0 text-text-primary shadow-2xl shadow-black/50 backdrop:bg-black/55 backdrop:backdrop-blur-sm"
    >
      <div className="p-5">
        <h2 id={titleId} className="flex items-center gap-2 text-base font-semibold text-text-primary">
          {outcome === "success" ? <CheckCircle2 className="h-5 w-5 text-success" aria-hidden /> : null}
          {outcome === "failed" ? <XCircle className="h-5 w-5 text-error" aria-hidden /> : null}
          {title}
        </h2>

        {running ? (
          <div className="mt-4 space-y-2">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-text-primary">{stageLabel}</span>
              <span className="tabular-nums text-text-secondary">{pct == null ? "" : `${pct}%`}</span>
            </div>
            <ProgressBar value={pct} label="Export progress" valueText={stageValueText(stage, pct)} />
            <p className="text-xs text-text-secondary">
              Elapsed <span className="tabular-nums">{elapsed}</span>
            </p>
            {!state.cancelAllowed ? (
              <p className="text-xs text-text-secondary">
                Cancel is unavailable while the video is being saved.
              </p>
            ) : null}
          </div>
        ) : null}

        {outcome === "success" ? (
          <p className="mt-3 text-sm text-text-secondary">
            Your video is ready (took <span className="tabular-nums">{elapsed}</span>).
          </p>
        ) : null}
        {outcome === "failed" ? (
          <p className="mt-3 text-sm text-text-secondary">{state.error ?? "Export failed."}</p>
        ) : null}
        {outcome === "cancelled" ? (
          <p className="mt-3 text-sm text-text-secondary">The export was stopped. Nothing was added to your library.</p>
        ) : null}

        {/* One polite region: announces stage changes and the outcome, never each percent. */}
        <p className="sr-only" aria-live="polite" role="status">
          {running ? stageLabel : title}
        </p>

        <div className="mt-5 flex justify-end gap-2">
          {running ? (
            <>
              <Button variant="secondary" size="sm" onClick={onClose}>
                Hide
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={!state.cancelAllowed || state.cancelling}
                loading={state.cancelling}
                onClick={onCancel}
              >
                Cancel export
              </Button>
            </>
          ) : (
            <>
              {outcome === "failed" ? (
                <Button variant="primary" size="sm" onClick={onRetry}>
                  Try again
                </Button>
              ) : null}
              {outcome === "success" && state.creationId ? (
                <Button variant="primary" size="sm" onClick={() => onOpenLibrary(state.creationId!)}>
                  Open in library
                </Button>
              ) : null}
              <Button variant="secondary" size="sm" autoFocus onClick={onClose}>
                Close
              </Button>
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}
