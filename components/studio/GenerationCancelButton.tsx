"use client";

import { Loader2 } from "lucide-react";
import { CANCEL_LOCKED_MESSAGE, cancelControl } from "@/lib/generation-cancel-client-pure";
import { CANCEL_BTN_CLASS } from "./CreditButton";

/**
 * Cancel is offered only while the server says it can succeed (`cancelAllowed`). Once it can't (committed,
 * or a 409 on click), the button gives way to one calm line in the same fixed slot, so nothing shifts.
 */
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
  const control = cancelControl({ visible, cancelAllowed });
  if (control === "hidden") return null;
  return (
    // The slot is the live region, so screen readers announce the swap from button to line.
    <div aria-live="polite" className="flex min-h-10 w-32 shrink-0 items-center">
      {control === "locked" ? (
        <p className="text-xs leading-snug text-text-secondary">{CANCEL_LOCKED_MESSAGE}</p>
      ) : (
        <button
          type="button"
          onClick={onCancel}
          disabled={cancelling}
          aria-label={ariaLabel}
          className={`${CANCEL_BTN_CLASS} w-full focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-error`}
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
      )}
    </div>
  );
}
