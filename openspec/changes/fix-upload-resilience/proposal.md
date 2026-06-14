## Why

The scheduler's device-upload is broken in production (Vercel) for any reasonably sized video. The client advertises a 50 MB cap, but Vercel serverless functions reject request bodies larger than ~4.5 MB **before** `/api/upload` runs, returning a plain-text `Request Entity Too Large` (413). The client then calls `res.json()` unconditionally and surfaces a cryptic `Failed to execute 'json' on 'Response': Unexpected token 'R'...` instead of a useful message. On localhost there is no body cap, so the bug is invisible in dev.

Two follow-on problems compound it:
- The error message is unintelligible (raw JSON-parse failure), so users can't tell what went wrong.
- A **failed** upload leaves a card holding a `File` but no `videoUrl`. The asset picker's "empty card" test (`!file && !videoUrl`) treats that card as occupied, so picking an asset **appends** a new card and forces bulk mode with a stuck, un-schedulable zombie card.

## What Changes

- **Direct-to-Supabase signed upload (real 50 MB in prod):** the browser uploads the file straight to Supabase Storage using a short-lived signed upload URL minted by the server, so the file never transits the Vercel function body and the ~4.5 MB limit no longer applies.
  - New server route `POST /api/upload/sign` validates filename/MIME/declared size (server-side `MAX_BYTES`), generates a unique `videos/` path, creates a signed upload URL with the service role, and returns `{ bucket, path, token, publicUrl }`.
  - New `lib/supabase-browser.ts` exposes a lazily-created browser client (anon key) used only for `uploadToSignedUrl`.
  - `handleFilesAdded` is rewritten to: request a signed URL (tiny JSON), upload the bytes directly to Storage, then store the returned public URL — no `/api/upload` file POST.
- **Robust error handling:** the sign request and the storage upload no longer assume a JSON body; failures (non-OK status, non-JSON, storage error) surface a clear `item.uploadError` message instead of a JSON-parse exception.
- **Errored-card reuse (F3):** `handleAssetSelected` treats an errored card (`uploadStatus === "error"` with no `videoUrl`) as reusable, so picking an asset **replaces** a failed upload in place instead of appending a zombie card.
- **Config (manual, not code):** verify the Production env vars in Vercel (`RENDI_API_KEY`, `REPLICATE_API_TOKEN`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`).

## Capabilities

### New Capabilities

- `fix-upload-resilience`: Upload videos directly to Supabase Storage via a server-minted signed URL (bypassing the serverless body limit), with clear upload error messages and correct recovery when an asset is picked after a failed upload.

### Modified Capabilities

- _(none — the scheduler upload flow was introduced by `bulk-scheduling`/`schedule-from-assets`, neither archived into `openspec/specs/`, so there is no spec baseline to amend.)_

## Impact

- **Frontend:** `app/(app)/tools/scheduler/page.tsx` — `handleFilesAdded` uploads via signed URL; error states surface friendly messages; `handleAssetSelected`'s reuse check includes errored cards.
- **Backend:** new `app/api/upload/sign/route.ts`. The legacy `app/api/upload/route.ts` becomes unused by the scheduler but is left in place (harmless; other tooling/manual use may rely on it).
- **Lib:** new `lib/supabase-browser.ts` (browser anon client).
- **Config:** requires `NEXT_PUBLIC_SUPABASE_ANON_KEY` present in every environment (already documented in `README.md`/`CLAUDE.md`).
- **Risk:** browser→Supabase CORS and the anon-key client are new in this codebase; Supabase Storage permits signed-URL uploads with the anon key + token. Verify in production. Signed URL is single-use and path-unique, so no upsert/race concerns.
- **Out of scope:** caption transcription feedback (separate change `fix-caption-transcript-feedback`); multi-select asset picking; changing `/api/posts` scheduling.
