---
status: completed
owner: gpt-5.4
created_at: 2026-07-23
updated_at: 2026-07-23
authority: execution-plan
---

# Workspace Memory Proposal MVP

## Outcome

Add a governance-only Workspace Memory slice: authenticated owner-scoped proposal create/list, one-shot proposal review with `accept | edit_and_accept | reject`, accepted workspace-memory entry listing, durable provenance, deterministic newest-first ordering, and truth-synced docs/ADR/contract updates without changing runtime prompt assembly.

## Context and authority

- Accepted design spec: `docs/exec-plans/active/2026-07-23-workspace-memory-proposal-mvp-spec.md`.
- Initial implementation plan: `docs/exec-plans/active/2026-07-23-workspace-memory-proposal-mvp-plan.md`.
- Repo authority order: explicit user direction, then Product/Features/Contracts/Components, then this exec plan, then code/tests.
- External requirement anchor: `/Volumes/AgentsWorkspace/orgs/0xdtech/docs/agent-server/项目文档/enterprise-research-agent-platform-v1-spec`.
- The user explicitly chose Workspace Memory Proposal MVP, explicitly required a public create-proposal API in this slice, and explicitly asked for autonomous completion followed by push + PR to `master`.

## Scope

- Workspace-scoped `MemoryProposal` and `WorkspaceMemoryEntry` durable state.
- Authenticated owner-scoped HTTP routes for create/list proposals, review proposal, and list accepted entries.
- Optional source Task/session provenance capture.
- Transactional proposal review plus accepted-entry creation.
- Deterministic newest-first ordering for proposals and accepted entries.
- Repo doc, contract, and ADR truth sync for this narrow baseline.

## Non-goals

- Agent memory.
- Retrieval, embeddings, vector search, ranking, or semantic recall.
- Runtime context injection or silent prompt mutation.
- End-user OIDC, canonical user ownership, or shared Workspace ACLs.
- Memory edit/delete after acceptance.
- Session reset behavior, artifact delivery, or credential/runtime boundary changes.

## Work breakdown

- [x] Create and verify an isolated worktree from fresh `origin/master` instead of using the dirty root checkout.
- [x] Re-read repo workflow docs and previously prepared external authority before implementation.
- [x] Write the Workspace Memory Proposal MVP design spec and repo-native plan in the new worktree.
- [x] Add failing tests and implementation for memory domain state, repository port, migration, and transactional Postgres persistence.
- [x] Harden Task 1 after oracle review: runtime enum validation, owner-scope FK enforcement, and deterministic migration transaction framing.
- [x] Add failing tests and implementation for proposal create/list services and authenticated HTTP routes.
- [x] Add wildcard auth coverage plus 413 contract coverage for workspace-memory routes.
- [x] Add failing tests and implementation for proposal review and accepted-entry listing.
- [x] Fix deterministic newest-first ordering when multiple records share the same millisecond timestamp.
- [x] Fix malformed `proposal_id` review-route validation so bad path IDs return `400 invalid_request` instead of an internal error.
- [x] Update docs, contracts, and ADRs to reflect the narrow governance-only baseline truth.
- [x] Run focused loops first, then deterministic verification, then archive this plan.

## Verification

- [x] `make setup`
- [x] `pnpm check:docs`
- [x] focused unit tests for workspace-memory domain/application services
- [x] focused contract tests for workspace-memory routes
- [x] focused integration tests for Postgres workspace-memory persistence and same-timestamp ordering
- [x] `make test-unit`
- [x] `make test-contract`
- [x] `make test-integration`
- [x] `make e2e-smoke`
- [x] `make ci`

## Documentation impact

- [x] Product/Feature status updated for the Workspace and Memory baseline truth.
- [x] Component/Contract docs updated for the workspace-memory API and governance boundary.
- [x] ADR added for Workspace Memory Proposal MVP boundary and separation from retrieval/context assembly.

## Decisions and discoveries

- This slice intentionally ships memory governance before any retrieval or context assembly.
- Owner scope remains the current service-account snapshot; the implementation does not pretend reviewer ACLs or end-user identities exist.
- `request_too_large` was retained as an intentional route-level safety boundary even though one review suggested narrowing public errors.
- Oracle review found that proposal review path IDs needed UUID validation to avoid leaking a database-cast failure as `500`; that route-level guard was added before final verification.
- A real deterministic-ordering bug surfaced during local Node 24 verification: two proposals can share the same millisecond `created_at`, making `ORDER BY created_at DESC, id DESC` nondeterministic because UUID is random. The final implementation now uses persisted internal ordering keys for both proposals and accepted entries.
- The branch also contains uncommitted root-checkout drift outside this worktree in the main repo checkout; that state was intentionally ignored by building from fresh `origin/master` in the isolated worktree.
- Reconciled specialist lanes:
  - `exp-1` adopted as `/api/v1/runs` e2e compatibility anchor
  - `exp-2` adopted as docs/contract/ADR structure map
  - `exp-3` adopted as code/test-path structure map
  - `fix-1` superseded by `fix-2`
  - `ora-1` adopted
  - `ora-2` adopted and fixed in `fix-2`
  - `fix-2` adopted
  - `fix-3` adopted
  - `ora-3` partially not adopted; 413 behavior intentionally retained
  - `ora-4` adopted and fixed in `fix-4`
  - `fix-4` adopted
  - `ora-5` adopted
  - `fix-5` adopted
  - `fix-6` adopted
  - `ora-6` adopted
  - `ora-7` adopted and resolved locally before final verification
  - `fix-7` adopted

## Risks and recovery

- Largest scope risk: accidentally implying retrieval, runtime memory injection, or agent memory already exist.
- Largest contract risk: malformed path IDs or cross-owner requests leaking internal persistence behavior instead of stable public errors.
- Largest data-model risk: future work adding retrieval semantics directly on top of governance rows without revisiting ownership, freshness, and sensitivity rules.
- Safe recovery point: `origin/master` at `5ef72b1` and the clean new worktree baseline before feature code changes.

## Validation evidence

- 2026-07-23 GREEN: `make setup` passed in `/Volumes/AgentsWorkspace/orgs/0xdtech/code/agent-server/.worktrees/workspace-memory-proposal-mvp` under Node `v24.18.0`.
- 2026-07-23 GREEN: `make ci` passed in the clean worktree baseline before Workspace Memory Proposal MVP changes.
- 2026-07-23 RED: `pnpm vitest run src/domain/workspace-memory --config vitest.unit.config.ts` and `pnpm vitest run tests/integration/durable-kernel-postgres.integration.test.ts --config vitest.integration.config.ts` failed before Task 1 implementation because the workspace-memory domain/repository modules did not exist.
- 2026-07-23 GREEN: the same Task 1 focused unit/integration checks plus `pnpm check:types` passed after implementation and were re-run under Node `v24.18.0`.
- 2026-07-23 RED: oracle review found Task 1 hardening gaps around runtime enum validation and owner-scope FK enforcement; those were fixed before continuing.
- 2026-07-23 GREEN: focused Task 1 hardening checks passed under Node `v24.18.0` after the fixes.
- 2026-07-23 RED: `pnpm vitest run tests/contract/workspace-memory.contract.test.ts --config vitest.contract.config.ts` and `pnpm vitest run src/application/memory --config vitest.unit.config.ts` failed before Task 2 because the proposal create/list modules and contracts did not exist.
- 2026-07-23 GREEN: the Task 2 focused contract/unit checks plus `pnpm check:types` passed after implementation and were re-run under Node `v24.18.0`.
- 2026-07-23 RED: review of Task 2 found missing wildcard auth coverage for future child routes; `fix-4` added wildcard auth and 413 coverage.
- 2026-07-23 GREEN: the workspace-memory contract suite passed under Node `v24.18.0` after the Task 2 auth/413 patch.
- 2026-07-23 RED: `pnpm vitest run tests/contract/workspace-memory.contract.test.ts --config vitest.contract.config.ts` and `pnpm vitest run src/application/memory --config vitest.unit.config.ts` failed before Task 3 because review/list-entry modules and routes did not exist.
- 2026-07-23 GREEN: the Task 3 focused contract/unit/integration checks plus `pnpm check:types` passed after implementation and were re-run under Node `v24.18.0`.
- 2026-07-23 RED: oracle review found malformed `proposal_id` path values could surface as `500`; a failing contract test reproduced `500` for `/api/v1/workspace-memory/proposals/not-a-uuid/review` before the route-level UUID guard was added.
- 2026-07-23 GREEN: the malformed-UUID contract test, full workspace-memory contract suite, focused application tests, focused workspace-memory integration tests, and `pnpm check:types` all passed under Node `v24.18.0` after the fix.
- 2026-07-23 RED: local Node 24 verification found the proposal newest-first contract flaky because two proposals created in the same millisecond could share `created_at` and sort by random UUID.
- 2026-07-23 GREEN: focused integration tests proved same-timestamp newest-first ordering for both proposals and accepted entries after adding persisted `internal_order` keys.
- 2026-07-23 GREEN: `pnpm check:docs` passed after doc truth-sync for README, Features, Contracts, Components, journeys, and ADRs.
- 2026-07-23 GREEN: `make test-unit` passed (`20` files / `59` tests) under Node `v24.18.0`.
- 2026-07-23 GREEN: `make test-contract` passed (`4` files / `42` tests) under Node `v24.18.0`.
- 2026-07-23 GREEN: `make test-integration` passed (`2` files / `23` tests) under Node `v24.18.0`.
- 2026-07-23 GREEN: `make e2e-smoke` passed (`1` file / `1` test) under Node `v24.18.0`.
- 2026-07-23 RED: `make ci` initially failed only on Prettier drift introduced by implementation/docs edits.
- 2026-07-23 GREEN: `pnpm prettier --write` on the reported files resolved the formatting residue.
- 2026-07-23 GREEN: `make ci` passed under Node `v24.18.0` after formatting.
- 2026-07-23 NOTE: `make paseo-smoke` was intentionally not required because this phase did not materially change the Paseo runtime adapter, model resolution, process isolation, readiness probing, or runtime result-mapping boundary; the work stayed in storage, API, and control-plane governance layers.

## Completion checklist

- Authenticated workspace-memory proposal create/list/review and accepted-entry listing match the approved scope.
- Non-goals remain true: no agent memory, retrieval, embedding, or runtime prompt injection.
- Public contract docs match the implemented routes and stable error semantics.
- Deterministic ordering is stable even when timestamps collide at millisecond precision.
- No debug residue, secret leakage, or misleading docs remain.
- All work, verification, and documentation checkboxes are checked before archive.

## Current blocker

- None.

## Next exact command

- `git status --short --branch && git diff --stat && git log --oneline -10`

## Cleanup state

- No intentional background processes or temporary artifacts are active in the worktree.
- Main repo checkout dirtiness outside this worktree remains intentionally untouched and unexplained; it was not modified by this feature lane.
