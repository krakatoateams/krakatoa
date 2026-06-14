## 1. Server: transcript status

- [x] 1.1 In `app/api/generate-caption/route.ts` (generate mode), track `transcriptStatus: "ok" | "no_audio" | "failed"`: set `ok` when Whisper returns non-empty text, `no_audio` when it runs but is empty (or no `videoUrl`), and `failed` in the soft-fail `catch`.
- [x] 1.2 Include `transcriptStatus` in the success response alongside the existing `usedTranscript` (kept for backward compatibility).

## 2. Client: accurate message

- [x] 2.1 In `useCaptionAI`, add `lastTranscriptStatus` state (default `null`); set it from `data.transcriptStatus` in `generate` (leave `null` in `generateGeneral`/`polish`); reset on new generate and in `resetWarning`.
- [x] 2.2 In `CaptionControls`, render the message by status: `failed` → "Couldn't read the audio this time — caption was generated from your title & tags. Try generating again." (retryable, no false "no audio" claim); `no_audio` → existing wording (title vs no-title branches); `ok`/`null` → no warning.

## 3. Verification

- [x] 3.1 `tsc --noEmit` clean; no new lint errors. _(tsc exit 0; lint shows only the 3 pre-existing exhaustive-deps warnings, none new.)_
- [ ] 3.2 Manual (READY TO TEST): caption a video whose transcription fails (e.g. simulate a Rendi error) → UI shows the retryable "couldn't read audio" message, not "no audio detected".
- [ ] 3.3 Manual (READY TO TEST): caption a genuinely silent video → shows the "no audio detected" message.
- [ ] 3.4 Manual (READY TO TEST): caption a video with speech → no transcription warning; caption reflects the transcript.
