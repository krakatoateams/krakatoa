## 1. Shared existence-check helper

- [x] 1.1 Move `storagePathFromPublicUrl` from `app/api/cron/route.ts` into `lib/storage-buckets.ts` (exported, pure — no Supabase client), update `app/api/cron/route.ts`'s existing usage (`cleanupPostVideo`) to import it from there instead of defining it locally.
- [x] 1.2 Add `videoObjectExists(path: string): Promise<boolean | null>` in a **new server-only file `lib/video-storage.ts`** (not `storage-buckets.ts` — see 1.2a) using `supabaseServer.storage.from(STORAGE_BUCKET).list(dirname, { search: basename, limit: 1 })`, returning `true`/`false` on a determinate result and `null` on any Storage API error.
- [x] 1.2a **Course-correction (found during manual testing):** `lib/storage-buckets.ts` is imported by client components too (`dashboard → RecentCreations → CreationsHistory → creation-model-label.ts → lib/product-photo.ts → storage-buckets.ts`). Initially `videoObjectExists`/`isVideoUrlConfirmedMissing` were added directly to `storage-buckets.ts` with a top-level `import { supabaseServer } from "@/lib/supabase-server"` — that import rode along into the client bundle, and since `SUPABASE_SERVICE_ROLE_KEY` doesn't exist in the browser, `createClient()` threw `supabaseKey is required` on every page reachable from that chain (reproduced: blank white screen on `/dashboard`). Fixed by moving the two Supabase-calling functions into `lib/video-storage.ts`, imported only by `app/api/posts/route.ts` and `app/api/cron/route.ts` (Route Handlers — never bundled to the client). `storage-buckets.ts` stays free of any server-secret-touching import; a comment now flags this constraint.
- [x] 1.3 Add a small helper (`isVideoUrlConfirmedMissing`, in `lib/video-storage.ts`) that combines the two: given a public URL, return `true` (exists or undeterminable/not-our-bucket) vs `false` (confirmed absent) — callers only need to branch on that boolean.

## 2. Schedule-create check

- [x] 2.1 In `app/api/posts/route.ts` `POST`, after `resolvedVideoUrl` is finalized and before `insertRow` is built, run the existence check against `resolvedVideoUrl`.
- [x] 2.2 On confirmed-absent, return `422 { error: "Video file no longer exists in storage. Please re-upload or regenerate the video." }` without inserting the post.
- [x] 2.3 On `null`/unparseable/check-error, proceed unchanged (fail open) — no new failure path introduced for ambiguous cases.

## 3. Publish-time check + permanent-failure classification

- [x] 3.1 In `app/api/cron/route.ts`, after the claim-lock and token lookup but before `uploadToYouTube`/`publishToTikTok`, run the same existence check against `post.video_url`.
- [x] 3.2 On confirmed-absent, throw `Error("Video file no longer exists in storage — it was deleted or swept before publishing.")` so it's caught by the existing `catch` block and follows the normal failure-recording path.
- [x] 3.3 Extend `isPermanentFailure` and `isTikTokPermanentFailure` to match `/video file no longer exists in storage|could not fetch video from storage/i` as permanent.

## 4. Verification

- [x] 4.1 `tsc --noEmit` clean; no new lint errors.
- [x] 4.2 Verified: `POST /api/posts` against the known-missing `video_1782820848577.mp4` → `422 {"error":"Video file no longer exists in storage. Please re-upload or regenerate the video."}`, and confirmed no `posts` row was created.
- [x] 4.3 Verified: scheduled + published real "Testing Reels" posts (YouTube + TikTok) against an existing video through the live UI — scheduling and publishing both succeeded unchanged.
- [ ] 4.4 Not directly tested (delete-after-scheduling → immediate `failed` on first cron attempt). Low risk: reuses the exact `isVideoUrlConfirmedMissing` path already verified in 4.2.
- [ ] 4.5 Not done — the two original "testing scheduler" posts are still sitting in `failed` with the old generic message; left as-is (optional retry, not required for this change).
