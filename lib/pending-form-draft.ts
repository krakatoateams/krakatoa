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

// URL-embedded fallback for the Google OAuth round trip specifically — see
// SignInForm.handleGoogleSignIn and consumePendingDraft's URL fallback below.
// sessionStorage can fail to survive that redirect in some browser
// configurations (Safari ITP, private browsing, a storage-blocking
// extension); a copy riding in the actual navigation URL survives regardless
// of storage API behavior. Not used for email/password, which never leaves
// the page and so never loses its React state to begin with.
const URL_FALLBACK_PARAM = "kdraft";
// Keeps the redirect URL comfortably short — every draft payload observed in
// this app (prompt/settings text, never a File) fits well under this.
const URL_FALLBACK_MAX_CHARS = 1500;

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
  } catch (e) {
    // Best-effort — private browsing / storage full / SSR. Losing the draft
    // just means the user retypes; never let this break the sign-in flow.
    // Logged (not swallowed silently) so a report of "it didn't restore" is
    // diagnosable from the browser console instead of a total black box.
    console.warn("[pending-form-draft] save failed:", e);
  }
}

/**
 * Reads and clears in one step — a draft is only ever applied once. Tries
 * sessionStorage first (the normal path, and the only one email/password
 * needs); if that comes back empty, falls back to a copy riding in the
 * current URL's `kdraft` param (only ever present right after the Google
 * OAuth round trip — see SignInForm.handleGoogleSignIn) and strips it from
 * the visible URL afterward without a navigation.
 */
export function consumePendingDraft<T = Record<string, unknown>>(path: string): T | null {
  try {
    const key = PREFIX + path;
    const raw = sessionStorage.getItem(key);
    if (raw) {
      sessionStorage.removeItem(key);
      return JSON.parse(raw) as T;
    }
  } catch (e) {
    console.warn("[pending-form-draft] consume (sessionStorage) failed:", e);
  }

  if (typeof window === "undefined") return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get(URL_FALLBACK_PARAM);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as T;
    params.delete(URL_FALLBACK_PARAM);
    const query = params.toString();
    const cleanUrl =
      window.location.pathname + (query ? `?${query}` : "") + window.location.hash;
    window.history.replaceState(null, "", cleanUrl);
    return parsed;
  } catch (e) {
    console.warn("[pending-form-draft] consume (URL fallback) failed:", e);
    return null;
  }
}

/**
 * Like consumePendingDraft, but doesn't clear it — for a parent that needs
 * to decide something (e.g. "should this modal start open?") from whether a
 * draft exists, while leaving the actual one-time consume to whichever
 * component owns the fields the draft restores into.
 *
 * sessionStorage only — deliberately does NOT check the URL fallback the
 * way consumePendingDraft does: `kdraft` isn't namespaced by path, so on a
 * page with more than one independently-keyed draft (e.g. the video page's
 * per-composer keys vs. its storyboard-import sub-key) a URL fallback meant
 * for one key would false-positive every other key's existence check.
 */
export function hasPendingDraft(path: string): boolean {
  try {
    return sessionStorage.getItem(PREFIX + path) !== null;
  } catch {
    return false;
  }
}

/**
 * Raw (still-JSON, non-consuming) peek — used only to embed a copy of the
 * draft into the Google OAuth redirect URL right before leaving the page
 * (see SignInForm.handleGoogleSignIn). Returns null if there's no draft for
 * this path, sessionStorage is unavailable, or the draft is unexpectedly
 * large (keeps the redirect URL short).
 */
export function peekPendingDraftRaw(path: string): string | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + path);
    if (!raw || raw.length > URL_FALLBACK_MAX_CHARS) return null;
    return raw;
  } catch {
    return null;
  }
}
