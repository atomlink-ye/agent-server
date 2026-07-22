---
status: completed
owner: gpt-5.4
created_at: 2026-07-22
updated_at: 2026-07-22
authority: execution-plan
---

# Sequential Team MVP

## Outcome

Add durable Agent/Team definitions, immutable published versions, a canonical public Task invoke/read surface, and a control-plane sequential Team executor that materializes child Tasks and child Runs while keeping the runtime leaf-agent only and preserving `/api/v1/runs` compatibility.

## Context and authority

- Accepted design spec: `docs/exec-plans/active/2026-07-22-sequential-team-mvp-spec.md`.
- Detailed implementation plan: `docs/exec-plans/active/2026-07-22-sequential-team-mvp-plan.md`.
- Repo authority order: explicit user direction, then Product/Features/Contracts/Components, then this Active Exec Plan, then code/tests.
- External requirement anchor: `/Volumes/AgentsWorkspace/orgs/0xdtech/docs/agent-server/项目文档/enterprise-research-agent-platform-v1-spec`.
- User explicitly approved the Sequential Team MVP direction, requested autonomous completion, and required execution inside a fresh worktree.

## Scope

- Durable Agent and Team definitions plus immutable published versions.
- Sequential-only Team publish validation and compiled execution plan storage.
- Public `POST /api/v1/tasks:invoke`, `GET /api/v1/tasks/{id}`, and `GET /api/v1/tasks/{id}/tree`.
- Control-plane execution of a published sequential Team through child Task/Run materialization.
- Root AgentVersion invocation support through the same canonical Task surface.
- Preservation of `/api/v1/runs` compatibility behavior.

## Non-goals

- Parallel/join, approval, review-loop, manager-worker, dynamic delegation.
- Retry/cancel/reconcile/unknown orchestration semantics.
- OIDC, shared ACLs, credential/tool approval, execution-cell isolation.
- Artifacts/evidence lineage, schedules/triggers, Lark/Web console.

## Work breakdown

- [x] Create and verify an isolated worktree from fresh `master`.
- [x] Re-read repo workflow docs and external product requirements before planning.
- [x] Write and approve the Sequential Team MVP design direction.
- [x] Add failing tests and persistence for durable Agent/Team definition/version registry plus sequential Team compiler.
- [x] Add failing tests and implementation for the canonical Task invoke/read/tree API.
- [x] Add failing tests and implementation for sequential Team execution with child Task/Run genealogy.
- [x] Update documentation, contracts, and ADRs to reflect the implemented MVP truth.
- [x] Run focused loops first, then the deterministic gate, then archive this plan.

## Verification

- [x] `make setup`
- [x] `make ci` on the clean worktree baseline
- [x] focused unit tests for invokable domain/compiler
- [x] focused contract tests for Agent/Team/Task API routes
- [x] focused integration tests for PostgreSQL persistence and Team execution
- [x] `make test-unit`
- [x] `make test-contract`
- [x] `make test-integration`
- [x] `make e2e-smoke`
- [x] `make ci`

## Documentation impact

- [x] Product/Feature status updated for Agents & Teams and Task API baseline.
- [x] Component/Contract docs updated for Control Plane, Orchestration Kernel, Run compatibility, and new Task/Agent/Team contracts.
- [x] ADR added for Sequential Team MVP scope and semantics.

## Decisions and discoveries

- The new feature line is explicitly based on the adopted results from `exp-4`, `exp-5`, and `ora-14`: Task-first identity, immutable Agent/Team Invokables, publish-time Team compilation, leaf-only runtime, and a sequential-only MVP cut.
- The user asked not to keep deepening only pre-existing baseline seams and instead to land a genuinely new feature line.
- The old Durable Kernel A worktree no longer exists; the new lane is `/Volumes/AgentsWorkspace/orgs/0xdtech/code/agent-server/.worktrees/sequential-team-mvp` on `agent/sequential-team-mvp`.
- Baseline verification in the new worktree already passed under Node `v24.18.0` using `make setup` and `make ci`.
- Task 1 landed a new `0003_sequential_team_mvp` migration with durable Agent/Team definition tables, immutable published version rows, and compiled sequential Team plan storage.
- The Task 1 compiler foundation intentionally accepts only `invoke` nodes with one linear successor chain and owner-scoped published AgentVersion references under the current service-account baseline.
- The previously reported Task 2 lane result was invalid because the expected Task 2 files were absent from this worktree; `fix-18` was discarded during reconciliation and Task 2 was re-implemented and re-verified directly in `/Volumes/AgentsWorkspace/orgs/0xdtech/code/agent-server/.worktrees/sequential-team-mvp`.
- Task 3 keeps the single dispatcher loop deadlock-free by claiming and completing Team child runs inline inside the already-claimed Team root activation instead of enqueuing child dispatch work.
- Team child genealogy is modeled as sibling child Tasks under the Team root Task with `parent_task_id = <root task>`, `parent_run_id = <root team run>`, and stable `logical_step_key`/`node_path` persistence for tree ordering.
- Task 4 documentation truth stays intentionally narrow: Task routes are public and canonical, `/api/v1/runs` remains the compatibility API, durable Agent/Team versions exist without public management routes, and the implemented Team capability is sequential-only rather than Team V1.
- Oracle review `ora-15` found a compatibility-sentinel contract mismatch, tenant-only invokable lookups, and a non-atomic published Team persistence path; those issues were adopted and fixed in `fix-22`.
- Oracle re-review `ora-16` found no remaining critical or important issues and judged the current tree acceptable for the approved Sequential Team MVP scope.

## Risks and recovery

- Largest scope risk: accidentally drifting into Team V1 features such as join/approval/retry/reconcile.
- Largest contract risk: adding Task routes or Agent/Team routes that overclaim future identity/workspace semantics.
- Largest implementation risk: trying to execute Team children through the single dispatcher loop in a way that deadlocks parent execution.
- Safe recovery point: current branch `master` at `53387d8` and the clean new worktree baseline before feature code changes.

## Validation evidence

- 2026-07-22 GREEN: `make setup` passed in `/Volumes/AgentsWorkspace/orgs/0xdtech/code/agent-server/.worktrees/sequential-team-mvp` under Node `v24.18.0`.
- 2026-07-22 GREEN: `make ci` passed in the clean worktree baseline before Sequential Team MVP changes.
- 2026-07-22 RED: `pnpm vitest run --config vitest.unit.config.ts src/domain/invokables/agent-version.test.ts src/domain/invokables/team-version.test.ts src/application/invokables/sequential-team-compiler.test.ts` failed before implementation because the new invokable/compiler modules did not exist yet.
- 2026-07-22 RED: `pnpm vitest run --config vitest.integration.config.ts tests/integration/durable-kernel-postgres.integration.test.ts` failed before implementation because the new invokable registry modules did not exist yet.
- 2026-07-22 GREEN: `pnpm vitest run --config vitest.unit.config.ts src/domain/invokables/agent-version.test.ts src/domain/invokables/team-version.test.ts src/application/invokables/sequential-team-compiler.test.ts` passed after the Task 1 implementation.
- 2026-07-22 GREEN: `pnpm vitest run --config vitest.integration.config.ts tests/integration/durable-kernel-postgres.integration.test.ts` passed after the Task 1 implementation.
- 2026-07-22 GREEN: `pnpm check:types` passed after the Task 1 implementation.
- 2026-07-22 GREEN: the Task 1 focused unit/integration/type checks were re-run under Node `v24.18.0` and still passed.
- 2026-07-22 RED: `pnpm vitest run --config vitest.unit.config.ts src/application/tasks/invoke-task.test.ts && pnpm vitest run --config vitest.contract.config.ts tests/contract/tasks.contract.test.ts && pnpm vitest run --config vitest.integration.config.ts tests/integration/durable-kernel-postgres.integration.test.ts` failed before Task 2 implementation because the new Task invoke/query modules and contracts did not exist yet.
- 2026-07-22 GREEN: `pnpm vitest run --config vitest.unit.config.ts src/application/tasks/invoke-task.test.ts src/entrypoints/api/routes/runs.test.ts && pnpm vitest run --config vitest.contract.config.ts tests/contract/tasks.contract.test.ts tests/contract/runs.contract.test.ts && pnpm vitest run --config vitest.integration.config.ts tests/integration/durable-kernel-postgres.integration.test.ts && pnpm check:types` passed after the Task 2 implementation.
- 2026-07-22 GREEN: the adopted Task 2 focused unit/contract/integration/type checks were re-run under Node `v24.18.0` and still passed.
- 2026-07-22 RED: `pnpm vitest run --config vitest.unit.config.ts src/domain/tasks/task.test.ts` failed before Task 3 implementation because `createChildTask` and child step identity persistence did not exist yet.
- 2026-07-22 RED: `pnpm vitest run --config vitest.integration.config.ts tests/integration/durable-kernel-postgres.integration.test.ts` failed before Task 3 implementation because canonical Task execution did not transition Task status, published AgentVersion prompts were not composed for runtime execution, and Team runs did not materialize inline child Task/Run genealogy.
- 2026-07-22 GREEN: `pnpm vitest run --config vitest.unit.config.ts src/domain/tasks/task.test.ts && pnpm vitest run --config vitest.integration.config.ts tests/integration/durable-kernel-postgres.integration.test.ts` passed after the Task 3 implementation.
- 2026-07-22 GREEN: `pnpm vitest run --config vitest.contract.config.ts tests/contract/tasks.contract.test.ts tests/contract/runs.contract.test.ts && pnpm vitest run --config vitest.integration.config.ts tests/integration/durable-kernel-postgres.integration.test.ts && pnpm check:types` passed after the Task 3 implementation.
- 2026-07-22 GREEN: the Task 3 focused unit/contract/integration/type checks were re-run under Node `v24.18.0` and still passed.
- 2026-07-22 GREEN: `pnpm check:docs` passed after syncing README, Features, Components, Contracts, and ADR truth for the Sequential Team MVP.
- 2026-07-22 GREEN: `pnpm check:exec-plans` passed after updating the active Sequential Team MVP execution-plan truth.
- 2026-07-22 RED: `make ci` initially failed only on formatting drift; running `pnpm exec prettier --write ...` resolved the single remaining formatting residue.
- 2026-07-22 GREEN: `make test-unit` passed (`17` files / `49` tests) under Node `v24.18.0`.
- 2026-07-22 GREEN: `make test-contract` passed (`3` files / `30` tests) under Node `v24.18.0`.
- 2026-07-22 GREEN: `make test-integration` passed (`2` files / `19` tests) under Node `v24.18.0`.
- 2026-07-22 GREEN: `make e2e-smoke` passed (`1` file / `1` test) under Node `v24.18.0`.
- 2026-07-22 GREEN: `make ci` passed under Node `v24.18.0` after the formatting fix.
- 2026-07-22 GREEN: `make check` passed from the completed-plan path under Node `v24.18.0`; typecheck, formatting, docs, and exec-plan validation all succeeded.
- 2026-07-22 GREEN: `ora-16` re-review found no remaining critical or important issues and accepted the implementation as the approved Sequential Team MVP scope.
- 2026-07-22 NOTE: `make paseo-smoke` was intentionally not required for this phase because the runtime adapter, model resolution, process isolation, readiness probing, and runtime result-mapping contracts were not materially changed; the work stayed in control-plane admission, orchestration, and contract layers above the leaf runtime adapter.

## Completion checklist

- Accepted scope implemented and non-goals remain true.
- `/api/v1/runs` compatibility remains correct.
- Task-first public invoke/read routes are documented and tested.
- Team execution remains control-plane orchestration with leaf-only runtime calls.
- No debug residue, secret leakage, or misleading docs remain.
- All work, verification, and documentation checkboxes are checked before archive.

## Current blocker

- None.

## Next exact command

- None. Sequential Team MVP is complete in this worktree.

## Cleanup state

- No intentional background processes or temporary artifacts are active.
- Reconciled specialist lanes:
  - `fix-17` adopted
  - `fix-18` discarded as invalid/no-file result
  - `fix-19` adopted
  - `fix-20` adopted
  - `fix-21` adopted
  - `ora-15` adopted and fixed by `fix-22`
  - `fix-22` adopted
  - `ora-16` adopted as final independent review
