## Why

Kelolako is moving toward a deliberate rebrand: dark-first, orange-accented, Space Grotesk + Inter, replacing the current light landing page (`bg-white`/`text-neutral-950`, purple `--accent: #7c3aed`, DM Sans). That rebrand needs a real, reusable foundation before any page gets touched — today there is no `components/ui/` convention, no design-token system beyond two ad-hoc CSS variables and two Tailwind colors, and no way to see the new visual language rendered as actual code rather than a static Figma/HTML mockup. This change builds that foundation in isolation: Tailwind tokens, one production-quality Button component, and an internal living style guide page — without touching any existing production page, component, or style.

## What Changes

- Extend `tailwind.config.mjs` with the full Kelolako token system verified from Figma: raw color scale (Neutral, Primary/Orange, Info/Blue, Success/Green, Warning/Yellow, Error/Red — each 0–900 — plus Alpha tokens), semantic aliases that reference the raw scale (not duplicated hex), spacing scale (8px-based, `sm` through `6xl`), radius scale (`none` through `4xl`), shadow/elevation utilities (`shadow-elevation-01`, `shadow-elevation-02`; `-00` is `none`), and a typography scale (Space Grotesk Bold headings, Inter body, exact sizes/line-heights, 0 letter-spacing throughout).
- Load `Inter` via `next/font/google`, scoped to a **new** nested layout under the new internal route only — not the root layout — so existing pages keep DM Sans/`--font-body` untouched. Reuse the existing root `Space Grotesk` load (`--font-display`, weights 500/600/700) for headings rather than loading it a second time.
- Add `components/ui/Button.tsx` — the first entry in a new `components/ui/` folder — implementing the full variant (`primary`/`secondary`/`tertiary`/`danger`/`on-media`) × size (`sm`/`md`/`lg`) × state (enabled/hover/pressed/loading/disabled/focus-visible) matrix from the attached button spec, with `primary` using a gradient background (overriding the flat-color reference HTML) and every other variant matching the HTML reference as-is. All styling comes from Phase 1 tokens — no hardcoded hex or Tailwind arbitrary-value classes inside the component.
- Add an internal-only living style guide page rendering the real tokens and the real `Button` component (not a hand-copied visual replica), with a "Foundation" section (full color scale, spacing/radius/typography/shadow samples, all read live from the Tailwind theme) and a "Button" section (every variant × state × size combination). Gated to non-production and not linked from any nav.
- No existing page, component, token, or route is modified.

## Capabilities

### New Capabilities

- `design-system-foundation`: Kelolako's Tailwind token system (color/typography/spacing/radius/shadow), the `Button` UI component built on those tokens, and the internal style guide page that renders both for visual QA. Establishes the `components/ui/` convention and the token-naming conventions future components will follow.

### Modified Capabilities

- _(none — this is purely additive; no existing `openspec/specs/` baseline for design tokens or UI components exists in-repo yet.)_

## Impact

- **Config:** `tailwind.config.mjs` — large additive extension to `theme.extend` (colors, fontFamily/fontSize, spacing, borderRadius, boxShadow). No renamed or removed keys; `background`/`foreground` colors already there are left as-is.
- **Fonts:** New nested layout (e.g. `app/(internal)/design-system/layout.tsx`) loads `Inter` via `next/font/google`, scoped to that subtree only. Root `app/layout.tsx` is not touched.
- **Components:** New `components/ui/Button.tsx` (and `components/ui/` as a new directory — first component in it).
- **Routes:** New `app/(internal)/design-system/page.tsx` (+ its scoped layout). New `(internal)` route group — does not exist today. Gated via `NODE_ENV !== "production"` (404/redirect in prod); not linked from any nav/menu.
- **Dependencies:** None new — `lucide-react` is already installed (`^1.14.0`); `Inter` and `Space Grotesk` are both available through `next/font/google` already in use elsewhere in the repo.
- **Production surface:** Zero. This change touches no file under `app/(app)/`, no existing `components/*.tsx`, and no existing CSS/token in `app/globals.css`.

## Implementation Notes (Pre-Apply Review)

- `bg-surface-2` has no confirmed Figma value yet (flagged gap in the source token doc). Use `N100` (same as `bg-surface`) as a placeholder per the doc's explicit instruction, and flag in `design.md` that disabled buttons will consequently share a background with card surfaces until a real `surface-2` value exists.
- The primary button's gradient **hover** and **pressed** stops aren't in the Figma-verified doc (only the flat-color hover/pressed values are, and those apply to non-gradient variants). `design.md` documents the derivation: reuse the already-verified Orange raw scale (`O500`→`O400`) rather than inventing new hex values, so gradient stops stay traceable to the same verified source as everything else.
- Typography, color, spacing, radius, and shadow raw values themselves are treated as locked (already verified against Figma in the attached token docs) — this change does not re-derive or re-verify them, only implements them as Tailwind tokens.
