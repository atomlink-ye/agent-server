---
status: active
owner: orchestrator
authority: execution-plan
---

# Lark same-session direct Doc Accept

## Scope

- Preserve origin/thread-scoped Session continuity; do not reuse Sessions across
  unrelated roots.
- Immediately create the Bot-owned Doc before initial `card_with_doc` publication.
- Direct Accept resumes the exact source Run+Session Agent and uses Bot identity
  for the validated `lark-cli` Doc fetch.
- Preserve legacy inbound actions and terminal provenance for Preview successors.
- Keep Task 14 untouched; E2E remains follow-up work.

## Evidence

- Focused direct-accept/Card/publisher tests pass under Node 24.
- Same-session provider continuation tests remain in the current thread plan.
- Real Gate facts were sanitized into the evidence packet: same Session/Agent,
  Bot Doc read, changed marker, one Entry, ready Snapshot v6, followed by a
  source-message provenance resolution failure. The provenance fix is covered by
  PGlite regression tests.
- `pnpm check` and `git diff --check` pass. No secrets or raw provider output are
  recorded. Deterministic E2E is intentionally deferred.
- Final Node 24 `make ci` passed: 371 unit, 71 contract, 143 integration with 36
  skipped, and 7 deterministic E2E tests. A fresh real-PostgreSQL rerun passed
  all 6 files and 74 tests. The first fresh real-PG attempt exposed an unrelated
  migration-order flake and the clean rerun passed without source changes.
- Final Oracle review found no Critical or Important PR blockers after the
  source-message versus legacy Preview-successor provenance fix.

## Current blocker

None.

## Next exact command

Open the PR with this plan still active. Schedule the deferred deterministic
direct-Accept E2E and Task 14 hardening as follow-up work rather than expanding
the current PR.
