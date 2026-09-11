# Issue tracker: Local Markdown

Issues and specs live as Markdown files in `.scratch/`.

## Conventions

- One feature per `.scratch/<feature-slug>/`.
- The spec is `.scratch/<feature-slug>/spec.md`.
- Tickets are `.scratch/<feature-slug>/issues/<NN>-<slug>.md`.
- Triage state uses a `Status:` line.
- Conversation history goes under `## Comments`.

Publishing creates the relevant local file. Fetching reads the referenced path.

## Wayfinding

- Map: `.scratch/<effort>/map.md`
- Tickets: `.scratch/<effort>/issues/<NN>-<slug>.md`
- Dependencies: `Blocked by: NN, NN`
- Claim with `Status: claimed`; finish with `Status: resolved` and an `## Answer`.
