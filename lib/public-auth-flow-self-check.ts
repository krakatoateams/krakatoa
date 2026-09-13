import { readFileSync } from "node:fs";

const rootUrl = new URL("../", import.meta.url);

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, rootUrl), "utf8");
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`public-auth-flow self-check: ${message}`);
}

export function publicAuthFlowSelfCheck(): void {
  const signIn = read("components/auth/SignInForm.tsx");
  const signUp = read("components/auth/SignUpForm.tsx");
  const signInModal = read("components/auth/SignInModal.tsx");
  const forgotPassword = read("components/auth/ForgotPasswordForm.tsx");
  const resetPassword = read("components/auth/ResetPasswordModal.tsx");
  const recoveryStateRoute = read(
    "app/api/auth/recovery-state/route.ts",
  );
  const signInRoute = read("app/api/auth/signin/route.ts");
  const middleware = read("middleware.ts");
  const drafts = read("lib/pending-form-draft.ts");
  const photo = read("app/(app)/tools/photo-v2/page.tsx");
  const legacyPhoto = read("app/(app)/tools/photo/page.tsx");
  const video = read("app/(app)/tools/video/VideoStudioShell.tsx");
  const motion = read(
    "app/(app)/tools/video/composers/MotionControlComposer.tsx",
  );
  const scheduler = read(
    "app/(app)/tools/scheduler/SchedulerPageClient.tsx",
  );
  const callback = read("app/auth/callback/route.ts");

  assert(
    !signIn.includes("peekPendingDraftRaw") &&
      !signUp.includes("peekPendingDraftRaw") &&
      !signIn.includes("kdraft") &&
      !signUp.includes("kdraft"),
    "OAuth redirects must never carry raw user drafts",
  );
  assert(
    signIn.includes("const safeNext = sanitizeNextPath(next)") &&
      signUp.includes("const safeNext = sanitizeNextPath(next)") &&
      !signIn.includes("encodeURIComponent(next)") &&
      !signUp.includes("encodeURIComponent(next)"),
    "auth forms must sanitize redirect targets at their own boundary",
  );
  assert(
    !drafts.includes("params.get(URL_FALLBACK_PARAM)") &&
      !drafts.includes("peekPendingDraftRaw"),
    "unsigned URL drafts must not be consumed or exported",
  );
  assert(
    photo.includes("PHOTO_DRAFT_OWNER.storyboard") &&
      photo.includes("PHOTO_DRAFT_OWNER.studio") &&
      photo.includes("consumePendingDraftForOwner") &&
      photo.includes("pendingDraftOwner") &&
      photo.includes("batchCount?: (typeof BATCH_COUNTS)[number]"),
    "Photo composers must own and restore their pathname-shared drafts",
  );
  assert(
    video.includes("pendingDraftOwner") &&
      video.includes('"video:motion-control"'),
    "Video Studio must reopen the composer that owns the pending draft",
  );
  assert(
    motion.includes("modelId?: MotionControlModelId") &&
      motion.includes("draft.modelId") &&
      motion.includes("modelId,"),
    "Motion Control must restore every non-file model setting",
  );
  assert(
    legacyPhoto.includes("searchParams") &&
      legacyPhoto.includes("URLSearchParams"),
    "the legacy Photo redirect must preserve deep-link query parameters",
  );
  assert(
    scheduler.includes("requireAuthForCaption") &&
      scheduler.match(/if \(!requireAuthForCaption\(\)\) return;/g)?.length ===
        2,
    "Scheduler caption generation and polish must share the logged-out gate",
  );
  assert(
    callback.includes("authCallbackFailureUrl(origin, next)"),
    "an OAuth retry must preserve its sanitized destination",
  );
  assert(
    signInModal.includes("<ForgotPasswordForm") &&
      signInModal.includes("next={next}") &&
      forgotPassword.includes("passwordResetCallbackUrl(") &&
      resetPassword.includes("passwordResetDestination("),
    "modal password recovery must resume its sanitized gated destination",
  );
  assert(
    signIn.includes("skipBrowserRedirect: true") &&
      signUp.includes("skipBrowserRedirect: true") &&
      signIn.includes("if (error || !data.url)") &&
      signUp.includes("if (error || !data.url)") &&
      signIn.includes("window.location.assign(data.url)") &&
      signUp.includes("window.location.assign(data.url)"),
    "Google OAuth must surface start failures before leaving the page",
  );
  assert(
    signInModal.includes("onBusyChange={setBusy}") &&
      signInModal.includes("closeDisabled={busy}") &&
      resetPassword.includes(
        'href={`/forgot-password?next=${encodeURIComponent(next)}`}',
      ) &&
      (signIn.match(/disabled=\{busy\}/g)?.length ?? 0) >= 2 &&
      signIn.includes(
        'disabled={busy || loginError?.kind === "too_many_attempts"}',
      ),
    "in-flight modal auth must stay locked and invalid reset retries must retain next",
  );
  assert(
    callback.includes("PASSWORD_RECOVERY_PROOF_COOKIE") &&
      callback.includes("httpOnly: true") &&
      recoveryStateRoute.includes("PASSWORD_RECOVERY_PROOF_COOKIE") &&
      recoveryStateRoute.includes('maxAge: 0') &&
      recoveryStateRoute.includes("export async function PATCH") &&
      recoveryStateRoute.includes("updateUser({ password })") &&
      recoveryStateRoute.includes('signOut({ scope: "local" })') &&
      signInRoute.includes("PASSWORD_RECOVERY_PROOF_COOKIE") &&
      signInRoute.includes("maxAge: 0") &&
      resetPassword.includes('fetch("/api/auth/recovery-state"') &&
      resetPassword.includes('method: "PATCH"') &&
      !resetPassword.includes("supabase.auth.updateUser"),
    "password reset UI must require callback proof and sign out on dismissal",
  );
  assert(
    !signInRoute.includes("attemptsRemaining:"),
    "failed sign-in responses must not expose the lockout counter",
  );
  assert(
    middleware.includes("passwordRecoveryDestinationFromProof") &&
      middleware.includes("PASSWORD_RECOVERY_REQUIRED") &&
      middleware.includes('"/api/:path*"'),
    "a recovery-created session must stay gated from app pages and APIs until reset completes",
  );
}

publicAuthFlowSelfCheck();
console.log("public-auth-flow self-check passed");
