## 1. ReelsGen "Schedule to YouTube" button

- [x] 1.1 In the "Final Result" card (`{videoUrl && (...)}` block of `app/(app)/tools/reels/page.tsx`), add a "Schedule to YouTube" action gated on `!resultIsStoryboardFormat` so it shows only for vertical 9:16 reels.
- [x] 1.2 Build the destination URL as `/tools/scheduler?assetUrl=${encodeURIComponent(videoUrl)}&title=${encodeURIComponent(theme)}` (omit/empty `title` when `theme` is blank). _(Title param omitted entirely when `theme` is blank.)_
- [x] 1.3 Use Next.js client navigation (`Link` or `useRouter().push`) for the hand-off; place the action alongside the existing Download / Save-to-Gallery controls. _(Used `next/link` `Link`, emerald button below "Save to Gallery".)_
- [x] 1.4 Confirm storyboard results (16:9) render no scheduling button. _(Gated by `!resultIsStoryboardFormat`; storyboard paths set the flag true.)_

## 2. Scheduler deep-link intake (Suspense + fire-once)

- [x] 2.1 Add a child reader component in `app/(app)/tools/scheduler/page.tsx` that calls `useSearchParams()` and reads `assetUrl` and `title`. _(`DeepLinkIntake` component; `searchParams.get()` already URL-decodes, so no manual `decodeURIComponent`.)_
- [x] 2.2 Wrap that reader in `<Suspense fallback={null}>` so the route satisfies the App Router `useSearchParams()` requirement.
- [x] 2.3 Add a `useRef` "consumed" flag; on mount, if not consumed and `assetUrl` is present, set the flag and call `handleAssetSelected(...)` exactly once (StrictMode-safe).
- [x] 2.4 When `title` is present, pre-fill the resulting card's title by locating the item whose `videoUrl` matches the `assetUrl` and updating it — without modifying `handleAssetSelected` itself. _(Match-by-`videoUrl` via a follow-up `setItems` functional update that sees the queued asset insert; first match only.)_
- [x] 2.5 (Optional polish) `router.replace` to strip the params after consumption. _(Included per request: `router.replace("/tools/scheduler")`.)_

## 3. Verification

- [x] 3.1 `tsc --noEmit` clean; no new lint errors. _(tsc exit 0; lint shows only 3 pre-existing exhaustive-deps warnings unrelated to this change.)_
- [ ] 3.2 Manual (READY TO TEST): Generate a Seedance/Veo reel → "Schedule to YouTube" appears → click → scheduler opens with the asset loaded as a card and the title pre-filled; no `/api/upload` request fired.
- [ ] 3.3 Manual (READY TO TEST): Generate a storyboard video → confirm NO scheduling button is shown.
- [ ] 3.4 Manual (READY TO TEST): Open the scheduler with `?assetUrl=...&title=...` directly → asset loads exactly once; refresh / StrictMode does not duplicate the card.
- [ ] 3.5 Manual (READY TO TEST): Open the scheduler with no params → behavior identical to before (no auto-load).
- [ ] 3.6 Manual (READY TO TEST): Confirm an asset >60s still triggers the existing amber Shorts warning once duration is read.
