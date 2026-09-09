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
  promoPanel,
  children,
}: {
  open: boolean;
  ariaLabel: string;
  onClose: () => void;
  promoPanel?: React.ReactNode;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`relative w-full overflow-hidden rounded-radius-2xl border border-border-default shadow-elevation-02 ${
          // bg-sunken-surface (N50/#121212, the app's actual "second
          // darkest" token) only for the two-column promo layout — matches
          // the darker reference design. ResetPasswordModal (no promoPanel)
          // keeps the original bg-surface single-column look unchanged.
          promoPanel ? "max-w-3xl bg-bg-sunken-surface" : "max-w-md bg-bg-surface p-spacing-xl"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-spacing-lg top-spacing-lg z-30 rounded-radius-xl p-spacing-sm text-icon-low-emphasis transition-colors hover:bg-bg-surface-2 hover:text-text-primary"
        >
          <X className="h-4 w-4" />
        </button>
        {promoPanel ? (
          // Fixed lg:min-h so sign-in/sign-up/forgot-password (different
          // form field counts, different content height) don't resize the
          // whole modal when switching views — the shorter form just centers
          // in the extra space instead.
          <div className="flex max-h-[90vh] flex-col overflow-y-auto lg:min-h-[560px] lg:flex-row">
            {/* Promo panel first in source order on purpose — see the prop comment above. */}
            <div className="w-full shrink-0 lg:w-1/2">{promoPanel}</div>
            <div className="flex w-full items-center p-spacing-xl lg:w-1/2">
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
