## Context

`handleFilesAdded` in `app/(app)/tools/scheduler/page.tsx` currently POSTs each `File` to `/api/upload` as `multipart/form-data`. `/api/upload/route.ts` validates MIME + 50 MB, uploads to Supabase Storage with the **service role**, and returns the public URL. On Vercel, serverless functions reject request bodies over ~4.5 MB before the handler runs, returning plain-text `Request Entity Too Large` (413); the client's `await res.json()` then throws on the leading `R`. Localhost has no such cap, hiding the bug.

Supabase Storage supports **signed upload URLs**: a privileged caller (service role) mints a one-time token for a specific path via `createSignedUploadUrl(path)`, and an unprivileged client uploads the bytes directly to Storage via `uploadToSignedUrl(path, token, file)`. Because the upload goes browser → Supabase, it never passes through the Vercel function body, so the 4.5 MB limit does not apply — only Supabase's own (much larger) object size limits.

`@supabase/supabase-js@^2.105.4` supports both APIs. The repo has no browser Supabase client yet (`lib/supabase.ts` and `lib/supabase-server.ts` both use the service role and are server-only). `NEXT_PUBLIC_SUPABASE_ANON_KEY` is already a documented env var.

## Goals / Non-Goals

**Goals:**
- Real 50 MB uploads in production by bypassing the serverless body limit.
- Clear, non-cryptic upload error messages.
- Picking an asset after a failed upload replaces the failed card (no zombie / forced bulk).

**Non-Goals:**
- Caption/transcription changes (separate change).
- Multi-select asset picking; changes to scheduling or `/api/posts`.
- Removing the legacy `/api/upload` route (left in place, just unused by the scheduler).

## Decisions

### 1. Direct-to-Supabase signed upload (answer to F2 approach)
Flow:
```
browser handleFilesAdded(file)
   │  POST /api/upload/sign  { filename, contentType, size }   (tiny JSON, no file)
   ▼
server (service role): validate MIME + size; build unique videos/<ts>-<safe>.ext;
   createSignedUploadUrl(path) → { signedUrl, token, path };
   getPublicUrl(path) → publicUrl
   │  returns { bucket, path, token, publicUrl }
   ▼
browser: supabaseBrowser.storage.from(bucket).uploadToSignedUrl(path, token, file, { contentType })
   │  bytes go browser → Supabase (NOT through the Vercel function)
   ▼
on success → updateItem(videoUrl = publicUrl, uploadStatus: "done")
```
The server keeps the authoritative MIME + `MAX_BYTES` checks (the client size check is advisory). The path stays unique (`Date.now()-safeName`) so the single-use signed URL never collides; no upsert.

### 2. Browser client is anon-key, upload-only
`lib/supabase-browser.ts` lazily creates `createClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })`. It is used solely for `uploadToSignedUrl`; the write is authorized by the server-minted token, not by the anon key, so no Storage policy changes are required. The service role is never exposed to the browser.

### 3. Robust response handling (answer to F1)
Neither the sign request nor the storage upload assumes a JSON body:
- Sign request: check `res.ok`; on failure, read text defensively and throw a friendly `Error` (e.g. "Couldn't start the upload (server error)"). Never blind `res.json()` on a possibly-non-JSON error.
- Storage upload: `uploadToSignedUrl` returns `{ error }`; map it to `item.uploadError`.
All failures land in the existing per-item `uploadStatus: "error"` + `uploadError` UI. The cryptic JSON-parse path is structurally removed because the large file no longer hits a serverless function that can 413.

### 4. Errored-card reuse (answer to F3)
`handleAssetSelected`'s "find a reusable card" test changes from:
```
items.findIndex((i) => !i.file && !i.videoUrl)
```
to also accept an errored card:
```
items.findIndex((i) =>
  (!i.file && !i.videoUrl) ||
  (i.uploadStatus === "error" && !i.videoUrl)
)
```
So picking an asset replaces a failed upload in place (clearing its `file`/error via the existing `assetPatch`, which already sets `file: null, uploadError: null, uploadStatus: "done"`), instead of appending a new card and forcing bulk mode.

### 5. Config verification is a manual prerequisite
The production root cause for the *original* 413 is structural (body limit), fixed by Decisions 1–2. But the broader prod/localhost divergence (and the sibling caption bug) is env-driven. Verifying Vercel env vars is a manual checklist item — it cannot be automated from the repo and is marked as such in tasks.

## Risks / Trade-offs

- **CORS / anon upload** → Supabase Storage permits signed-URL uploads with the anon key + token; must be verified against the production project. If a bucket/project blocks it, the fallback is to proxy through a route again (but that reintroduces the body limit).
- **Two round-trips** (sign, then upload) vs one → negligible; the sign call is tiny.
- **Legacy `/api/upload` left unused** → minor dead-code smell; kept to avoid breaking any other caller. Can be removed in a later cleanup.
- **New required public env var** (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) → already documented; missing-in-prod would fail uploads with a clear client error now (not a silent JSON crash).

## Open Questions

- Should the legacy `/api/upload` route be deleted now or in a follow-up? (Deferred: keep for safety.)
- Supabase per-object size ceiling for the bucket (separate from the function limit) — confirm it is ≥ 50 MB in the project settings during verification.
