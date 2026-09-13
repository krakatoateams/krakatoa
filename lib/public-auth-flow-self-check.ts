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
}

publicAuthFlowSelfCheck();
console.log("public-auth-flow self-check passed");
