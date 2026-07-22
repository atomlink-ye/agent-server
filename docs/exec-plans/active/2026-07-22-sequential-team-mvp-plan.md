---
status: active
owner: gpt-5.4
created_at: 2026-07-22
updated_at: 2026-07-22
authority: implementation-plan
---

# Sequential Team MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable Agent/Team definitions, immutable published versions, a canonical Task-first invoke/read API, and a sequential Team coordinator that materializes child Tasks and child Runs while keeping the runtime leaf-agent only.

**Architecture:** Persist AgentVersion and TeamVersion resources in PostgreSQL, compile a sequential-only Team subset at publish time, admit root work through `POST /api/v1/tasks:invoke`, execute Agent root Tasks directly, execute Team root Tasks through a control-plane sequential coordinator, and keep `/api/v1/runs` unchanged as a compatibility route.

**Tech Stack:** TypeScript, Hono, Zod, PostgreSQL/PGlite, Vitest

---

### Task 1: Definition/version registry and compiler foundation

**Files:**

- Create: `src/domain/invokables/*`
- Create: `src/application/invokables/*`
- Create: `src/application/ports/invokable-repository.ts`
- Create: `src/infrastructure/postgres/postgres-invokable-repository.ts`
- Create: `src/infrastructure/postgres/migrations/0003_sequential_team_mvp.sql`
- Modify: `tests/integration/durable-kernel-postgres.integration.test.ts`
- Modify: `src/shared/config.ts` only if config helpers are needed for tests

- [x] Write failing unit tests for AgentVersion, TeamVersion, and sequential Team compiler rules.
- [x] Run the focused unit tests and verify RED.
- [x] Implement minimal domain types, repository interfaces, migration, and sequential Team compiler.
- [x] Run the focused unit and integration tests again and verify GREEN.

### Task 2: Canonical Task API and Task read/tree queries

**Files:**

- Create: `src/contracts/tasks.ts`
- Create: `src/entrypoints/api/routes/tasks.ts`
- Create: `src/application/tasks/invoke-task.ts`
- Create: `src/application/tasks/get-task.ts`
- Create: `src/application/tasks/get-task-tree.ts`
- Modify: `src/domain/tasks/task.ts`
- Modify: `src/domain/tasks/task-status.ts`
- Modify: `src/application/ports/task-repository.ts`
- Modify: `src/infrastructure/postgres/postgres-task-repository.ts`
- Modify: `src/bootstrap.ts`
- Modify: `src/entrypoints/api/app.ts`
- Modify: `tests/fixtures/create-test-app.ts`
- Create or modify: `tests/contract/tasks.contract.test.ts`

- [x] Write failing contract/unit/integration tests for `POST /api/v1/tasks:invoke`, `GET /api/v1/tasks/{id}`, and `GET /api/v1/tasks/{id}/tree`.
- [x] Run those focused tests and verify RED.
- [x] Implement the new Task API, Task query services, Task snapshot extensions, and PostgreSQL query support.
- [x] Re-run the focused tests and verify GREEN.

### Task 3: Sequential Team execution and child genealogy

**Files:**

- Create: `src/application/tasks/execute-team-task.ts`
- Modify: `src/application/runs/execute-run.ts`
- Modify: `src/application/runs/complete-run.ts`
- Modify: `src/application/ports/run-repository.ts`
- Modify: `src/infrastructure/postgres/postgres-run-repository.ts`
- Modify: `src/domain/runs/run-status.ts`
- Modify: `src/domain/tasks/task.test.ts`
- Modify: `tests/integration/durable-kernel-postgres.integration.test.ts`
- Modify: `tests/fixtures/fake-agent-runtime.ts`

- [x] Write failing tests for root AgentVersion execution, sequential Team child materialization, child lineage, and Team final-output propagation.
- [x] Run the focused integration/unit tests and verify RED.
- [x] Implement the Team coordinator, child-task/run persistence, task-status transitions, and inline child-run claim/complete support.
- [x] Re-run the focused tests and verify GREEN.

### Task 4: API/doc truth sync and compatibility verification

**Files:**

- Modify: `README.md`
- Modify: `docs/features.md`
- Modify: `docs/components/control-plane.md`
- Modify: `docs/components/orchestration-kernel.md`
- Modify: `docs/contracts.md`
- Modify: `docs/contracts/run-api.md`
- Create: `docs/contracts/task-api.md`
- Create: `docs/contracts/agent-team-api.md`
- Create: `docs/decisions/0005-sequential-team-mvp.md`
- Modify: `e2e/run.e2e.test.ts`
- Modify: current Active Exec Plan while working

- [x] Update docs to reflect the real Sequential Team MVP boundary and preserve `/api/v1/runs` compatibility truth.
- [x] Run `pnpm check:docs` and `pnpm check:exec-plans`.
- [x] Re-run `/api/v1/runs` compatibility contract/e2e checks and the deterministic gate.
- [x] Record evidence, remaining risks, and archive the completed execution plan.

### Oracle follow-up: ora-15 hardening

- [x] Replace the `/api/v1/runs` compatibility root-task invokable sentinel with a reserved UUID so compatibility-admitted Tasks remain representable by the Task API contract.
- [x] Tighten published Agent/Team version lookups from tenant-only to the current authenticated owner scope.
- [x] Persist published Team versions and compiled plans through one repository write so reads do not observe a published Team version without its compiled plan.
- [x] Align PostgreSQL task-step shape checks with the root-vs-child `logicalStepKey`/`nodePath` domain invariants.
- [x] Run focused RED/GREEN coverage for the ora-15 fixes and `pnpm check:types`.

Validation notes:

- RED: `pnpm exec vitest run --config vitest.unit.config.ts src/application/tasks/admit-root-task.test.ts`
- RED: `pnpm exec vitest run --config vitest.unit.config.ts src/application/invokables/sequential-team-compiler.test.ts`
- RED: `pnpm exec vitest run --config vitest.contract.config.ts tests/contract/tasks.contract.test.ts`
- RED: `pnpm exec vitest run --config vitest.integration.config.ts tests/integration/durable-kernel-postgres.integration.test.ts`
- GREEN: `pnpm exec vitest run --config vitest.unit.config.ts src/application/tasks/admit-root-task.test.ts src/application/invokables/sequential-team-compiler.test.ts src/domain/tasks/task.test.ts src/application/tasks/invoke-task.test.ts`
- GREEN: `pnpm exec vitest run --config vitest.contract.config.ts tests/contract/tasks.contract.test.ts`
- GREEN: `pnpm exec vitest run --config vitest.integration.config.ts tests/integration/durable-kernel-postgres.integration.test.ts`
- GREEN: `pnpm exec vitest run --config vitest.contract.config.ts tests/contract/runs.contract.test.ts`
- GREEN: `pnpm exec vitest run --config vitest.e2e.config.ts e2e/run.e2e.test.ts`
