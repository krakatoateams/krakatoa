## Context

`app/api/generate-caption/route.ts` (generate mode) optionally builds a transcript: it calls `extractAudioMp3` (Rendi) then Whisper, wrapped in a `try/catch` that **soft-fails** to `transcript = null` on any error, then generates the caption from whatever context exists. It returns `usedTranscript: !!transcript`.

The client (`useCaptionAI` + `CaptionControls` in `app/(app)/tools/scheduler/page.tsx`, mirrored in `tools/reels` usage) shows a warning when `lastUsedTranscript === false`. Because `transcript === null` covers both "no audio" and "extraction/Whisper threw", the UI always says "No audio detected" — misleading when the real cause is a thrown error (common in production, e.g. missing `RENDI_API_KEY`).

## Goals / Non-Goals

**Goals:**
- The server distinguishes three outcomes: transcript produced, ran-but-empty, or threw.
- The client message is accurate and actionable for each.
- Backward compatible (keep `usedTranscript`).

**Non-Goals:**
- Fixing the production env/root cause (config; tracked in `fix-upload-resilience`).
- Changing models, prompts, or the soft-fail behavior itself (we still return a caption).

## Decisions

### 1. Add `transcriptStatus: "ok" | "no_audio" | "failed"`
Compute in the route:
```
let transcriptStatus: "ok" | "no_audio" | "failed" = "no_audio";
if (videoUrl) {
  try {
    const audioUrl = await extractAudioMp3(sourceUrl);
    const wRes = await runWithRetry(...);
    const text = extractTranscript(wRes);
    if (text.length > 0) { transcript = text; transcriptStatus = "ok"; }
    else { transcript = null; transcriptStatus = "no_audio"; }
  } catch (err) {
    transcript = null;
    transcriptStatus = "failed";   // ← the previously-conflated case
    console.warn(...);
  }
}
// when no videoUrl was provided at all, status stays "no_audio" (nothing to transcribe)
```
Response: `{ caption, usedTranscript: !!transcript, transcriptStatus }`. `usedTranscript` is retained so any other caller keeps working.

### 2. Client tracks status and renders an accurate message
`useCaptionAI` adds `lastTranscriptStatus` (default `null`), set from `data.transcriptStatus` on generate (left `null` for general/polish, which never transcribe). `CaptionControls` renders:
- `failed` → "⚠️ Couldn't read the audio this time — caption was generated from your title & tags. Try again." (retryable framing; does NOT claim there is no audio).
- `no_audio` → existing wording (title present: informational "🎵 No audio detected — generated from title & tags"; no title: the amber "no audio + no title" hint).
- `ok` / `null` → no warning.

`lastUsedTranscript` can remain for compatibility, but the rendering switches to `lastTranscriptStatus` for the generate flow. Keep the change minimal and localized to the hook + the warning block.

### 3. Optional timeout hardening (noted, not required)
The caption route declares `maxDuration = 120`, while Rendi polls up to ~6 min. On Vercel Hobby (≤ 300s cap) a *successful but slow* transcription could still be killed. Optional follow-up: raise `maxDuration` toward 300 and/or lower the Rendi poll budget for this route. Not required to fix the misleading message and left out of the core tasks.

## Risks / Trade-offs

- **Low risk:** additive response field; default preserves current behavior for any unaware caller.
- **Doesn't fix the root prod failure** by itself — but makes it visible/honest and pairs with the env verification in `fix-upload-resilience`.

## Open Questions

- Exact copy for the `failed` message (placeholder above; easy to tweak).
- Whether to also expose `transcriptStatus` in the `tools/reels` caption surface (same hook is scheduler-local; reels has its own usage) — out of scope unless it shares the component.
