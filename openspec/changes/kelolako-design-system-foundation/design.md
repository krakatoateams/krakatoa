## Context

- **Current token surface** (`app/globals.css`): `--ink`, `--muted`, `--surface-dark`, `--accent: #7c3aed` (purple) — a small, unrelated ad-hoc set. `tailwind.config.mjs` only extends `background`/`foreground` plus three keyframe animations. Root `body` defaults to `bg-white text-neutral-950` (light landing page).
- **Fonts today** (`app/layout.tsx`): `Space Grotesk` loaded as `--font-display` (weights 500/600/700) and `DM_Sans` as `--font-body`. `app/hello/layout.tsx` separately loads `Inter_Tight` (a distinct font from `Inter`) for one route only.
- **Components today** (`components/`): flat directory, no `ui/` subfolder, no established variant/size/state component pattern to follow.
- **Routes today** (`app/`): only `(app)` exists as a route group (the authenticated product). No `(internal)` group.
- **Source of truth for values**: three Figma-verified token docs (color, spacing/radius, shadow) and one HTML reference (`kelolako-button-component.html`) plus the phase-1 prompt doc, all attached to the originating conversation. Treated as locked input, not re-derived here.
- **Rebrand framing**: explicitly confirmed — this new dark/orange/Inter system is intended to diverge from the current live look (deliberate rebrand direction), and this change must not touch any existing production page/component/token. Retrofitting existing pages is a separate, later, incremental effort.

## Goals / Non-Goals

**Goals:**

- One additive Tailwind token system covering color (raw scale + semantic aliases), typography, spacing, radius, and shadow — all traceable back to the Figma-verified docs.
- A production-quality `Button` component that consumes only those tokens (no hardcoded hex, no arbitrary-value classes) and matches the full variant × size × state matrix.
- An internal, gated, unlinked style guide page that renders the *real* tokens and the *real* `Button` — not a hand-copied visual replica — so it can never silently drift from the actual implementation.
- Establish conventions (`components/ui/`, token naming) that later components can follow without renegotiating structure.

**Non-Goals:**

- Retrofitting any existing page/component to the new tokens or the new `Button`.
- Adding any component beyond `Button`.
- Deciding or implementing the eventual full-site rebrand rollout — this change only builds the foundation it would be built on.
- Resolving the `bg-surface-2` gap with a "real" value — flagged and placeholder'd, not solved here.

## Decisions

### 1. Inter is loaded scoped to the new route, not globally

**Decision:** `Inter` is loaded via `next/font/google` in a new nested layout (`app/(internal)/design-system/layout.tsx`), producing its own CSS variable (e.g. `--font-ds-body`) used only within that subtree. The root `app/layout.tsx` is not touched, and the existing `--font-body` (DM Sans) keeps meaning what it already means everywhere else in the app.

**Rationale:** The task is explicit that this page is internal-only and gated to non-production, and the broader rebrand rollout (swapping the live app's body font from DM Sans to Inter) is out of scope and not yet decided. Loading Inter globally today would create a font that's live in the bundle and CSS variable space for a page nobody is supposed to reach, with no corresponding decision yet made about retiring DM Sans. Scoping it keeps blast radius at zero, matching the "don't touch production" constraint, while still making the token real and usable the moment the rebrand rollout does start.

**Alternative considered:** Add Inter to the root layout now, reasoning that the token system should be "real" everywhere immediately. Rejected — it would add font weight to every route's bundle for a font not yet used anywhere those routes render, ahead of any decision to actually cut over.

### 2. `components/ui/` is a new convention, `Button` is its first member

**Decision:** Create `components/ui/Button.tsx`. Existing components stay exactly where they are; nothing is moved or renamed.

**Rationale:** No existing convention to conflict with — `components/` is currently flat. `ui/` as a subfolder for design-system-driven, token-only components (as opposed to the existing feature-specific components) is a common, low-risk pattern that scales cleanly as more components are added one at a time in future phases.

### 3. New `(internal)` route group, `NODE_ENV`-gated

**Decision:** `app/(internal)/design-system/page.tsx` (plus its scoped layout for the Inter font). The page checks `process.env.NODE_ENV === "production"` and returns `notFound()` in that case. Not linked from any nav/menu/sidebar.

**Rationale:** Matches the existing `(app)` route-group pattern already used for the authenticated product, so the new group reads as a peer concept ("internal tooling" vs. "the product") rather than a one-off special case. `notFound()` (404) was chosen over a redirect so the page's existence isn't hinted at by a redirect target in production; it fails the same way a route that doesn't exist would.

### 4. Primary button gradient hover/pressed stops

**Decision:**
- Enabled: `linear-gradient(135deg, #FF7B33 0%, #F26522 100%)` (Orange `O600` → `O500`) — as specified.
- Hover: `linear-gradient(135deg, #F26522 0%, #B24610 100%)` (Orange `O500` → `O400`) — shifted one step darker on the raw scale at both stops, keeping the same 135deg direction.
- Pressed: flat `#B24610` (Orange `O400`) — the darkest stop of the hover gradient, per the "flatten to the darkest stop" spec.

**Rationale:** The Figma-verified docs don't define gradient-specific hover/pressed stops (only flat-color hover/pressed values, which apply to the non-gradient variants). Rather than inventing new hex values with no source, this reuses the already-verified Orange raw scale one step down (`O500`→`O400` in place of `O600`→`O500`), so every color in the button — gradient included — still traces back to the same locked Figma scale. This should be treated as a proposed derivation, not a re-verified Figma value; flagging here per the original task's request to surface exactly what was derived.

### 5. `bg-surface-2` placeholder

**Decision:** Use `N100` (same value as `bg-surface`) for the `bg-surface-2` semantic token, per the explicit instruction in the source doc not to invent a value.

**Consequence (flagged, not fixed here):** The `Button` disabled state uses `bg-surface-2` + `text-secondary`, so a disabled button on a card (which uses `bg-surface`/`N100`) will have an identical background to the card behind it, relying on the `border-default` outline alone for affordance. Acceptable for this phase; revisit once a real `surface-2` value exists in Figma.

### 6. Style guide page layout: single page, sidebar/anchor navigation

**Decision:** One page (`app/(internal)/design-system/page.tsx`), not multiple routes. Within it, a left-hand sidebar with anchor links to each section (Colors, Typography, Spacing, Radius, Shadow, Button), in the structural spirit of tiket.design's component-list sidebar — adapted to single-page anchors rather than per-component routes, since the source task explicitly wants "this same style guide page" for future components to be added to incrementally.

**Rationale:** Keeps the "one living page" requirement intact while giving it a browsable, referenceable structure instead of one long undifferentiated scroll — useful once more component sections get added in later phases.

### 7. Foundation samples are read from the theme, not re-typed

**Decision:** The Foundation section's color swatches, spacing/radius samples, typography scale, and shadow samples are generated by iterating the actual `tailwind.config.mjs` theme object (e.g. via a small local config import / `resolveConfig`-style read), not by hand-writing a parallel list of the same values in the page.

**Rationale:** Explicit requirement in the source task — the page must not be able to visually drift from the real tokens. A hand-typed second copy of the same 60+ color values would inevitably desync.
