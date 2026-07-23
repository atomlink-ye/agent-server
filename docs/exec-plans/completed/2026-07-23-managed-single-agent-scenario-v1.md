---
status: completed
owner: platform-engineering
created_at: 2026-07-23
updated_at: 2026-07-23
authority: execution-plan
---

# Managed Single-Agent Scenario V1 — Completed Exec Plan

> API/SSE-only delivery for the approved spec. Execute P0, then A through H. Every
> item has a stable label, keeps checkbox syntax, and ends in a phase gate commit
> and review. Multiple coherent commits are allowed within a phase; no phase
> requires one oversized commit.

## Goal and boundaries

Deliver the approved YAML → immutable Agent Version → private Workspace/Fresh
Session → durable Message/Task/Run → Paseo execution → normalized events/SSE →
governed Memory Proposal → immutable verified `MEMORY.md` snapshot → later Fresh
Session recall journey. Paseo is the only runtime; callers cannot choose models.
There is no UI, Team/ScenarioVersion, shared ACL, OIDC/SAML/SCIM, vector search,
embedding/RAG, global memory, schedule/trigger, multi-node worker, Redis/event
bus/object storage, or direct runtime write to formal memory.

Authority is the explicit approved decision, then
`docs/exec-plans/completed/2026-07-23-managed-single-agent-scenario-v1-spec.md`,
then repository contracts/components/operations docs, then code and tests as
evidence. Baseline commit is `3e5e61d`; Paseo is `0.1.110`; authentication is
the existing service-account bearer contract.

## Execution tempo and review triage

The current user directive prioritizes the minimum viable A-H vertical slice
and a working end-to-end scenario over production-grade completeness within any
single phase.

- Advance a phase once its core happy path, essential owner/failure boundary,
  immediate integration seam, and downstream dependency are proven.
- Fix a review finding immediately only when it blocks minimum phase acceptance,
  a later phase, focused verification/migration, or core-path data/owner safety.
- Classify non-blocking hardening, defense in depth, uncommon edge/recovery
  cases, exhaustive coverage, performance, maintainability, cleanup, and polish
  as `deferred_hardening`; record an owner/target in the Follow-up Ledger or
  post-E2E backlog and continue.
- `CHANGES_REQUIRED` is review input, not an automatic requirement to close
  every finding before advancing. The orchestrator records each finding as
  `phase_blocker` or `deferred_hardening`.
- Prefer focused tests and one minimum phase review. Do not repeat broad gates or
  review loops after every micro-change when remaining issues do not block the
  next phase.
- After the primary API/SSE/E2E A-H transcript passes, run the consolidated
  security, reliability, edge-case, simplification, performance, and production
  hardening pass.

Specialist lifecycle for this plan is: consume the terminal result, classify
its findings, call `reconcile_task`, and reuse a matching session only with an
explicit `task_id`. All terminal jobs must be reconciled before the final
response.

## P0 truth and control record

The worktree already contains the approved spec, this active plan, the
`.gitignore` addition `.slim/deepwork/`, the new `.ignore` allow rules for
`.slim/deepwork/`, and ignored deepwork state. P0 must stage and commit
`.gitignore`, `.ignore`, the approved spec, and this plan. Deepwork state remains
ignored. This plan must not claim that only the plan changed or that no ignore
rule exists. The existing Makefile/package surface already includes `make
eval-smoke` → `pnpm eval:smoke`; G/H use that exact command and do not invent a
second target.

Baseline Node 24 evidence already exists: `make setup && make ci` passed with 59
unit, 42 contract, 23 integration, 1 E2E, and green docs/types/build checks.
P0 locally re-verifies `make check`, records the result, and commits the
planning artifacts. No implementation is claimed by this control record.

## File ownership map

Only the owning phase may add a listed new file. Shared current files require
the phase owner to preserve earlier gates.

| Phase | Current paths                                                                                                                                                          | New paths owned by phase                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0    | `.gitignore`, `.ignore`, approved spec, this plan, `.slim/deepwork/managed-single-agent-v1.md`, `Makefile`, `package.json`                                             | this plan; no new implementation target                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| A     | `src/application/tasks/invoke-task.ts`, `src/application/runs/execute-run.ts`, Paseo adapter/port, Postgres bootstrap/migrations 0001–0004, `package.json`, `Makefile` | `.github/workflows/ci.yml`; `src/application/tasks/invoke-task.test.ts`; `src/application/runs/execute-run.test.ts`; `tests/integration/real-pg-pool.integration.test.ts`; `tests/integration/paseo-capabilities.integration.test.ts`; `docs/operations/follow-up-ledger.md`                                                                                                                                                                                                                                                                                            |
| B     | invokable repositories, API bootstrap/routes, shared config, `package.json`                                                                                            | `src/domain/agents/managed-agent-package.ts`; `src/domain/agents/managed-agent-package.test.ts`; `src/application/agents/*`; `src/application/agents/import-agent.test.ts`; `src/application/ports/agent-registry.ts`; `src/infrastructure/postgres/migrations/0005_managed_agent_registry_b.sql`; `src/infrastructure/postgres/migrations/0005b_managed_agent_registry_hardening.sql`; `src/entrypoints/api/routes/agents.ts`; `src/contracts/agents.ts`; `tests/contract/agents.contract.test.ts`; `tests/integration/agent-registry-postgres.integration.test.ts`    |
| C     | task/run application and repositories, API bootstrap, test fixture                                                                                                     | `src/domain/workspaces/*`; `src/domain/sessions/*`; `src/domain/messages/*`; `src/application/workspaces/*`; `src/application/sessions/*`; workspace/session ports and repositories; `src/infrastructure/postgres/migrations/0006_workspace_session_lane_c.sql`; workspace routes/contracts; `tests/contract/workspaces.contract.test.ts`; `tests/integration/session-lane-postgres.integration.test.ts`; `tests/integration/migrations/0006-workspace-session-lane.integration.test.ts`                                                                                |
| D     | runtime port/adapter, `src/application/runs/execute-run.ts`, run routes/contracts, fixtures                                                                            | `src/domain/runs/run-event.ts`; `src/application/runs/read-run-events.ts`; `src/application/runs/stream-run-events.ts`; `src/application/runs/cancel-task.ts`; event port/repository/routes; `src/infrastructure/postgres/migrations/0007_runtime_events_d.sql`; `tests/contract/run-events.contract.test.ts`; `tests/integration/runtime-events-postgres.integration.test.ts`; `tests/integration/migrations/0007-runtime-events.integration.test.ts`                                                                                                                  |
| E     | existing workspace-memory proposal code and migration 0004                                                                                                             | `src/domain/workspace-memory/memory-entry.ts`; `src/domain/workspace-memory/memory-snapshot.ts`; `src/application/memory/render-memory-snapshot.ts`; `src/application/memory/rebuild-memory-snapshot.ts`; `src/application/ports/file-store.ts`; `src/infrastructure/files/local-file-store.ts`; `src/infrastructure/postgres/migrations/0008_managed_memory_e.sql`; `tests/contract/workspace-memory-snapshots.contract.test.ts`; `tests/integration/memory-projection.integration.test.ts`; `tests/integration/migrations/0008-memory-projection.integration.test.ts` |
| F     | `src/application/ports/agent-runtime.ts`, `src/application/runs/execute-run.ts`, sessions, local FileStore                                                             | `src/application/context/*`; `src/application/sessions/create-fresh-session.ts`; `tests/integration/context-assembly.integration.test.ts`; `e2e/managed-single-agent.e2e.test.ts`                                                                                                                                                                                                                                                                                                                                                                                       |
| G     | memory policy routes/docs                                                                                                                                              | `src/domain/memory-policy/*`; policy/evaluation/gardener code and port; `tests/unit/memory-policy.test.ts`; `tests/integration/memory-evaluation.integration.test.ts`; `tests/fixtures/memory-eval-dataset.ts`; `docs/evaluations/managed-single-agent-v1-memory-dataset.json`. No Makefile/package target is added: use existing `make eval-smoke`.                                                                                                                                                                                                                    |
| H     | all prior artifacts and release docs                                                                                                                                   | `tests/integration/managed-single-agent-faults.integration.test.ts`; `tests/contract/managed-single-agent-transcript.contract.test.ts`; `scripts/recovery/managed-single-agent-reconcile.mjs`; `docs/operations/managed-single-agent-v1-runbook.md`; `docs/decisions/0007-managed-single-agent-scenario-v1.md`; `docs/evidence/managed-single-agent-v1-evidence-packet.md`                                                                                                                                                                                              |

## Ordered work breakdown

### P0 — Plan control

- [x] **P0-1 (truth):** Reconcile this plan with the approved spec and deepwork state; record the existing `.gitignore`, `.ignore`, spec, plan, and ignored-state facts, source revision, owner, dates, phase order, migration ownership, non-goals, blocker, and evidence IDs.
- [x] **P0-2 (baseline):** Run `node --version`, `pnpm --version`, and locally re-run `make check`. Record Node 24 baseline evidence already available from `make setup && make ci` (59 unit, 42 contract, 23 integration, 1 E2E; docs/types/build green) plus the local check result. Missing `DATABASE_URL` is not relevant to this deterministic check.
- [x] **P0-3 (planning commit):** Stage only `.gitignore`, `.ignore`, the approved spec, and this plan; leave `.slim/deepwork/` ignored; commit `docs: control managed single-agent v1 plan`. Review the staged diff and record `P0-PLAN`, `P0-NODE24`, and `P0-COMMIT`.

### A — Stabilization and real PostgreSQL lane

- [x] **A-1 (RED):** Add regressions for transaction-bound admission visibility, runtime success followed by terminal persistence failure, and Paseo reconnect. Run focused unit/adapter commands and record the three defects; absence of a real PostgreSQL URL is not an expected RED result.
- [x] **A-2 (domain/interface):** Add typed application-level `RuntimeExecutionReceipt` plus repository failure classification and an observable reconciliation record compatible with the existing schema. Do not add a schema migration in A; durable receipt columns/table belong to D migration `0007`.
- [x] **A-3 (migration/repository):** Fix transaction-scoped Task reload/return, terminal outcome classification, and disconnected adapter initialization. Add the real dual-connection test using `pg.Pool` and migration set 0001–0004.
- [x] **A-4 (real-PG lane):** Run the environment-gated command `test -n "${DATABASE_URL:-}" && pnpm exec vitest run --config vitest.integration.config.ts tests/integration/real-pg-pool.integration.test.ts`. It must use a real `DATABASE_URL`; CI provisions PostgreSQL and runs it as a required lane. A missing URL is SKIP only in the ordinary local deterministic suite, but FAIL in the real-PG required lane. Never substitute PGlite.
- [x] **A-5 (wiring/CI):** Add the Node 24 PostgreSQL CI workflow at `.github/workflows/ci.yml`, preserve Node 22 compatibility, and record Paseo capability/smoke and residual follow-up evidence without secrets, paths, or raw provider errors.
- [x] **A-6 (GREEN/docs/gate):** Rerun focused tests, `make test-unit`, `make test-integration`, `make paseo-smoke`, `pnpm check`, and docs checks; update contracts/components/features/runbook and the ledger; make a migration, behavior, and docs/gate commit as needed; finish with `fix: stabilize managed single-agent admission and runtime lane` and `A-ORACLE` review.

### B — Managed Agent YAML and registry API

- [x] **B-1 (RED):** Add parser/domain/application/contract tests for safe YAML 1.2 parsing, disabled aliases/anchors, strict restricted JSON Schema, exact `{{ input.<field> }}` template grammar, bounded secret scanning without echo, and built-in free-only model policy.
- [x] **B-2 (interface/domain/GREEN):** Implement exact package types, normalization, canonical JSON/SHA-256 fingerprint, template compiler, schema validator, owner-scoped AgentDefinition, and immutable AgentVersion; rerun B-1 tests GREEN.
- [x] **B-3 (migration/repository):** Add `0005`, the Phase-B forward repair `0005b`, registry port/repository, idempotency, owner constraints, and integration coverage for migration replay, races, owner hiding, database immutability, and tied cursor traversal.
- [x] **B-4 (route/application wiring):** Add validate/import/read/version/publish routes and contracts; enforce idempotency, owner hiding, published immutability, and Task acceptance only for published versions.
- [x] **B-5 (docs/evidence):** Update the managed registry component, operations, quality, and active-plan evidence record.
- [x] **B-6 (gate):** Run unit, contract, integration, and `pnpm check`; commit migration, behavior, and docs/gate changes explicitly, ending with `feat: add managed agent registry and package validation` and `B-ORACLE`.

### C — Workspace, Product Session, durable Message, and Session Lane

- [x] **C-1 (RED):** Add tests for three concurrent follow-ups, one active root, monotonic ordering, multiple private Workspace ownership, atomic admission, cancel-then-drain, and reset generation. Task terminal status includes `cancelled`; failure/reason code is `cancelled_by_reset`. Do not invent a top-level task status string if the current domain represents it in failure details.
- [x] **C-2 (interface/domain):** Implement Workspace, ProductSession, Message, SessionLane, owner-derived access, and repository contracts with queued follow-ups and one active root.
- [x] **C-3 (migration/repository):** Add migration 0006 and migration integration test; one transaction inserts Message, Task, Run attempt 1, idempotency, dispatch intent, and queue metadata before 202.
- [x] **C-4 (route/application wiring):** Add Workspace/Session/Message/reset routes, safe errors, body limits, idempotency, owner hiding, reset cancellation, old-generation terminalization as `cancelled_by_reset`, and new generation behavior.
- [x] **C-5 (GREEN/docs/evidence):** Rerun domain, contract, migration, and lane tests; update contracts/features/components/runbook; record `C-LANE`, `C-TRANSACTION`, `C-RESET`, `C-ROUTES`, and `C-AUTH`.
- [x] **C-6 (gate):** Run focused unit, contract, integration, and `pnpm check`; commit migration, behavior, and docs/gate changes explicitly, ending with `feat: add private workspaces and durable session lanes` and `C-ORACLE`.

### D — Runtime sessions, events, SSE, and cancel (MVP complete)

- [x] **D-1 (RED):** Add the minimum regressions for normalized events, cursor/SSE replay, final Message, cancellation, owner hiding, and safe payloads. Full Runtime Session V2, incremental deltas, rich usage, retry, and receipt recovery are outside the MVP-first RED scope.
- [x] **D-2 (interface/domain):** Preserve `execute()` and health; add only the minimal cancel seam, runtime binding, safe normalized event envelope, and terminal lifecycle behavior without exposing provider wire objects or raw errors.
- [x] **D-3 (migration/repository):** Add and replay migration 0007 for RuntimeSessionBinding, RunEvent, cancellation columns, assistant role, and monotonic sequence constraints. Do not claim production atomic crash recovery or durable receipts.
- [x] **D-4 (route/application wiring):** Add authenticated event page/SSE replay with cursor/Last-Event-ID and terminal close, owner-scoped Task cancel, final assistant Message persistence, lane advancement, and safe redaction.
- [x] **D-5 (GREEN/docs/evidence):** Update runtime/run/event contracts, components, features, runbook, and follow-up ledger. Record focused Node 24 evidence: contract 30, real-PG session lifecycle 1, unit 12, and green checks.
- [x] **D-6 (gate):** Blocker-only Oracle identified five core blockers; all five were fixed. Commits are `3fa30de` (behavior), `7ad0542` (blocker fixes), and formatting-only `b43eddf`; docs closeout follows this plan update. Phase E is next. No claim is made for production atomic crash recovery or full SDK session API.

### E — Memory ownership and immutable file snapshots

- [x] **E-1 (RED):** Added focused coverage for ownership boundaries, legacy separation, provenance, accept/edit/reject, deterministic rendering, projection failure, hashes, versioning, and rebuild under the MVP-first policy.
- [x] **E-2 (interface/domain):** Implemented the minimum immutable owned-entry/snapshot/projection model, deterministic renderer, manifest/hash, and FileStore port/local implementation.
- [x] **E-3 (migration/repository):** Added and registered migration 0008 with owned entries, provenance fields, monotonic snapshots, hashes, and projection status.
- [x] **E-4 (route/application wiring):** Added proposal lookup plus authenticated entry/snapshot/detail/rebuild routes, local atomic projection, latest-ready publication, and hidden foreign-workspace behavior. A blocker-only Oracle found missing auth on the product Workspace route family; commit `3054469` fixed it.
- [x] **E-5 (GREEN/docs/evidence):** Node 24 focused evidence: workspace-memory contract 13, managed-memory/review unit 3, migration integration 19 previously, with checks/build green. E does not prove old-task admission pinning or old-task stability; those belong to F, and it makes no production crash-recovery claim.
- [x] **E-6 (gate):** Phase commits are `36de606` (`feat: add owned immutable memory snapshots`) and `3054469` (`fix: authenticate workspace memory projections`). Minimum docs/gate closeout follows this plan update; Phase F is next.

**Phase E closeout:** Product Workspace accepted entries are immutable snapshot
inputs, rendered and hash-verified into local `MEMORY.md`/`manifest.json`.
Legacy principal-private entries remain separate. Deferred hardening is
consolidated in `E-HARDENING-001`; no old-task snapshot pinning or production
crash-recovery claim is made.

### F — Context assembly and Fresh Session memory projection

- [x] **F-1 (RED):** Added tests for the implemented minimum context order, admission-pinned snapshot/hash, verified read, no old-session history, and fail-closed mismatch behavior. Broader context and resume cases remain deferred.
- [x] **F-2 (interface/domain):** Implemented `assembleContext`, exact pinned projection reads, and fail-closed execution when the pinned projection is missing or mismatched.
- [x] **F-3 (route/application wiring):** Implemented Fresh ProductSession creation with explicit published AgentVersion, same owner-visible Workspace, ready snapshot selection at first message, and no old Message History in context; no new production migration.
- [x] **F-4 (GREEN/E2E):** Added deterministic real-socket recall coverage for accepted memory, rejected content, late-after-admission content, foreign Workspace hiding, and final assistant Message persistence.
- [x] **F-5 (GREEN/docs/evidence):** Node 24 focused evidence: context/memory unit 6, workspace-memory contract 14, Fresh Session E2E 1, earlier migration integration 19, and green checks. This does not claim provider-native mount, context beyond the implemented minimum, or production durability.
- [x] **F-6 (gate):** Phase commits are `603e329` (`feat: assemble pinned fresh-session context`) and `51f0f98` (`fix: scope memory proposals to product workspace`). A blocker-only Oracle found the source Task Product Workspace scope issue; `51f0f98` fixed it. Phase G is next.

**Phase F closeout:** Fresh ProductSession recall now uses the exact ready
snapshot ID/hash pinned during first-message admission and verifies that local
projection before assembling the minimum context. Deferred hardening is
consolidated in `F-HARDENING-001`; no provider-native mount or production
durability claim is made.

### G — Auto-safe Memory and Gardener

- [x] **G-1 (RED/eval):** Added the versioned dataset and deterministic tests for disabled/proposal/auto_safe, exact category allowlist, trusted sources, conservative secret/PII/conflict/action/instruction rejection, and zero-tolerance counters.
- [x] **G-2 (interface/domain):** Implemented versioned safe policy decisions, default-off behavior, and traces containing only the documented redacted fields; no migration was needed.
- [x] **G-3 (route/application wiring):** Implemented typed proposal delegation and proposal-only duplicate/supersession/expiry suggestions. The existing manual proposal/review path remains unchanged; no model gardener or durable mutation was added.
- [x] **G-4 (GREEN/docs/evidence):** Node 24 evidence: policy/gardener unit 3, evaluation integration 1, `make eval-smoke` 13 cases with all four zero-tolerance counters at 0, manual memory contract 14, and green checks.
- [x] **G-5 (gate):** Commit `3a1372d` (`feat: add default-off memory safety policy`) completed the behavior/evaluation gate. Blocker-only Oracle status: APPROVED. Auto-safe remains disabled in release and model-based gardening is not claimed. Phase H is next.

**Phase G closeout:** deterministic default-off policy and proposal-only
gardening are implemented and evaluated without candidate-content leakage.
Deferred hardening is consolidated in `G-HARDENING-001`; no auto-safe release
enablement or model-based gardening claim is made.

### H — Fault injection, operations, and release evidence

- [x] **H-1 (RED):** Focused H fault evidence is 3/3 passed, covering the minimum deterministic failure and fail-closed boundary. This is not exhaustive crash or receipt recovery.
- [x] **H-2 (interface/recovery):** Recorded bounded dry-run recovery inspection without mutation: mode DRY_RUN, 46 nonterminal runs, 81 queued dispatches, 0 pending memory projections, 4 failed memory projections, 0 snapshots lacking ready projection, and runtime receipt reconciliation unavailable.
- [x] **H-3 (migration/recovery/docs):** Added the managed single-agent runbook, ADR, evidence packet, rollback/limitations/escalation boundary, and migration list without secrets, paths, prompts, or raw provider errors.
- [x] **H-4 (route/application wiring/GREEN):** Fresh evidence records transcript 1/1, `make ci` (unit 133, contract 68, deterministic integration 75 with 16 expected real-PG skips, E2E 2, checks/build green), PostgreSQL16 `make test-real-pg` 59/59, `make e2e-smoke` 2/2, `make paseo-smoke` succeeded with the exact marker, and `make eval-smoke` 13 cases with all four zero-tolerance counters at 0.
- [x] **H-5 (docs/evidence):** Updated README, features, components, contracts, quality, operations, ADR, evidence packet, and ledger for truthful current status. Minimum-scenario evidence is approved; no production readiness claim is made.
- [x] **H-6 (final gate/cleanup):** Final blocker-only Oracle approved the corrected transcript provenance/cancellation evidence. The final evidence packet, runbook, ADR, rollback boundary, migration list, and checks are recorded; the plan/spec are completed and moved to `docs/exec-plans/completed/`. H-ARCHIVE records the archive closeout. This remains a minimum scenario evidence package, not production readiness.

**H final closeout:** Evidence IDs are `H-FAULTS`, `H-RECOVERY`,
`H-TRANSCRIPT`, `H-OPS`, `H-PACKET`, and `H-ARCHIVE`. Final blocker-only Oracle
status is APPROVED. The minimum scenario is complete; consolidated deferred
hardening remains for post-E2E triage.

## Coverage matrix

| Approved spec section                                              | Labeled tasks                                                                | Evidence IDs                                                                    |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| §4 objects, YAML, versions, workspace/session/message/memory terms | B-1, B-2, C-2, E-2, F-2                                                      | B-YAML, B-IMPORT, C-LANE, E-SNAPSHOT, F-CONTEXT                                 |
| §5 scope, APIs, migrations, runtime, memory, reliability           | P0-1, A-1–A-6, B-3–B-6, C-3–C-6, D-3–D-6, E-3–E-6, F-3–F-6, G-2–G-5, H-1–H-6 | A-DEFECTS, B-ROUTES, C-ROUTES, D-EVENTS, E-OWNERSHIP, F-FRESH, G-EVAL, H-FAULTS |
| §6 YAML contract and publication validation                        | B-1, B-2, B-4                                                                | B-YAML, B-POLICY, B-ROUTES                                                      |
| §7 architecture, runtime input, context, events                    | C-2, D-2, D-4, F-2                                                           | D-PORT, D-EVENTS, F-CONTEXT                                                     |
| §8 data model and additive migration ordering                      | A-2, B-3, C-3, D-3, E-3, G-2                                                 | A-RECEIPT, B-MIGRATION, C-MIGRATION, D-MIGRATION, E-MIGRATION                   |
| §9 state machines and recovery semantics                           | A-3, C-1, C-4, D-4, E-4, H-2                                                 | C-RESET, D-SAFETY, H-RECOVERY                                                   |
| §10 acceptance, privacy, ownership, secrets                        | A-5, B-4, C-4, D-4, E-4, F-3, G-2                                            | A-LEDGER, C-AUTH, D-SAFETY, G-SAFETY                                            |
| §11 failure scenarios and observable reconciliation                | A-2, A-3, D-3, H-1, H-2                                                      | A-RECEIPT, D-RECOVERY, H-RECOVERY                                               |
| §12 API contracts and safe/idempotent responses                    | B-4, C-4, D-4, E-4, H-4                                                      | API-ALL, B-ROUTES, C-ROUTES, D-SSE                                              |
| §13 test taxonomy, real PostgreSQL, E2E, eval                      | A-4, A-6, D-6, F-4, G-1, G-4, H-4                                            | A-PGPOOL, D-E2E, F-FRESH, G-EVAL, H-NODE24                                      |
| §14 observability and Evidence Packet                              | A-5, D-5, H-3, H-5, H-6                                                      | A-LEDGER, D-SAFETY, H-OPS, H-PACKET, H-ARCHIVE                                  |

## Spec coverage self-review

Every approved spec requirement in §4–§14 maps to a labeled task and evidence
ID: §4 → B-1/B-2 (`B-YAML`); §5 → P0-1, A-1–A-6, B-1–H-6 (`DOD-SCOPE`);
§6 → B-2/B-4 (`B-ROUTES`); §7 → C-2, D-2, E-2, F-2 (`DOD-ARCH`); §8 →
A-2, C-3, D-3, E-3 (`DOD-MIGRATIONS`); §9 → C-1/C-4, D-4, H-2
(`DOD-RECOVERY`); §10 → B-4/C-4/D-4/E-4/F-3/G-2 (`DOD-SECURITY`); §11 →
B-3/C-3/D-3/E-3 (`DOD-DATA`); §12 → every phase gate (`DOD-TESTS`); §13 →
P0-1 and H-5 (`DOD-SCOPE`); §14 → H-3–H-6 (`H-PACKET`). No placeholder or
unlabeled matrix reference remains.

## Evidence and verification model

PGlite proves fast deterministic transitions, not multi-connection visibility or
locks. Real `pg.Pool` tests use at least two leased connections and a real
`DATABASE_URL`; CI provisions PostgreSQL. The ordinary local deterministic
suite may SKIP the real-PG test when `DATABASE_URL` is absent, while the
required real-PG lane FAILS when it is absent. Fake runtime tests prove lifecycle
and safe transcripts; `make paseo-smoke` is external evidence, not a
deterministic gate. `make eval-smoke` is the existing evaluation target.

## Validation evidence

- **P0-PLAN:** Approved design spec and Active Exec Plan are present with the
  fixed A–H dependency graph, migration ownership, evidence IDs, and non-goals.
- **P0-NODE24:** Node `v24.18.0`, pnpm `11.7.0`; `make setup && make ci` passed
  with 59 unit, 42 contract, 23 integration, and 1 E2E test plus docs, types,
  format, and build. A fresh Node 24 `make check` also passed after plan review.
- **P0-COMMIT:** `dfc9a82` `docs: control managed single-agent v1 plan`.
- **A-DEFECTS / A-RECEIPT:** Transaction-scoped Task replay, typed runtime
  receipts, and persistence-failure outcome/logging boundaries are covered by 10
  passing focused unit tests on Node 24.
- **A-PGPOOL:** PostgreSQL 16 with a real `pg.Pool` passed all 4 required tests,
  including the forced same-idempotency-key concurrent admission race. The
  environment-free deterministic integration suite skipped those 4 tests by
  design.
- **A-RUNTIME:** Paseo adapter reconnect and pinned-capability integration passed
  9/9 tests. The authenticated external smoke completed through
  `opencode/mimo-v2.5-free` with exact marker `PASEO_OPENCODE_BASELINE_OK` and
  terminal status `succeeded`.
- **A-CI / A-LEDGER:** Node 24 `make ci` passed with 66 unit, 42 contract, 28
  deterministic integration, and 1 E2E test plus types, format, docs, exec-plan,
  and build checks. The required real-PG lane is isolated in CI; deferred work
  has an owner and target in `docs/operations/follow-up-ledger.md`.
- **A-COMMITS:** Phase A is recorded by the behavior/test/CI series from
  `51b440c` through `baf8be5` and documentation commits `7a1f60b`, `c65086e`,
  and `f0d5f94`.
- **A-ORACLE:** Final cumulative Phase A review returned `APPROVED` after the
  focused, real-PG, deterministic CI, external Paseo, and documentation gates.
- **B-YAML:** Latest focused package/import evidence is 31/31 on Node 24;
  application/domain boundary reviews are approved.
- **B-POLICY:** Human Gate approval is recorded for the exact pinned `re2js`
  compiler decision. A future compiler upgrade requires a new package version
  and compiler snapshot.
- **B-IMPORT:** Import/application and managed-definition/version semantics are
  covered in the 126-test Node 24 unit gate. Relevant range:
  `165d966..81af392` plus `e71a084`.
- **B-MIGRATION:** Phase B migrations are `0005` plus forward repair `0005b`.
  Latest Node 24 registry evidence is 54/54 on PostgreSQL 16; the combined
  required real-PG lane is 58/58. Relevant range:
  `ec2761d..87ec2fa`, `9833d09`, and `166bf73`.
- **B-ROUTES:** API contract evidence is 62 tests on Node 24; resolver/Task
  admission focused and contract evidence is recorded by `d88a679` and
  `b7c1464`. Relevant route range: `bbeadf6..d1b4047` plus `0818409`.
- **B-GATE:** Node 24 phase boundary passed 126 unit, 62 contract, and 70
  deterministic integration tests with 16 real-PG cases skipped by design,
  plus types, format, docs, and exec-plan checks. PostgreSQL 16 required lane
  passed 58/58.
- **B-ORACLE:** Blocker-only cumulative review returned `APPROVED`; no deferred
  Phase B findings were reported. Phase B is sufficient to start Phase C.
- **C-EVIDENCE:** Node 24 focused evidence recorded as 1/1 sessions contract,
  1/1 real-PG session-lane integration, 13/13 focused Task/Run regressions, and
  green type, format, docs, and exec-plan checks. The evidence is focused and
  does not claim full-suite or production readiness.
- **C-COMMITS:** Phase C implementation and blocker-only fix are recorded by
  `4cbc011`, `415aa07`, and `eaf7e8b`.
- **C-ORACLE:** Blocker-only review found that reset bulk-cancellation included
  the lane active Task. The fix excludes `active_task_id`, preserves the active
  old-generation Task with a durable cancellation request, and verifies
  terminal promotion to new-generation work.

## Current blocker

None. The minimum managed single-agent scenario and H-6 archive closeout are
complete. Consolidated post-E2E deferred hardening remains in the Follow-up
Ledger.

## Next exact command

```bash
Post-E2E deferred-hardening triage from `docs/operations/follow-up-ledger.md`.
```

## Completion checklist

- [x] **DOD-1:** P0 commit and baseline evidence are recorded.
- [x] **DOD-2:** A–H gates, Oracle reviews, focused RED/GREEN evidence, and phase commits are recorded.
- [x] **DOD-3:** Every §4–§14 requirement has a labeled task and evidence ID.
- [x] **DOD-4:** Final spec and plan are completed/moved with updated links and no unchecked boxes.
