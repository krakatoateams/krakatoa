## Why

When generating a caption, the UI warns "No audio detected" even for videos that clearly have sound. The warning is driven by a single boolean, `usedTranscript = !!transcript`, but `transcript` becomes `null` in two very different situations that the code conflates:

1. the video genuinely has no audio track, **or**
2. the Rendi audio-extraction / Whisper transcription step **threw and was swallowed** by the route's soft-fail `catch` (e.g. a missing `RENDI_API_KEY` in production, a Rendi/Replicate error, or a timeout).

In production this most often hits case (2) — the pipeline throws, the route falls back to a generic title/tags-only caption, and the user is told "No audio detected," which is misleading and erodes trust. The server already logs the real reason but the client never learns it.

## What Changes

- **Server:** `/api/generate-caption` returns a richer `transcriptStatus: "ok" | "no_audio" | "failed"` (keeping `usedTranscript` for backward compatibility) so the client can tell *transcription failed* apart from *no audio present*.
  - `"ok"` — transcript text was produced.
  - `"no_audio"` — the pipeline ran but produced an empty transcript (genuinely silent / no speech).
  - `"failed"` — audio extraction or Whisper threw (the soft-fail path).
- **Client:** the caption controls render an accurate message per status:
  - `failed` → "Couldn't read the audio this time — caption was generated from your title & tags. Try again." (retryable tone, not a false claim).
  - `no_audio` → the existing "No audio detected …" wording.
  - `ok` → no warning.
- **Out of scope (tracked elsewhere):** the production env fix (`RENDI_API_KEY` etc. in Vercel) is a config action in `fix-upload-resilience`'s checklist, not code here. This change makes the failure *honest and actionable* regardless of root cause.

## Capabilities

### New Capabilities

- `fix-caption-transcript-feedback`: Distinguish "transcription failed" from "no audio present" in the caption generator and surface an accurate, actionable message to the user.

### Modified Capabilities

- _(none — the caption helper has no archived spec baseline in `openspec/specs/`.)_

## Impact

- **Backend:** `app/api/generate-caption/route.ts` — compute and return `transcriptStatus` alongside the existing `usedTranscript`; differentiate the soft-fail `catch` (failed) from an empty transcript (no_audio).
- **Frontend:** `app/(app)/tools/scheduler/page.tsx` — `useCaptionAI` tracks the status; `CaptionControls` renders the status-specific message. (DescriptionCard reuses the shared hook.)
- **Risk:** low; additive field with a backward-compatible default. No change to the generation pipeline or models.
- **Out of scope:** investigating *why* Rendi/Whisper fails in prod (config/logs); bumping `maxDuration` / Rendi poll budget (optional, noted in design).
