---
status: completed
owner: orchestrator
created_at: 2026-07-24
updated_at: 2026-07-24
authority: execution-plan
---

# Document Lifecycle Restructure

## Outcome

Separate current task context from historical logs and make related Spec/Plan
artifacts leave the active lane together when work is complete.

## Context and authority

- Design: `docs/superpowers/specs/2026-07-24-document-lifecycle-restructure-design.md`
- Implementation plan: `docs/superpowers/plans/2026-07-24-document-lifecycle-restructure.md`

## Scope

- [x] Restructure the external task bundle.
- [x] Reconcile and archive stale Specs/Plans.
- [x] Document and mechanically enforce the lifecycle invariant.

## Non-goals

- Product, API, migration, runtime, or model behavior changes.
- Deleting historical handoffs or learning logs.

## Work breakdown

- [x] Add task-bundle `CHANGELOG.md` and `history/` index.
- [x] Rewrite current `CONTEXT.md` and update moved-file references.
- [x] Archive the five stale active Spec/Plan artifacts.
- [x] Add checker tests and lifecycle rules.

## Verification

- [x] Checker negative cases fail for split lanes and completed-to-active links.
- [x] `pnpm check:exec-plans` passes.
- [x] `make check` passes.
- [x] Task-bundle references resolve and Git status contains only intended files.

## Documentation impact

- [x] Exec Plan protocol updated.
- [x] Task bundle current context and history updated.

## Decisions and discoveries

- Specs and Plans remain separate but form one archival unit.
- Historical handoffs move to `history/`; the current merged handoff remains at root.
- During execution, PR #6 was confirmed merged as `897a610`; the former PR-open
  handoff therefore became historical and a merged handoff became current.

## Risks and recovery

- Restore moved files and links together if reference verification fails.

## Validation evidence

- Node `v24.18.0` and pnpm `11.7.0`.
- TDD RED: `node --test scripts/ci/check-exec-plans.test.mjs` failed because
  `collectExecPlanErrors` was not exported.
- TDD GREEN: all 6 lifecycle-checker cases passed.
- `pnpm check:docs`: passed for 72 Markdown files.
- `pnpm check:exec-plans`: tests passed and live repository check passed for 14
  plans before self-archival.
- First `make check`: failed only Prettier on the new implementation plan and
  checker module; both files were formatted directly.
- Final `make check`: types, format, docs, and Exec Plan checks passed.
- Task-bundle relative-link verification passed for 18 Markdown files.
- Direct search found no completed Exec Plan linking to `active/` and no stale
  root-level path for a moved task artifact.

## Completion checklist

- [x] Every scope item is complete or explicitly transferred.
- [x] No unchecked item remains before archival.
- [x] Plan moved to `completed/` with `status: completed`.

## Current blocker

None; implementation and verification are complete.

## Next exact command

`pnpm check:exec-plans` after moving this Plan to `completed/`.

## Cleanup state

No temporary process or database was created. Historical task files are indexed
under `history/`, and the repository worktree contains only the intended
uncommitted documentation/checker changes.
