# Note: migrate Tailwind 3 to 4 (to revisit)

Status: deferred. Not tracked as an issue on purpose; revisit when improving tooling.

## Why this exists

`npm audit` reports high-severity `braces` (GHSA-vfj7-8cjw-p6xm, versions <= 3.0.3,
no patched version exists). It comes from `tailwindcss@3` via `chokidar` and
`micromatch`. It is a build-time tool only; `npm audit --omit=dev` finds 0 problems.

`overrides` cannot fix it (no patched `braces`). Tailwind 4 drops that dependency chain
and is the only full fix.

## Current workaround

`ci:checks` in `package.json` runs `npm audit --omit=dev --audit-level=high`.
Production dependencies are still gated. Dev-dependency advisories do not block CI.

## Trade-offs of waiting

- The audit gate is looser for build tools. Run a plain `npm audit` from time to time
  and read the result, because it does not block anything now.
- Tailwind 3 code keeps growing, so the migration gets more expensive.
- Tailwind 4 changes config (CSS-first), plugin loading and some utilities. Plan a
  visual check of every page.

## Revisit when

- `braces` ships a patched version. Then restore the full `npm audit --audit-level=high`
  gate and delete this note.
- Or when there is time for the Tailwind 4 migration. Then do it as its own task and
  restore the full audit gate.
