## 0. Config verification (manual — cannot be automated from the repo)

- [ ] 0.1 In Vercel → Project → Settings → Environment Variables, verify **Production** has: `RENDI_API_KEY`, `REPLICATE_API_TOKEN`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET` (or rely on the `krakatoa` default). _(User action — the agent has no Vercel access.)_
- [ ] 0.2 Confirm the Supabase Storage bucket's per-object size limit is ≥ 50 MB.

## 1. Browser Supabase client

- [x] 1.1 Add `lib/supabase-browser.ts`: lazily create a browser client from `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (`auth: { persistSession: false }`), used only for signed-URL uploads. Throw a clear error if the public env vars are missing.

## 2. Signed-upload endpoint

- [x] 2.1 Add `POST /api/upload/sign`: parse JSON `{ filename, contentType, size }`; validate `contentType` against the accepted MIME set and `size <= MAX_BYTES` (50 MB); build a unique `videos/<ts>-<safeName>` path; `supabaseServer.storage.from(bucket).createSignedUploadUrl(path)`; compute `getPublicUrl(path)`; return `{ bucket, path, token, publicUrl }`. Return JSON errors for 400/413/500.

## 3. Client direct upload (bypass the serverless body limit)

- [x] 3.1 Rewrite the upload step in `handleFilesAdded`: POST `/api/upload/sign` (small JSON), then `supabaseBrowser.storage.from(bucket).uploadToSignedUrl(path, token, file, { contentType: file.type })`; on success `updateItem(videoUrl = publicUrl, uploadStatus: "done")`.
- [x] 3.2 Robust error handling: guard the sign response (`res.ok` + safe parse via `.catch(() => null)`, no blind `res.json()`); map any sign/upload failure to `uploadStatus: "error"` + a readable `uploadError`.

## 4. Errored-card reuse (F3)

- [x] 4.1 In `handleAssetSelected`, broaden the reusable-card search to also match an errored card (`uploadStatus === "error" && !videoUrl`) so an asset pick replaces a failed upload in place instead of appending a new card.

## 5. Verification

- [x] 5.1 `tsc --noEmit` clean; no new lint errors. _(tsc exit 0; ReadLints clean on all 3 touched/new files.)_
- [ ] 5.2 Manual (READY TO TEST): in production, upload a video between ~5 MB and 50 MB → succeeds, previews, schedulable; no 413 / JSON-parse error.
- [ ] 5.3 Manual (READY TO TEST): trigger a failed upload, then pick an asset → the failed card is reused (no zombie card, not forced into bulk by the failure alone).
- [ ] 5.4 Manual (READY TO TEST): small device upload still previews + captures duration; existing single/bulk scheduling unchanged.
