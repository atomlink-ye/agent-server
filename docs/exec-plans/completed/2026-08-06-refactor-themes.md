---
status: completed
owner: implementing-orchestrator
created_at: 2026-08-06
updated_at: 2026-08-06
authority: execution-plan
---

# Outcome

Complete the bounded T1, T6.5, T2, and T4 refactor slice from the manager's
authoritative design, using the `b827ce7` baseline as current-code evidence.

## Context and authority

The manager-approved scope and acceptance criteria are recorded in
`DESIGN-2026-08-06-agent-server-refactor-themes.md` outside this repository.
Current code overrides stale line-number or zero-caller claims. Public contract,
durable state, tenancy, dependency, and migration changes remain Human Gates.

## Scope

- [x] T1: repair Team Version cursor pagination and verify it through real HTTP.
- [x] T6.5: centralize YAML canonicalization without changing fingerprints.
- [x] T2: remove only dead code proven unused on the current baseline.
- [x] T4: repair the five approved layering violations and unify the four named
      OwnerScope definitions.

## Non-goals

- T3, T5, and T7 through T12.
- New tests, migrations, dependencies, frameworks, or generalized abstractions.
- Files reserved for the concurrent persistent Lead RuntimeSession slice.
- Public API, durable-state, or tenancy-boundary changes.

## Work breakdown

- [x] Re-verify all four themes against `b827ce7` and record stale claims.
- [x] Commit T1 separately as `7879f5a`.
- [x] Commit T6.5 separately as `4855d55`.
- [x] Commit the manager-approved reduced T2 scope separately as `cdbe82f`.
- [x] Commit T4 separately after pre-move Oracle approval.

## Verification

- [x] T1 real authenticated HTTP pagination: five versions traversed in three
      pages; page 1/page 2 IDs were disjoint; all IDs were unique; terminal
      `next_cursor` was null.
- [x] T6.5 pre/post inline and equivalent file-backed project fingerprints were
      byte-identical at
      `sha256:4738e84e980fa9a2306db93da7f5e113f4bc4136fdcbeb31fc4ad0e483f13115`.
- [x] T2 `make check`, applicable existing integration checks, and zero-reference
      grep.
- [x] T4 `make check` and forbidden-import grep.
- [x] Final branch-wide diff and worktree-state verification.

## Documentation impact

- [x] Product/Feature: no status change; this slice fixes behavior and internal
      structure only.
- [x] Component/Contract: T1 preserves the cursor contract; T6.5 preserves
      fingerprints. T2 public-contract changes are deferred.
- [x] ADR/Runbook: no decision or operational workflow change.

## Decisions and discoveries

- T1 remained live on the baseline; its cursor never reached SQL.
- T6.5 still had three canonicalization copies. The shipped Environment file was
  not equivalent to inline `synthetic-paseo: {}` until its metadata name matched
  the manifest key; the corrected pair established the acceptance hash above.
- T2's `phase` removal is deferred. `phase` is present in strict public response
  schemas, direct and Project routes, model-visible `team_state`, documented Web
  behavior, and protected smoke consumers. Removing it requires a separate
  public-contract Human Gate; removing storage would also require a migration.
- T2 enum/schema deletion is deferred. `cancelled` is actively written by
  fail-closed recovery, while other proposed removals remain in durable or
  published compatibility surfaces and were not proven safe deletions.
- The protected Paseo `category === 'subagent' ? 1 : 1` cleanup is deferred to
  later Paseo work.
- Manager decision on 2026-08-06: proceed with only Oracle-approved T2 dead-code
  deletion, defer the gated items above, then continue to T4.

## Risks and recovery

Each theme is a separate commit. No migration, push, or PR is authorized. The
safe recovery points are baseline `b827ce7`, T1 `7879f5a`, and T6.5 `4855d55`.

## Validation evidence

- `make check` passed after T1.
- `make check` passed after T6.5.
- T1 and T6.5 Oracle reviews approved with no required changes.
- T2 pre-deletion Oracle approved the reduced dead-code set and objected to the
  gated `phase`/enum batch.
- T2 post-deletion review reused the same Oracle session. The production diff
  was approved after confirming all approved symbols were removed, live atomic
  paths remained, and gated/protected surfaces were untouched.
- T2 `make check` passed. `make test-integration` passed 12 files and 141 tests,
  with 7 files and 36 tests skipped by their existing environment gates.
- T2 exact-symbol grep across `src`, `tests`, and `e2e` returned zero references;
  protected-file diff grep returned no paths.
- T4 pre-move and post-correction reviews reused the same Oracle session. The
  final diff was approved after an application-local card-renderer test fake
  removed the last test-only application-to-adapter value imports.
- T4 `make check` passed. Unfiltered adapter-import grep under
  `src/application` and application-import grep under `src/domain` returned no
  matches. The four named scope declarations resolve to the single canonical
  `domain/tenancy/OwnerScope`; protected-file diff grep returned no paths.
- The preserved idempotency vector produced
  `agent-project-4a068291b4b436eee6467c73c8b17cebc0586ce69706ee92925883f930771073`.

## Completion checklist

- [x] All accepted theme changes are committed separately.
- [x] All required acceptance evidence is fresh and recorded.
- [x] No temporary evidence, debug output, or unintended files remain.
- [x] Plan is moved to `completed/` with no unchecked items.

## Current blocker

None. The T2 Human Gate was resolved by deferring public/durable compatibility
changes, and all four authorized themes are complete.

## Next exact command

Commit the approved T4 diff and this completed plan as the fourth separate theme
commit. Do not push or open a PR.

## Cleanup state

The T1 acceptance Compose stack remains running in the isolated
`refactor-themes` project. The temporary T6 fingerprint fixture was moved to the
system Trash and is recoverable. No migration, push, or PR exists.
