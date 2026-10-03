"use client";

import { Loader2 } from "lucide-react";
import { CANCEL_BTN_CLASS } from "./CreditButton";

export function GenerationCancelButton({
  visible,
  cancelling,
  cancelAllowed,
  onCancel,
  ariaLabel,
}: {
  visible: boolean;
  cancelling: boolean;
  cancelAllowed: boolean;
  onCancel: () => void;
  ariaLabel?: string;
}) {
  if (!visible) return null;
  if (!cancelAllowed) {
    return (
      <span className="flex items-center gap-2 text-sm text-text-secondary">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Finalizing…</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onCancel}
      disabled={cancelling}
      aria-label={ariaLabel}
      className={`${CANCEL_BTN_CLASS} focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-error`}
    >
      {cancelling ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Cancelling</span>
        </>
      ) : (
        <span>Cancel</span>
      )}
    </button>
  );
}
