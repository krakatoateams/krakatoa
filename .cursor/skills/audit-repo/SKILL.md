---
name: audit-repo
description: Runs or resumes Krakatoa's risk-first code and security audit from its repository runbook and persistent audit state. Use only when the user explicitly invokes /audit-repo or asks to execute the remaining repository audit autonomously.
disable-model-invocation: true
---

# Audit repository

Run the repository audit to completion, one trust-boundary slice at a time.
Persist every checkpoint so another invocation can resume safely.

## Inputs

Accept these forms:

- `/audit-repo` — resume at the first incomplete queue item.
- `/audit-repo @docs/agents/code-security-audit-runbook.md` — same behavior
  with an explicit runbook.
- `/audit-repo status` — report state only; make no changes.
- `/audit-repo <queue item or domain>` — audit only that selected scope.
- The user may add `stop after current slice`.

Default files:

- Procedure: `docs/agents/code-security-audit-runbook.md`
- Checkpoint: `docs/agents/audit-state.md`

Read both completely before acting. The runbook defines the quality gates and
the state file is the source of truth for progress. Do not infer completion
from chat history.

## Authorization and boundaries

When `Execution mode` is `auto-fix-and-merge`, this invocation authorizes:

- creating branches prefixed `audit-repo/`;
- editing only files required by the selected audit slice and its tests;
- committing verified fixes and audit-state checkpoints on that branch only;
- pushing the runner's own `audit-repo/` branch, opening a GitHub pull request,
  merging it with a merge commit, pulling the merge onto local `main`, and
  deleting only the runner's own temporary local/remote branch.

Never commit on `main`. Never fast-forward or rebase `main` onto the audit
branch. Never push `origin/main` directly. Team history must stay a merge-commit
graph: feature branch → pull request → `Merge pull request` on `main`.

This does not authorize force-pushes, destructive resets, discarding unknown
work, deleting another branch, exposing secrets, changing production data, or
deploying a database migration without the required approval and Supabase MCP
workflow.

If the worktree is dirty before the runner starts, identify ownership. Continue
only when all changes belong to this audit setup or current runner checkpoint.
Otherwise stop without modifying them.

## Run loop

### 1. Preflight

1. Read repository instructions, especially `AGENTS.md`, `CLAUDE.md`, and scoped
   rules.
2. Read the runbook and audit state.
3. Fetch `origin/main`, switch to local `main`, and require it to equal
   `origin/main`. Do not commit, cherry-pick, or implement on `main`.
4. Create `audit-repo/<domain>-<slice>` from the aligned `main` and stay on
   that branch for every edit and commit in this slice.
5. Record the selected queue item, base commit, and branch in `Active slice`
   before implementation.

For `status`, stop after reporting active, completed, pending, and deferred
items.

### 2. Define a small slice

Map the selected domain before reviewing it. Use an exploration subagent when
the trust boundary is not already explicit. A slice should fit one coherent
review and merge, normally one route family plus its client/helper/database
contract.

Store any newly discovered slices as checkboxes beneath the relevant queue
item. Never mark an entire domain complete from a partial file list.

### 3. Review from two independent axes

Launch Standards and Spec/behavior review subagents in parallel against the
same scoped paths:

- Standards: correctness, lifecycle, concurrency, error handling, maintainable
  module boundaries, and repository conventions.
- Spec/behavior: trace caller → route → helper → database/provider and compare
  real behavior with tests, migrations, docs, and adjacent implementations.

Ask for evidence with exact paths and lines. Reject vague smells and style
preferences.

Validate every candidate in the code before accepting it. Classify it as:

- confirmed defect;
- accepted design, with evidence;
- false positive, with evidence; or
- follow-up outside the slice, added to the state file.

### 4. Fix confirmed defects test-first

For each confirmed defect:

1. Add the smallest regression test that fails for the correct reason.
2. Run it and record the red result.
3. Implement the smallest coherent fix.
4. Run the test to green.
5. Check adjacent callers and trust-boundary variants.

Do not manufacture a test when no defensible seam exists. That is a stop
condition, not permission to add a brittle mock.

### 5. Verify

Run, in this order:

1. focused tests for the slice;
2. neighboring contract/self-check suites named by the runbook;
3. lint with zero new errors and no new warnings;
4. production build;
5. `git diff --check`;
6. linter diagnostics for edited files.

Distinguish pre-existing warnings from regressions with evidence.

### 6. Security review

Run one fresh security-review subagent over the complete branch diff. Validate
its findings in the same way as code-review findings. Fix confirmed findings
test-first and repeat the relevant verification plus security review until no
unresolved high/critical finding remains.

Medium/low findings may remain only when they are demonstrably accepted design
or a documented follow-up with owner/rationale. Never silently defer them.

### 7. Deliver and checkpoint

Stay on the `audit-repo/...` branch for every commit. `main` receives work only
through a GitHub merge commit.

1. Commit the scoped implementation on the audit branch.
2. Update `docs/agents/audit-state.md`:
   - clear `Active slice`;
   - check the exact completed slice;
   - append an audit-log entry with base/final commits, scope, findings,
     accepted risks, verification, and security result.
3. Commit the checkpoint on the same audit branch.
4. Re-fetch `origin/main`. If it moved, stop before integrating.
5. Push the audit branch and open a pull request into `main` with `gh pr create`.
6. Merge with a merge commit, never squash or rebase:

   ```bash
   git push -u origin HEAD
   gh pr create --title "<slice title>" --body "$(cat <<'EOF'
   ## Summary
   - Audit slice: <domain / slice>
   - Confirmed fixes and accepted risks as recorded in audit-state.

   ## Test plan
   - Focused slice tests, neighboring contracts, lint, and production build
     already ran on this branch.
   EOF
   )"
   gh pr merge --merge --delete-branch
   git fetch origin main
   git checkout main
   git pull --ff-only origin main
   ```

7. Confirm local `main` equals `origin/main`, `HEAD` is the merge commit, and
   the worktree is clean. Delete only the leftover local `audit-repo/...`
   branch owned by this slice.
8. Continue immediately with the next pending slice unless the invocation
   selected one domain or requested a stop. Start that next slice from a new
   `audit-repo/` branch; do not keep committing on `main`.

If no defect was found, still checkpoint the reviewed scope and evidence; do
not create an empty implementation commit. A review-only slice still uses the
same pull-request merge.

## Stop conditions

Stop only for:

- a material product or policy decision;
- definitive authentication, authorization, quota, or entitlement failure;
- a production/database mutation requiring approval;
- no defensible regression-test seam;
- an unresolved test/build failure;
- remote `main` moving during delivery;
- unknown pre-existing work that cannot be isolated safely;
- an explicit user interruption.

On stop, update `Active slice` with the exact blocker and safest next command,
commit that checkpoint when safe, and leave all unrelated state untouched.

## Completion

The audit is complete only when every queue and discovered slice is checked,
there are no unresolved high/critical security findings, all accepted risks are
recorded, required gates pass, `main` is clean and synchronized, and `Overall
status` is `complete`.

Report concisely:

- completed and remaining slices;
- confirmed fixes and accepted risks;
- verification/security results;
- final commits and branch cleanup;
- blocker and resume command, if paused.
