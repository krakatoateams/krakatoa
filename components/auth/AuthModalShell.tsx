"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

/**
 * Shared dialog chrome (backdrop, esc-to-close, scroll lock, close button,
 * card frame) for every auth modal — SignInModal (sign-in + forgot-password
 * views) and ResetPasswordModal. Content-agnostic on purpose so each modal
 * only owns its form logic.
 *
 * `promoPanel` is optional: omit it (ResetPasswordModal does) for the
 * original bare single-column card. SignInModal passes it to get the
 * two-column promo+form layout. The promo panel is placed FIRST in source
 * order deliberately — at `lg`+ that's the left column (flex-row), and below
 * `lg` (flex-col) source-first means it's also the top block, so "promo on
 * the left at desktop, on top on mobile" falls out of plain DOM order with
 * no extra responsive/media-query logic (see design.md's "Open Questions —
 * resolved during apply" #4).
 */
export function AuthModalShell({
  open,
  ariaLabel,
  onClose,
  closeDisabled = false,
  promoPanel,
  children,
}: {
  open: boolean;
  ariaLabel: string;
  onClose: () => void;
  closeDisabled?: boolean;
  promoPanel?: React.ReactNode;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !closeDisabled) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [closeDisabled, open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      className={`fixed inset-0 z-[100] flex justify-center bg-black/70 backdrop-blur-sm ${
        // With the promo layout (sign-in / sign-up / forgot password), phones
        // get a full-screen page instead of a floating card; from sm up it's
        // the centered modal.
        promoPanel ? "items-stretch sm:items-center sm:px-4" : "items-center px-4"
      }`}
      onClick={closeDisabled ? undefined : onClose}
    >
      <div
        className={`relative w-full overflow-hidden ${
          // bg-sunken-surface (N50/#121212, the app's actual "second
          // darkest" token) only for the two-column promo layout — matches
          // the darker reference design. ResetPasswordModal (no promoPanel)
          // keeps the original bg-surface single-column look unchanged.
          promoPanel
            ? "h-[100dvh] bg-bg-sunken-surface sm:h-auto sm:max-w-3xl sm:rounded-radius-2xl sm:border sm:border-border-default sm:shadow-elevation-02"
            : "max-w-md rounded-radius-2xl border border-border-default bg-bg-surface p-spacing-xl shadow-elevation-02"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          disabled={closeDisabled}
          aria-label="Close"
          className={`absolute right-spacing-lg top-spacing-lg z-30 rounded-radius-xl p-spacing-sm transition-colors hover:bg-bg-surface-2 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 ${
            // Over the promo video the bare icon was hard to see; give it a
            // dark backing there. The bare card keeps its original look.
            promoPanel ? "bg-N0/50 text-text-primary backdrop-blur-sm" : "text-icon-low-emphasis"
          }`}
        >
          <X className="h-4 w-4" />
        </button>
        {promoPanel ? (
          // Phones: full screen, sized in dvh so iOS's collapsing URL bar
          // can't clip it; the form takes the space under the promo strip.
          // Fixed lg:min-h so sign-in/sign-up/forgot-password (different
          // form field counts, different content height) don't resize the
          // whole modal when switching views — the shorter form just centers
          // in the extra space instead.
          <div className="flex h-full flex-col overflow-y-auto sm:h-auto sm:max-h-[90dvh] lg:min-h-[560px] lg:flex-row">
            {/* Promo panel first in source order on purpose — see the prop comment above. */}
            <div className="w-full shrink-0 lg:w-1/2">{promoPanel}</div>
            <div className="flex w-full flex-1 items-start p-spacing-xl sm:flex-none sm:items-center lg:w-1/2">
              <div className="w-full">{children}</div>
            </div>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
