"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

/**
 * Shared dialog chrome (backdrop, esc-to-close, scroll lock, close button,
 * card frame) for every auth modal — SignInModal (sign-in + forgot-password
 * views) and ResetPasswordModal. Content-agnostic on purpose so each modal
 * only owns its form logic.
 */
export function AuthModalShell({
  open,
  ariaLabel,
  onClose,
  children,
}: {
  open: boolean;
  ariaLabel: string;
  onClose: () => void;
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
        className="relative w-full max-w-md rounded-radius-2xl border border-border-default bg-bg-surface p-spacing-xl shadow-elevation-02"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-spacing-lg top-spacing-lg rounded-radius-md p-spacing-sm text-icon-low-emphasis transition-colors hover:bg-bg-surface-2 hover:text-text-primary"
        >
          <X className="h-4 w-4" />
        </button>
        {children}
      </div>
    </div>
  );
}
