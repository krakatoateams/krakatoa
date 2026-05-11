# Contributing to Krakatoa

Welcome to the team! To maintain high code quality and stable releases, we follow a structured collaboration workflow.

## Branch Strategy
- **main**: Production-ready code only.
- **dev**: Integration branch where all features are merged before going to main.
- **feature/[tool]-[name]**: Individual feature branches.
  - Examples: `feature/reels-caption-fix`, `feature/photo-gallery`, `feature/scheduler-api`.

## Workflow Rules
1.  **Branching**: Always branch off from `dev`, never from `main`.
2.  **Daily Routine**: Run `git pull origin dev` every morning before starting work to stay in sync.
3.  **Pull Requests**: 
    - PRs must always target `dev`.
    - Never target `main` directly.
    - Fill out the PR template completely.
4.  **Merging to Main**: `dev` is merged into `main` only when stable and approved by the project lead.

## Shared Files Policy
The following files are critical to the entire project. You **must** notify the team and get approval from the project lead (`@lead`) before making any changes:
- `package.json`
- `app/page.tsx`
- `app/layout.tsx`

## Handling Conflicts
If you encounter conflicts in shared files:
1.  Pull the latest `dev` into your branch.
2.  Resolve conflicts locally.
3.  If unsure about a shared component, consult the project lead.

## Code Reviews
- Refer to `.github/CODEOWNERS` for automated review assignments.
- Project lead (`@lead`) has final say on all architectural changes.
