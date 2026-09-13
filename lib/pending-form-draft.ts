/**
 * Survives the sign-in modal's "gate on action" flow (see
 * kelolako-dashboard-nonlogin-plan): a logged-out visitor fills in a form,
 * hits the gated action (Generate/Schedule/...), gets the sign-in modal —
 * this stashes what they typed so it's still there after they sign in,
 * including the full page-reload round-trip Google OAuth causes.
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

// An older flow copied draft JSON into `?kdraft=` during OAuth. That exposed
// prompts/settings to browser, platform, and identity-provider URL logs.
// Drafts are now same-tab sessionStorage only; strip legacy or attacker-crafted
// params when a consumer mounts, but never read them.
const LEGACY_URL_DRAFT_PARAM = "kdraft";

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
 * Reads and clears in one step — a draft is only ever applied once.
 */
function stripDraftFromUrl(): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (!params.has(LEGACY_URL_DRAFT_PARAM)) return;
  params.delete(LEGACY_URL_DRAFT_PARAM);
  const query = params.toString();
  const cleanUrl =
    window.location.pathname + (query ? `?${query}` : "") + window.location.hash;
  window.history.replaceState(null, "", cleanUrl);
}

function consumePendingDraftMatching<T>(
  path: string,
  accepts: (draft: unknown) => boolean,
): T | null {
  stripDraftFromUrl();
  try {
    const key = PREFIX + path;
    const raw = sessionStorage.getItem(key);
    if (raw) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        sessionStorage.removeItem(key);
        return null;
      }
      if (!accepts(parsed)) return null;
      sessionStorage.removeItem(key);
      return parsed as T;
    }
  } catch (e) {
    console.warn("[pending-form-draft] consume (sessionStorage) failed:", e);
  }
  return null;
}

export function consumePendingDraft<T = Record<string, unknown>>(path: string): T | null {
  return consumePendingDraftMatching(path, () => true);
}

/**
 * Consume a pathname-scoped draft only when it belongs to this form.
 *
 * Several video composers can mount on the same pathname. The owner marker
 * prevents an earlier sibling effect from taking another composer's draft.
 */
export function consumePendingDraftForOwner<T = Record<string, unknown>>(
  path: string,
  owner: string,
): T | null {
  return consumePendingDraftMatching(
    path,
    (draft) =>
      !!draft &&
      typeof draft === "object" &&
      (draft as Record<string, unknown>).draftOwner === owner,
  );
}

/**
 * Like consumePendingDraft, but doesn't clear it — for a parent that needs
 * to decide something (e.g. "should this modal start open?") from whether a
 * draft exists, while leaving the actual one-time consume to whichever
 * component owns the fields the draft restores into.
 *
 * SessionStorage only. URL-provided drafts are deliberately ignored.
 */
export function hasPendingDraft(path: string): boolean {
  try {
    return sessionStorage.getItem(PREFIX + path) !== null;
  } catch {
    return false;
  }
}

/** Non-consuming owner check for a same-tab draft. */
export function hasPendingDraftForOwner(path: string, owner: string): boolean {
  try {
    const raw = sessionStorage.getItem(PREFIX + path);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return parsed?.draftOwner === owner;
    }
  } catch {
    try {
      sessionStorage.removeItem(PREFIX + path);
    } catch {
      // Storage unavailable.
    }
    return false;
  }
  return false;
}

/** Return a stored owner without consuming the draft. */
export function pendingDraftOwner(path: string): string | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + path);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as Record<string, unknown>).draftOwner === "string"
    ) {
      return (parsed as Record<string, string>).draftOwner;
    }
    return null;
  } catch {
    try {
      sessionStorage.removeItem(PREFIX + path);
    } catch {
      // Storage unavailable.
    }
    return null;
  }
}
