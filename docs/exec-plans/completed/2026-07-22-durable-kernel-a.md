---
status: completed
owner: gpt-5.4
created_at: 2026-07-22
updated_at: 2026-07-22
authority: execution-plan
---

# Durable Kernel A

## Outcome

Ship the first durable control-plane slice by making Task the canonical persisted invocation, persisting Task/Run/admission/dispatch state in PostgreSQL, adding basic claim/lease/fence execution, and preserving the current `/api/v1/runs` compatibility surface.

## Context and authority

- Authority order: user decision and accepted plan, repo Product/Feature/Component/Contract docs, this Active Exec Plan, then current implementation evidence.
- Accepted source plan: `/Volumes/AgentsWorkspace/orgs/0xdtech/tasks/active/agent-server-implementation-20260722/history/2026-07-22-durable-kernel-a-plan.md`.
- Handoff confirms the isolated execution lane already exists at `.worktrees/durable-kernel-a` on branch `agent/durable-kernel-a` and no Durable Kernel A code has started yet.
- Repo rules that must remain true: `Task` is canonical and `Run` is an attempt; domain/application code must not import Paseo directly; deterministic gates cannot depend on live model availability; prompts/credentials/raw provider errors/local paths must not leak through normal API/log paths.
- User additionally requested autonomous completion of this phase and corresponding verification using the OpenCode free provider path already proven in prior notes.

## Scope

- Add canonical persisted `Task` model and narrow Task domain invariants for root-task admission.
- Add PostgreSQL-backed persistence for Task, Run, idempotent admission, and enqueue intent.
- Keep `/api/v1/runs` POST/GET externally compatible while routing admission through durable Task/Run internals.
- Add durable queued-run claim, lease, activation, and fencing semantics for the in-process worker.
- Add deterministic unit, contract, integration, and e2e coverage for Task invariants, idempotency, persistence, claim ordering, stale-writer protection, and compatibility.
- Update docs only where implementation truth changes.

## Non-goals

- Tenant, OIDC, Membership, RLS, Workspace ACL, or Service Account work.
- Credential Broker, Tool Gateway, Approval, or capability attenuation.
- Team graph, child task tree, join semantics, nested review, or manager-worker loops.
- Artifact lineage, evidence graph, or broader workspace product layer.
- Full reconcile or `unknown` recovery semantics beyond this phase's explicit lease/fence persistence.
- Any change that makes external free-model availability a deterministic merge gate.

## Work breakdown

- [x] Verify Node 24 shell, linked worktree isolation, clean branch state, and execution lane path.
- [x] Create and take ownership of this Active Exec Plan before substantive code changes.
- [x] Introduce Task domain types and tests, then add the first durable PostgreSQL schema/migration and DB bootstrap.
- [x] Correct the reviewed Task 1 foundation gaps: source-backed migration resolution, versioned repeatable bootstrap, stronger canonical Task/Run schema invariants, Task hydration/mutation primitives, deterministic Postgres coverage, and lockfile sync.
- [x] Replace in-memory admission with transactional Task + Run + idempotency + enqueue persistence.
- [x] Correct the Oracle-reviewed Task 2 blockers without starting Task 3: accepted replay readiness bypass, same-key admission race recovery, and crash-safe migration replay.
- [x] Add durable dispatcher, queued-run claim, lease/fence completion semantics, and deterministic integration tests.
- [x] Preserve `/api/v1/runs` compatibility while extending contract tests and deterministic e2e coverage.
- [x] Update implementation-facing docs only where persistence/durability truth changed.
- [x] Run the focused loops first, then the full deterministic gate.
- [x] Run the OpenCode free-provider smoke path as requested and record whether it adds or only confirms evidence beyond deterministic gates.
- [x] Reconcile remaining risks, cleanup state, and review readiness for handoff/completion.

## Verification

- [x] `pnpm test:unit -- --run src/domain/tasks/task.test.ts` establishes Task domain invariants before admission-flow code exists.
- [x] `pnpm vitest run src/domain/tasks/task.test.ts --config vitest.unit.config.ts` establishes Task creation, hydration, and mutation invariants.
- [x] `pnpm vitest run tests/integration/durable-kernel-postgres.integration.test.ts --config vitest.integration.config.ts` establishes deterministic migration resolution, repeatable bootstrap, and canonical schema checks.
- [x] `pnpm check:types` passes with the Task 1 foundation changes.
- [x] `pnpm test:contract` establishes HTTP compatibility and idempotency semantics.
- [x] `pnpm test:integration` establishes durable admission/claim/dispatch/fence behavior.
- [x] `pnpm test:e2e` establishes real-socket POST/poll compatibility on the persistent path.
- [x] `make test-unit`
- [x] `make test-contract`
- [x] `make test-integration`
- [x] `make e2e-smoke`
- [x] `make ci`
- [x] `PASEO_SMOKE_MODEL=opencode/deepseek-v4-flash-free pnpm test:paseo-smoke` if runtime-boundary changes or to satisfy the user-requested free-provider confirmation.

## Documentation impact

- [x] Product/Feature: README and Features now reflect PostgreSQL-backed Task/Run admission, compatibility Run scope, and current baseline limitations.
- [x] Component/Contract: Architecture, Orchestration Kernel, Quality, Data/Operations, and Run API docs now reflect canonical internal Task admission plus durable dispatcher/claim/fence truth.
- [x] ADR/Runbook: no additional ADR or runbook update was required for this slice beyond the doc truth sync above.

## Decisions and discoveries

- The worktree already exists; Task 0 from the external plan is partially pre-completed and must not recreate the lane.
- Current baseline flow is `POST -> SubmitRun -> in-memory save -> queueMicrotask -> ExecuteRun -> runtime -> save terminal -> GET`, so durability work must replace both admission persistence and the in-memory background trigger path.
- Current storage seam is too narrow (`save`/`findById` only); Durable Kernel A will need explicit transactional admission plus claim/complete primitives without breaking the runtime adapter seam.
- Current tests already separate contract, integration, and e2e lanes; the new evidence path fits naturally into new Task unit tests, expanded contract tests, new Postgres integration tests, and updated persistent e2e.
- `pg@8.16.3` required `@types/pg` in this repo for `pnpm check:types` to pass after adding the Postgres bootstrap file.
- The required `pnpm test:unit -- --run src/domain/tasks/task.test.ts` invocation currently runs the full unit suite under the existing script/config wiring, so Task 1 evidence includes the new Task tests plus the rest of the unit suite.
- Oracle review found Task 1 incomplete and unsafe to proceed because migration loading was tied to compiled output, bootstrap replayed unconditional DDL, schema invariants were too weak, the Task aggregate could not cleanly rehydrate/mutate, the Postgres path lacked deterministic proof, and the lockfile lagged behind `package.json`.
- PGlite rejects multi-statement migration text through `query(...)`; the bootstrap helper must prefer `exec(...)` when available and fall back to `query(...)` for `pg` clients.
- Resolving migration files from the repository root back into `src/infrastructure/postgres/migrations/` keeps the SQL migration as the source of truth for this phase while still working from `dist/` runtime entrypoints.
- Task 2 can keep the existing `/api/v1/runs` HTTP surface while switching contract tests onto a PGlite-backed durable path; `tests/fixtures/create-test-app.ts` is now async so contract/e2e callers exercise the Postgres admission flow instead of the old in-memory repository.
- Because the Task 1 schema already reserves lease/fence columns and rejects a persisted `running` row without them, the Postgres run repository currently synthesizes minimal compatibility-only lease/fence values behind the repository boundary so the existing in-process `ExecuteRun` seam keeps working until Task 3 replaces it with real claim/lease logic.
- The prompt remains absent from HTTP responses and logs, but the durable Task now stores an encoded inline request snapshot in `tasks.input_snapshot_ref` so the compatibility Run reader can still reload the prompt without adding a `runs.prompt` column.
- Oracle review exposed that accepted idempotent replays need a pre-admission probe before readiness checks; otherwise a ready→not-ready transition can incorrectly turn a replay into `503 runtime_unavailable`.
- The durable admission flow can stay concurrency-safe without starting Task 3 by treating an admission unique-key collision as a rolled-back race, then reloading the accepted admission in a fresh transaction and suppressing duplicate execution scheduling when `reused = true`.
- Making the SQL migration idempotent at the DDL level is sufficient for this phase's crash-replay requirement: if the schema exists but the version row was never recorded, rerunning `applyDurableKernelMigrations` now succeeds and records the missing version.
- Task 3 keeps the durable queue intentionally simple by claiming directly from unpublished `run_dispatches` rows, marking the matched enqueue row published in the same transaction, and executing claimed work from a single in-process polling loop.
- The compatibility `Run` domain model still omits lease and activation fields publicly; Task 3 carries worker identity, activation ID, fence, and lease expiry only inside repository/use-case claim metadata so `/api/v1/runs` remains unchanged.
- The dispatcher can use the runtime adapter's retryable `initialize()` path as a readiness gate because failed Paseo initialization clears the cached promise and `health()` stays false until the workspace and model are ready.
- Ordered shutdown only needs two fences for this phase: stop accepting new HTTP requests first, then await `dispatcher.stop()` before closing the runtime and Postgres pool so in-flight fenced completion can finish without importing Durable Kernel B reconcile behavior.
- Task 4 finished with the public compatibility surface unchanged while contract and e2e fixtures moved onto the durable PostgreSQL path; Task 5 is limited to doc truth sync and must not invent public Task routes or broader control-plane scope.
- Production bootstrap now composes Postgres repositories plus `PostgresRunDispatcher` directly in `src/bootstrap.ts`; `InMemoryRunRepository` remains only as a narrow test double.
- Durable Kernel A made API startup require `DATABASE_URL`/`POSTGRES_URL`, so the external smoke had to self-provision a loopback Postgres-compatible endpoint instead of starting `dist/entrypoints/api/server.js` directly with no database environment.
- `@electric-sql/pglite-socket@0.2.7` required a newer PGlite API than the repo's existing `@electric-sql/pglite@0.3.14`; the smoke path now imports an isolated alias on `@electric-sql/pglite@0.5.4` because the older PGlite lacked `execProtocolRawStream`, while the deterministic suites stay on the original dependency.

## Risks and recovery

- Largest scope risk: accidentally expanding into tenant/identity/recovery semantics beyond this phase; stop if code pressure forces that boundary.
- Largest contract risk: leaking internal Task details or changing `/api/v1/runs` response shape unnecessarily.
- Largest implementation risk: mixing runtime concerns into domain/application while adding dispatcher/claim logic.
- Recovery point remains the untouched baseline branch `agent/harness-baseline`; this worktree branch isolates all new code and no migration has been run yet.

## Validation evidence

- 2026-07-22: verified Node `v24.18.0` in the worktree, branch `agent/durable-kernel-a`, linked-worktree git metadata, and clean tracked status before starting implementation.
- Baseline deterministic CI/e2e and a prior OpenCode free-provider smoke path were already proven in the handoff context; Durable Kernel A still needs its own phase-specific evidence.
- 2026-07-22: RED — after adding `src/domain/tasks/task.test.ts`, `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 && pnpm test:unit -- --run src/domain/tasks/task.test.ts` failed with `Cannot find module './task.js'` from `src/domain/tasks/task.test.ts`.
- 2026-07-22: GREEN — the same command passed after adding `src/domain/tasks/task-status.ts` and `src/domain/tasks/task.ts`; under the current Vitest script wiring it executed 7 files / 21 tests, including the new Task cases.
- 2026-07-22: `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 && pnpm install --lockfile=false` installed the newly declared Postgres dependencies locally without rewriting the lockfile.
- 2026-07-22: `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 && pnpm check:types` initially failed because `pg` declarations were missing, then passed after adding `@types/pg` to `package.json`.
- 2026-07-22: Oracle review blocked Task 2 start and sent Task 1 back for corrective work on migration loading/versioning, schema invariants, Task aggregate completeness, deterministic Postgres coverage, and lockfile sync.
- 2026-07-22: RED — `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 && pnpm vitest run src/domain/tasks/task.test.ts --config vitest.unit.config.ts` failed because `rehydrateTask` and `transitionTask` did not exist yet.
- 2026-07-22: RED — `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 && pnpm vitest run tests/integration/durable-kernel-postgres.integration.test.ts --config vitest.integration.config.ts` failed because `resolveDurableKernelMigrationFilePath` did not exist and PGlite rejected multi-command migration SQL through `query(...)`.
- 2026-07-22: GREEN — the unit command above passed after adding Task snapshot rehydration, transition helpers, and stricter Task invariants.
- 2026-07-22: GREEN — the integration command above passed after resolving migrations from repo source paths, tracking applied migration versions, using `exec(...)` for multi-statement bootstrap where needed, and strengthening SQL constraints for Task/Run shape.
- 2026-07-22: GREEN — `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 && pnpm add pg@8.16.3 && pnpm add -D @electric-sql/pglite@0.3.14 @types/pg@8.15.5` rewrote `pnpm-lock.yaml` to match the already-declared Task 1 dependencies.
- 2026-07-22: GREEN — `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 && pnpm check:types` passed after the corrective Task 1 changes.
- 2026-07-22: RED — `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 && pnpm vitest run tests/contract/runs.contract.test.ts --config vitest.contract.config.ts` failed as expected after adding idempotency contract coverage because repeated POSTs with the same `Idempotency-Key` still created different run IDs and mismatched bodies still returned `202`.
- 2026-07-22: RED — `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 && pnpm vitest run tests/integration/durable-kernel-postgres.integration.test.ts --config vitest.integration.config.ts` failed as expected after adding Task 2 admission coverage because `src/application/tasks/admit-root-task.ts` and the new Postgres repositories did not exist yet.
- 2026-07-22: GREEN — the targeted integration command above passed after adding transactional admission, Postgres Task/Run/admission repositories, durable enqueue rows, and idempotency conflict handling.
- 2026-07-22: GREEN — the targeted contract command above passed after routing `POST /api/v1/runs` through the durable admission wrapper and honoring the `Idempotency-Key` header.
- 2026-07-22: GREEN — `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 && pnpm test:contract` passed after moving the contract fixture onto the durable Postgres-backed path.
- 2026-07-22: GREEN — `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 && pnpm check:types` passed with the Task 2 durable admission changes.
- 2026-07-22: Oracle review then blocked Task 2 completion because accepted same-key replays could still return `503`, same-key admission was not concurrency-safe under a unique-key race, migration replay could fail when schema existed without a recorded version row, and replayed POSTs still queued a second execution attempt.
- 2026-07-22: RED — `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 && pnpm vitest run src/entrypoints/api/routes/runs.test.ts src/application/tasks/admit-root-task.test.ts --config vitest.unit.config.ts` failed after adding focused replay-scheduling and admission-race tests because the route still re-queued reused admissions and the use case still surfaced the save-race error.
- 2026-07-22: RED — `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 && pnpm vitest run tests/contract/runs.contract.test.ts --config vitest.contract.config.ts` failed after adding accepted-replay readiness coverage because a ready→not-ready transition still produced `503 runtime_unavailable` on a same-key replay.
- 2026-07-22: RED — `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 && pnpm vitest run tests/integration/durable-kernel-postgres.integration.test.ts --config vitest.integration.config.ts` failed after adding crash-replay coverage because rerunning the migration against an already-applied schema still raised `relation "tasks" already exists`.
- 2026-07-22: GREEN — `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 && pnpm vitest run src/entrypoints/api/routes/runs.test.ts src/application/tasks/admit-root-task.test.ts --config vitest.unit.config.ts` passed after adding an accepted-replay probe to `SubmitRun`, returning `reused` metadata through the route, suppressing duplicate execution scheduling, and recovering admission unique-key races by reloading the accepted row after rollback.
- 2026-07-22: GREEN — `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 && pnpm vitest run tests/integration/durable-kernel-postgres.integration.test.ts --config vitest.integration.config.ts` passed after making the migration DDL idempotent enough to replay cleanly and recording versions with `ON CONFLICT DO NOTHING`.
- 2026-07-22: GREEN — `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 && pnpm test:contract` passed with the accepted-replay readiness bypass in place and no public `POST /api/v1/runs` or `GET /api/v1/runs/:id` shape changes.
- 2026-07-22: GREEN — `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 && pnpm check:types` passed after the Task 2 blocker corrections.
- 2026-07-22: RED — `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 && pnpm vitest run tests/integration/durable-kernel-postgres.integration.test.ts --config vitest.integration.config.ts` failed after adding Task 3 claim/fence/dispatcher coverage because `complete-run.ts`, `claim-next-run.ts`, and `postgres-run-dispatcher.ts` did not exist yet.
- 2026-07-22: RED — `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 && pnpm vitest run src/entrypoints/api/routes/runs.test.ts --config vitest.unit.config.ts` failed after tightening the route test because `POST /api/v1/runs` still directly scheduled inline execution.
- 2026-07-22: GREEN — `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 && pnpm vitest run tests/integration/durable-kernel-postgres.integration.test.ts --config vitest.integration.config.ts` passed after adding explicit atomic claim and fenced completion repository primitives, wiring `ExecuteRun` through durable claims, and starting the in-process Postgres dispatcher loop.
- 2026-07-22: GREEN — `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 && pnpm vitest run src/entrypoints/api/routes/runs.test.ts --config vitest.unit.config.ts` passed after removing direct route-to-executor coupling.
- 2026-07-22: GREEN — `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 && pnpm test:contract` passed with the dispatcher-backed `createTestApp` fixture and unchanged public `/api/v1/runs` request/response shapes.
- 2026-07-22: GREEN — `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 && pnpm test:integration` passed with durable admission plus Task 3 claim/dispatch/fence coverage.
- 2026-07-22: GREEN — `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 && pnpm test:e2e` passed with real-socket POST/poll flow now driven by the background dispatcher instead of route inline execution.
- 2026-07-22: GREEN — `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 && pnpm check:types` passed after the Task 3 repository, dispatcher, and route wiring changes.
- 2026-07-22: RED — `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 >/dev/null && pnpm vitest run src/infrastructure/postgres/postgres-run-dispatcher.test.ts --config vitest.unit.config.ts` failed after adding the runtime-readiness regression because the dispatcher still claimed work before any readiness gate.
- 2026-07-22: GREEN — the same dispatcher command passed after gating dispatch on runtime readiness via `ExecuteRun.ensureRuntimeReady()` so unavailable runtime states no longer claim queued work.
- 2026-07-22: RED — `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 >/dev/null && pnpm vitest run src/bootstrap.test.ts src/entrypoints/api/shutdown.test.ts --config vitest.unit.config.ts` failed after adding lifecycle shutdown regressions because ordered close helpers did not exist yet.
- 2026-07-22: GREEN — the same lifecycle command passed after closing the HTTP server first and then sequencing dispatcher → runtime → database shutdown.
- 2026-07-22: GREEN — `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 >/dev/null && pnpm vitest run src/infrastructure/postgres/postgres-run-dispatcher.test.ts src/bootstrap.test.ts src/entrypoints/api/shutdown.test.ts --config vitest.unit.config.ts` passed as focused Task 3 lifecycle evidence.
- 2026-07-22: GREEN — `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 >/dev/null && pnpm test:contract` remained green after the lifecycle fixes.
- 2026-07-22: GREEN — `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 >/dev/null && pnpm test:integration` remained green after the lifecycle fixes.
- 2026-07-22: GREEN — `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 >/dev/null && pnpm test:e2e` remained green after the lifecycle fixes.
- 2026-07-22: GREEN — `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 >/dev/null && pnpm check:types` passed after adding the new focused lifecycle tests.
- 2026-07-22: GREEN — `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 >/dev/null && pnpm check:docs` passed after syncing README, contracts, architecture, quality, component, and feature docs to the durable PostgreSQL-backed implementation.
- 2026-07-22: GREEN — `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 >/dev/null && pnpm check:exec-plans` passed after updating Durable Kernel A Task 4/5 plan truth and validation notes.
- 2026-07-22: RED — `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 >/dev/null && PASEO_SMOKE_MODEL=opencode/deepseek-v4-flash-free pnpm test:paseo-smoke` failed because the smoke started `dist/entrypoints/api/server.js` without `DATABASE_URL` or `POSTGRES_URL`, and the API exited immediately with `Postgres connection string must be provided via DATABASE_URL or POSTGRES_URL` in `.local/smoke/2026-07-22T10-18-42-887Z-29140/agent-server.log`.
- 2026-07-22: RED — `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 >/dev/null && node --input-type=module -e "import { PGlite } from '@electric-sql/pglite'; import { PGLiteSocketServer } from '@electric-sql/pglite-socket'; import pg from 'pg'; const db = new PGlite(); const server = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1', debug: true }); await server.start(); const conn = server.getServerConn(); const client = new pg.Client({ connectionString: 'postgresql://postgres:postgres@' + conn + '/postgres', ssl: false }); await client.connect();"` failed while evaluating the proposed smoke fix because `@electric-sql/pglite-socket@0.2.7` called `db.execProtocolRawStream()`, which does not exist on `@electric-sql/pglite@0.3.14`.
- 2026-07-22: GREEN — `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 >/dev/null && node --input-type=module -e "import { PGlite } from '@electric-sql/pglite-smoke'; import { PGLiteSocketServer } from '@electric-sql/pglite-socket'; import pg from 'pg'; const db = new PGlite(); const server = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1' }); await server.start(); const conn = server.getServerConn(); const client = new pg.Client({ connectionString: 'postgresql://postgres:postgres@' + conn + '/postgres', ssl: false }); await client.connect(); const result = await client.query('select 1 as n'); await client.end(); await server.stop(); await db.close(); if (result.rows[0]?.n !== 1) throw new Error('unexpected query result');"` passed after isolating `@electric-sql/pglite@0.5.4` behind the smoke-only alias, proving the loopback Postgres shim works with this repo's `pg` client without changing deterministic PGlite test behavior.
- 2026-07-22: GREEN — `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 >/dev/null && pnpm vitest run tests/integration/durable-kernel-postgres.integration.test.ts --config vitest.integration.config.ts` still passed after isolating the smoke-only PGlite alias, confirming the deterministic Postgres coverage stayed on the original `@electric-sql/pglite@0.3.14` path.
- 2026-07-22: GREEN — `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 >/dev/null && pnpm check:types` passed with the smoke-only Postgres bootstrap changes.
- 2026-07-22: GREEN — `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 >/dev/null && PASEO_SMOKE_MODEL=opencode/deepseek-v4-flash-free pnpm test:paseo-smoke` passed after starting a loopback PGlite socket server inside `scripts/smoke/paseo-opencode.mjs` and injecting `DATABASE_URL`/`POSTGRES_URL=postgresql://postgres:postgres@127.0.0.1:<ephemeral-port>/postgres`; evidence written to `.local/smoke/2026-07-22T10-24-03-327Z-39002/evidence.json`.
- 2026-07-22: GREEN — `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 && make test-unit && make test-contract && make test-integration && make e2e-smoke && make ci` passed end-to-end after the final formatting/doc/smoke updates, covering 29 unit tests, 13 contract tests, 14 integration tests, 1 deterministic e2e test, docs checks, exec-plan checks, and a production TypeScript build from the final tree.
- 2026-07-22: GREEN — `export NVM_DIR="/Users/fanye/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 && PASEO_SMOKE_MODEL=opencode/deepseek-v4-flash-free pnpm test:paseo-smoke` passed again from the final tree with `{"success":true,"database":"pglite-socket","marker":"PASEO_OPENCODE_BASELINE_OK","provider":"opencode","model":"opencode/deepseek-v4-flash-free","status":"succeeded"}` and evidence written to `.local/smoke/2026-07-22T10-26-12-530Z-42967/evidence.json`.

## Completion checklist

- [x] Final diff matches accepted Durable Kernel A scope and non-goals.
- [x] Every new behavior was introduced with a failing test first and corresponding passing evidence.
- [x] Deterministic verification chain is green.
- [x] Free-provider smoke evidence is recorded or its omission is explicitly justified.
- [x] Production bootstrap no longer depends on `InMemoryRunRepository`.
- [x] Migration file is the schema source of truth for this phase.
- [x] Docs/plan reflect shipped truth with no hidden unfinished scope.

## Current blocker

None.

## Next exact command

None.

## Cleanup state

Deterministic verification in this phase uses ephemeral PGlite migrations and fake runtimes; the external smoke provisions an isolated loopback PGlite socket plus isolated Paseo/OpenCode runtime homes under ignored `.local/smoke/`. The successful smoke script enforces child-process cleanup, and no long-lived local Postgres or Paseo process should remain running after the final green run.
