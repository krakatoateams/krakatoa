"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { useCurrentUser } from "@/lib/auth-context";
import { savePendingDraft, JUST_SIGNED_IN_FLAG } from "@/lib/pending-form-draft";
import { SignInModal } from "./SignInModal";

type AuthModalContextValue = {
  /**
   * @param next Where to land after sign-in. Defaults to the exact current
   * URL (path + query) so a gated action always resumes where it was
   * triggered — pass an explicit value only to send the visitor somewhere
   * else on purpose.
   * @param draft Optional form field values (text/settings only, never a
   * File) to restore after sign-in — see lib/pending-form-draft.ts. Saved
   * against the same page `next` resolves to.
   */
  openSignInModal: (next?: string, draft?: Record<string, unknown>) => void;
  /** Same as openSignInModal, but opens straight to the "signup" view. */
  openSignUpModal: (next?: string, draft?: Record<string, unknown>) => void;
  closeSignInModal: () => void;
};

const AuthModalContext = createContext<AuthModalContextValue | null>(null);

/**
 * Mounts the shared sign-in modal once and exposes open/close via context —
 * see kelolako-dashboard-nonlogin-plan. Anything under this provider (the
 * (app) shell today) can call useAuthModal().openSignInModal() instead of
 * navigating to /login.
 */
export function AuthModalProvider({ children }: { children: React.ReactNode }) {
  const { status } = useCurrentUser();
  const [isOpen, setIsOpen] = useState(false);
  const [initialView, setInitialView] = useState<"signin" | "signup">("signin");
  const [next, setNext] = useState<string | undefined>(undefined);
  const [showSignedInToast, setShowSignedInToast] = useState(false);

  const openModal = useCallback(
    (view: "signin" | "signup", nextPath?: string, draft?: Record<string, unknown>) => {
      const resolvedNext =
        nextPath ?? (typeof window !== "undefined" ? window.location.pathname + window.location.search : "/dashboard");
      if (draft && typeof window !== "undefined") {
        // Keyed by pathname only (not the full next, which can carry query
        // params) — a draft only ever needs to survive a same-page round trip,
        // and matching on the bare path is more robust than an exact
        // path+query string match, which a redirect chain (our own callback
        // route, Supabase, or the browser) isn't guaranteed to reproduce
        // byte-for-byte.
        savePendingDraft(window.location.pathname, draft);
      }
      setInitialView(view);
      setNext(resolvedNext);
      setIsOpen(true);
    },
    [],
  );
  const openSignInModal = useCallback(
    (nextPath?: string, draft?: Record<string, unknown>) => openModal("signin", nextPath, draft),
    [openModal],
  );
  const openSignUpModal = useCallback(
    (nextPath?: string, draft?: Record<string, unknown>) => openModal("signup", nextPath, draft),
    [openModal],
  );
  const closeSignInModal = useCallback(() => setIsOpen(false), []);

  // Fires once per real sign-in, whether it came back via the Google
  // OAuth round-trip (full reload — this whole provider remounts) or the
  // in-place email/password path.
  useEffect(() => {
    if (status !== "authenticated") return;
    let flagged = false;
    try {
      flagged = sessionStorage.getItem(JUST_SIGNED_IN_FLAG) === "1";
      if (flagged) sessionStorage.removeItem(JUST_SIGNED_IN_FLAG);
    } catch {
      // ignore — private browsing etc.
    }
    if (!flagged) return;
    setShowSignedInToast(true);
    const t = setTimeout(() => setShowSignedInToast(false), 3500);
    return () => clearTimeout(t);
  }, [status]);

  const value = useMemo(
    () => ({ openSignInModal, openSignUpModal, closeSignInModal }),
    [openSignInModal, openSignUpModal, closeSignInModal],
  );

  return (
    <AuthModalContext.Provider value={value}>
      {children}
      <SignInModal open={isOpen} initialView={initialView} next={next} onClose={closeSignInModal} />
      {showSignedInToast && (
        <div
          role="status"
          aria-live="polite"
          // bottom-20, not bottom-6 — several pages (Scheduler, Calendar)
          // already mount their own local toast fixed to bottom-6/left-1/2
          // (e.g. Scheduler's "please re-attach your video" after a restored
          // draft, which can genuinely coincide with this one right after
          // sign-in); stacking one row higher keeps both visible instead of
          // overlapping.
          className="fixed bottom-20 left-1/2 z-[110] flex -translate-x-1/2 items-center gap-2.5 rounded-radius-lg border border-success/30 bg-success/10 px-spacing-lg py-spacing-md text-body-3 font-medium text-success shadow-elevation-02"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Successfully signed in
        </div>
      )}
    </AuthModalContext.Provider>
  );
}

export function useAuthModal(): AuthModalContextValue {
  const ctx = useContext(AuthModalContext);
  if (!ctx) {
    throw new Error("useAuthModal must be used within an AuthModalProvider");
  }
  return ctx;
}
