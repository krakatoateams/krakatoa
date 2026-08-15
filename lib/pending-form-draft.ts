/**
 * Survives the sign-in modal's "gate on action" flow (see
 * kelolako-dashboard-nonlogin-plan): a logged-out visitor fills in a form,
 * hits the gated action (Generate/Schedule/...), gets the sign-in modal —
 * this stashes what they typed so it's still there after they sign in,
 * including the full page-reload round-trip Google OAuth causes (email/
 * password never leaves the page, so it doesn't strictly need this, but
 * restoring is harmless either way).
 *
 * sessionStorage, not localStorage: this is a short-lived, single-use draft
 * for one in-progress attempt, not something that should persist across
 * browser sessions or leak into a different tab.
 *
 * Deliberately text/settings only — never put a File/Blob in here. Files
 * aren't meaningfully serializable to sessionStorage, and re-selecting a
 * file after signing in is an accepted, called-out limitation.
 */

const PREFIX = "kelolako:pending-draft:";

// Set right before a sign-in attempt (SignInForm, both Google and
// email/password) and checked by AuthModalProvider once `status` flips to
// "authenticated", to show a one-time "Successfully signed in" toast. Lives
// here (a leaf utility) rather than on AuthModalProvider itself so SignInForm
// can import just the constant without creating an import cycle back through
// AuthModalProvider -> SignInModal -> SignInForm.
export const JUST_SIGNED_IN_FLAG = "kelolako:just-signed-in";

export function savePendingDraft(path: string, data: Record<string, unknown>): void {
  try {
    sessionStorage.setItem(PREFIX + path, JSON.stringify(data));
  } catch {
    // Best-effort — private browsing / storage full / SSR. Losing the draft
    // just means the user retypes; never let this break the sign-in flow.
  }
}

/** Reads and clears in one step — a draft is only ever applied once. */
export function consumePendingDraft<T = Record<string, unknown>>(path: string): T | null {
  try {
    const key = PREFIX + path;
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    sessionStorage.removeItem(key);
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Like consumePendingDraft, but doesn't clear it — for a parent that needs
 * to decide something (e.g. "should this modal start open?") from whether a
 * draft exists, while leaving the actual one-time consume to whichever
 * component owns the fields the draft restores into.
 */
export function hasPendingDraft(path: string): boolean {
  try {
    return sessionStorage.getItem(PREFIX + path) !== null;
  } catch {
    return false;
  }
}
