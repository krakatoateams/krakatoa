# Motion Control

Video studio → **Motion control**: animate a character photo using motion copied from a reference clip (Kling v2.6 / v3 Motion Control on Replicate).

## Character orientation (product decision)

Kling accepts `character_orientation`:

| Value | UI label (removed) | Behavior |
|-------|-------------------|----------|
| `"video"` | **Follow motion** | Character moves like the reference clip. Motion clip **3–30s**. |
| `"image"` | Photo angle | Character faces like the photo. Motion clip capped at **~10s** (provider rejects ≥10s). |

**Shipped default (2026-07):** only **Follow motion** (`"video"`). Photo angle was removed from the composer — the 10s cap was too tight for dance/action clips and duplicated what Follow motion already does better.

- UI: no orientation picker (`app/(app)/tools/video/page.tsx`).
- API: `POST /api/generate-motion-control` always sends `character_orientation: "video"` to Replicate.
- Registry: `DEFAULT_CHARACTER_ORIENTATION` in `lib/motion-control-models.ts`.

Re-enabling Photo angle would require restoring the chip dropdown, image-orientation duration validation, and API acceptance of `characterOrientation: "image"`.
