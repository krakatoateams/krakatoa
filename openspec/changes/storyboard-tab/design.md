## Context

- **ReelsGen UI** (`app/tools/reels/page.tsx`): Client component with `engineTab` toggling Seedance vs Veo; both share `theme`, `loading`, `videoUrl`, `error`, `logs`. Seedance posts to `/api/generate`; Veo to `/api/generate-veo`. Result card uses `<video>` with `aspect-[9/16]` and download controls. Caption + narrator blocks are shared in the main form.
- **Main pipeline** (`app/api/generate/route.ts`): Uses `Replicate` with `replicate.run(model, { input: { ... } })`, a local `runWithRetry` for 429s, and `extractMediaUrl` for heterogeneous outputs. Seedance is invoked as `bytedance/seedance-2.0-fast` with **no** `reference_images` today (`aspect_ratio: "9:16"`, `generate_audio: false`).
- **Storage** (`lib/storage-buckets.ts`): Bucket default `krakatoa`; `videosStoragePath(filename)` → `videos/<filename>`; temp under `videos/temp/`. No storyboard subfolder helper yet.
- **Supabase** (`lib/supabase.ts`): `getSupabase()` with service role for server uploads.

## Goals / Non-Goals

**Goals:**

- Third tab **Storyboard** with a clear **two-phase** UX: (1) generate & review PNG storyboard, (2) generate 15s **16:9** Seedance video with **native audio**, using the storyboard as `reference_images`.
- Two focused API routes with explicit JSON contracts and Supabase persistence under `videos/storyboard/`.
- Reuse established patterns (Replicate auth, retry on 429, URL extraction, public storage URLs).

**Non-Goals:**

- Changing the existing `/api/generate` or `/api/generate-veo` behavior or caption/Rendi pipeline for Storyboard output.
- Authenticated per-user storyboard libraries or DB metadata (URLs-only MVP is enough unless product expands).
- Guaranteeing GPT Image 2 layout fidelity (model stochasticity); mitigation is **Generate Again**.

## Decisions

### 1. Replicate invocation for `openai/gpt-image-2` and `openai/gpt-5`

**Decision:** Use the same **`replicate.run("<owner>/<model>", { input: { ... } })`** pattern as `app/api/generate/route.ts`.

**Rationale:** The Replicate Node client is already the project standard; both models are hosted on Replicate under the `openai/` namespace.

**Alternatives considered:** Direct OpenAI HTTP API — rejected to keep one billing/token path and match user requirement.

**Implementation note:** Exact **input field names** for `gpt-image-2` (e.g. `prompt`, `aspect_ratio`, `quality`, image size) MUST be taken from the live Replicate model schema at implementation time. Web docs suggest text-to-image via `prompt` and constrained `aspect_ratio` enums (commonly `1:1`, `3:2`, `2:3`). A 6-panel “film strip” may fit **landscape (`3:2`)** best; if the product insists on literal **16:9** and the model does not offer it, choose the **closest supported ratio** and describe “six panels in one frame” strongly in the prompt.

**gpt-5 output shape:** Replicate chat/completion models often return **an array of string chunks** or a wrapped object — the handler MUST normalize to a **single string** (e.g. `Array.isArray(output) ? output.join("") : String(output)` plus trim) before passing to Seedance.

### 2. Seedance `reference_images` vs `image`

**Decision:** Use **`reference_images: [storyboardUrl]`** and **omit** `image` / `last_frame_image`.

**Rationale:** Official `llms.txt` for `bytedance/seedance-2.0-fast` states: `reference_images` is an optional array (up to 9) for “character consistency, style guidance, and scene composition,” and **cannot be combined with** `image` or `last_frame_image`. This matches the storyboard-as-style-reference product intent.

**Prompt coupling:** The same doc recommends labeling references in the prompt (e.g. `[Image1]`). The GPT-5 system instruction SHOULD require the prompt to treat the board as **[Image1]** so Seedance wiring matches documentation.

### 3. Shared helpers vs copy-paste

**Decision:** Prefer **minimal duplication** first: either copy the proven `extractMediaUrl` logic into a small `lib/replicate-media.ts` (if imported by multiple routes) or a private function per route. Optionally factor `runWithRetry` similarly if both new routes need it.

**Rationale:** `generate/route.ts` keeps helpers inline; extracting is justified only if two new routes + future reuse clearly benefit.

### 4. `storyboardUrl` passed into Seedance

**Decision:** Require **`https://`** `storyboardUrl` on `/api/generate-storyboard-video`; validate before calling Seedance.

**Rationale:** Replicate must fetch the reference image; Supabase public URLs are HTTPS. Reject `http:`, relative paths, or wrong host to fail fast.

### 5. UI state model

**Decision:** Extend `engineTab` union with `"storyboard"`. Add:

- `storyboardTheme: string` — dedicated field so switching tabs does not accidentally overwrite Seedance/Veo `theme` mid-flow (optional: sync on first load only — product choice: **isolated** is safer).
- `storyboardUrl: string | null`
- `storyboardLoading: boolean`
- `videoLoading: boolean` — only for `/api/generate-storyboard-video`

Disable storyboard actions appropriately when `storyboardLoading || videoLoading` to avoid double submits. Clear `videoUrl` when starting a **new** storyboard generation if product wants a fresh result stack; alternatively keep last video until replaced — spec defaults to updating on new success.

**Form submit:** Storyboard tab SHOULD **not** use the global “Generate Video” submit for Seedance/Veo; use explicit buttons to avoid accidental pipeline mixing.

**Conditional chrome:** When `engineTab === "storyboard"`, **hide** Seedance scene controls, Veo controls, Dev Pipeline Testing block, and optionally **Narrator + Caption Styler** (not used by this flow) to reduce confusion — align with “Non-Goals” (no caption pipeline for this MP4).

**Preview aspect:** Result `<video>` styling today assumes **9:16**. For Storyboard outputs, use **16:9** container (`aspect-video` / `aspect-[16/9]`) when `engineTab === "storyboard"` or when last successful run was storyboard (simplest: branch on tab).

### 6. Route `maxDuration` and timeouts

**Decision:** Set explicit `maxDuration` on both new routes (e.g. **300** for video route, lower acceptable for image-only) per Vercel limits; log step boundaries like the main route.

**Rationale:** User-facing copy promises up to ~2 minutes for video; the platform must allow sufficient wall time.

### 7. Storage path helpers

**Decision:** Add something like `VIDEOS_STORYBOARD_SEGMENT = "storyboard"` and `videosStoryboardPath(filename: string)` → `videos/storyboard/${filename}` in `lib/storage-buckets.ts`, or extend `videosStoragePath` with an overload — pick one style and document it in code comments next to existing `videos/` helpers.

## Risks / Trade-offs

- **[Risk] GPT Image 2 does not honor a strict 6-panel layout** → Mitigation: strong prompt + “Generate Again”; optional follow-up to add `gpt-image-2` `input_images` / quality knobs after testing.
- **[Risk] `aspect_ratio` for storyboard image not matching “wide board”** → Mitigation: pick closest Replicate-supported ratio; iterate after visual QA.
- **[Risk] `gpt-5` returns markdown or quotes around the prompt** → Mitigation: system prompt says “plain text only”; strip fences in post-processing like `extractJson`’s fence strip.
- **[Risk] Supabase URL not publicly readable** → Mitigation: use same public URL pattern as existing video uploads; document bucket policy requirement.
- **[Risk] Seedance with `reference_images` + long prompt + 15s + audio hits rate limits or timeouts** → Mitigation: reuse 429 retry; consider single-flight UI; surface Replicate error strings in API JSON.
- **[Risk] Indonesian dialogue in prompt vs model safety** → Mitigation: keep content policy messaging generic in API errors; no special client handling unless needed.
- **[Trade-off] 16:9 preview on a page optimized for vertical Reels** → Acceptable per feature; copy can clarify “horizontal cinematic clip.”

## Migration Plan

- No DB migration. Deploy new routes + UI + storage paths.
- Ensure Supabase bucket allows new prefix `videos/storyboard/` (usually automatic for public `videos/`).
- Rollback: remove tab and routes; orphaned objects can be lifecycle-cleaned later.

## Open Questions

1. Should **Generate Storyboard** clear the previous `videoUrl` immediately (recommended for clarity)?
2. Confirm final **`gpt-image-2`** input keys and allowed **`aspect_ratio`** values from Replicate at codegen time.
3. Whether to pass **`negative_prompt`** to Seedance for this flow (not requested; default omit unless QA needs it).
