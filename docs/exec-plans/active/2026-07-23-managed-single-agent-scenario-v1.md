---
status: active
owner: platform-engineering
created_at: 2026-07-23
updated_at: 2026-07-23
authority: execution-plan
---

# Managed Single-Agent Scenario V1 — Active Exec Plan

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
`docs/exec-plans/active/2026-07-23-managed-single-agent-scenario-v1-spec.md`,
then repository contracts/components/operations docs, then code and tests as
evidence. Baseline commit is `3e5e61d`; Paseo is `0.1.110`; authentication is
the existing service-account bearer contract.

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
| B     | invokable repositories, API bootstrap/routes, shared config, `package.json`                                                                                            | `src/domain/agents/managed-agent-package.ts`; `src/domain/agents/managed-agent-package.test.ts`; `src/application/agents/*`; `src/application/agents/import-agent.test.ts`; `src/application/ports/agent-registry.ts`; `src/infrastructure/postgres/migrations/0005_managed_agent_registry_b.sql`; `src/entrypoints/api/routes/agents.ts`; `src/contracts/agents.ts`; `tests/contract/agents.contract.test.ts`; `tests/integration/agent-registry-postgres.integration.test.ts`                                                                                         |
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
- [x] **B-3 (migration/repository):** Add `0005`, registry port/repository, idempotency, owner constraints, and integration coverage for migration replay, races, owner hiding, database immutability, and tied cursor traversal.
- [x] **B-4 (route/application wiring):** Add validate/import/read/version/publish routes and contracts; enforce idempotency, owner hiding, published immutability, and Task acceptance only for published versions.
- [x] **B-5 (docs/evidence):** Update the managed registry component, operations, quality, and active-plan evidence record.
- [ ] **B-6 (gate):** Run unit, contract, integration, and `pnpm check`; commit migration, behavior, and docs/gate changes explicitly, ending with `feat: add managed agent registry and package validation` and `B-ORACLE`.

### C — Workspace, Product Session, durable Message, and Session Lane

- [ ] **C-1 (RED):** Add tests for three concurrent follow-ups, one active root, monotonic ordering, multiple private Workspace ownership, atomic admission, cancel-then-drain, and reset generation. Task terminal status includes `cancelled`; failure/reason code is `cancelled_by_reset`. Do not invent a top-level task status string if the current domain represents it in failure details.
- [ ] **C-2 (interface/domain):** Implement Workspace, ProductSession, Message, SessionLane, owner-derived access, and repository contracts with queued follow-ups and one active root.
- [ ] **C-3 (migration/repository):** Add migration 0006 and migration integration test; one transaction inserts Message, Task, Run attempt 1, idempotency, dispatch intent, and queue metadata before 202.
- [ ] **C-4 (route/application wiring):** Add Workspace/Session/Message/reset routes, safe errors, body limits, idempotency, owner hiding, reset cancellation, old-generation terminalization as `cancelled_by_reset`, and new generation behavior.
- [ ] **C-5 (GREEN/docs/evidence):** Rerun domain, contract, migration, and lane tests; update contracts/features/components/runbook; record `C-LANE`, `C-TRANSACTION`, `C-RESET`, `C-ROUTES`, and `C-AUTH`.
- [ ] **C-6 (gate):** Run `make test-unit`, `make test-contract`, `make test-integration`, and `pnpm check`; commit migration, behavior, and docs/gate changes explicitly, ending with `feat: add private workspaces and durable session lanes` and `C-ORACLE`.

### D — Runtime sessions, events, SSE, and cancel

- [ ] **D-1 (RED):** Add tests for the exact `AgentRuntimePort` methods, normalized events, cursor/SSE, final message, cancel, reconnect, stale fence, usage, and redaction.
- [ ] **D-2 (interface/domain):** Implement the runtime port and immutable execution envelope; extend the Paseo seam for resume/cancel/events without exposing provider IDs/raw errors.
- [ ] **D-3 (migration/repository):** Add migration 0007 for RuntimeSessionBinding, RunEvent, cancellation, usage, durable receipts, and monotonic sequence/fence constraints; add migration integration test before consumers.
- [ ] **D-4 (route/application wiring):** Add event read/stream/cancel services and routes with subscribe-before-hydrate, Last-Event-ID, idempotent terminal events, final message persistence, bounded usage, and safe redaction.
- [ ] **D-5 (GREEN/docs/evidence):** Rerun focused tests and update runtime/run/event contracts, components, features, and runbook; record `D-PORT`, `D-EVENTS`, `D-SSE`, `D-SAFETY`, and `A-RECEIPT` completion.
- [ ] **D-6 (gate):** Run unit, contract, integration, E2E, Paseo smoke, and `pnpm check`; make migration, behavior, and docs/gate commits explicitly, ending with `feat: add runtime sessions events and cancellation` and `D-ORACLE`.

### E — Memory ownership and immutable file snapshots

- [ ] **E-1 (RED):** Add tests for tenant+Workspace ownership, legacy principal-private preservation without merging, provenance, accept/edit/reject, append-only entries, deterministic render, atomic failure, hash mismatch, immutable versioning, and rebuild.
- [ ] **E-2 (interface/domain):** Implement MemoryEntry, MemorySnapshot, MemoryProjection, deterministic renderer, manifest/hash, and exact FileStore interface with verified read-only access.
- [ ] **E-3 (migration/repository):** Add migration 0008 and migration integration test for provenance, immutable entries/snapshots/projections, owner constraints, and rebuild metadata; fail closed on mixed-owner ambiguity.
- [ ] **E-4 (route/application wiring):** Add snapshot/rebuild routes, proposal import, atomic private FileStore projection, latest-ready pointer, and owner-hiding behavior.
- [ ] **E-5 (GREEN/docs/evidence):** Rerun focused tests and update memory contracts/components/features/ADR/runbook. E proves immutable snapshots/projections, provenance, ownership, reject behavior, atomicity, hashes, and rebuild; it does not prove old-task admission pinning or old-task stability—that is F. Record `E-OWNERSHIP`, `E-PROPOSAL`, `E-FILESTORE`, `E-SNAPSHOT`, and `E-REBUILD`.
- [ ] **E-6 (gate):** Run unit, contract, integration, and `pnpm check`; make migration, behavior, and docs/gate commits explicitly, ending with `feat: add owned immutable memory snapshots` and `E-ORACLE`.

### F — Context assembly and Fresh Session memory projection

- [ ] **F-1 (RED):** Add tests for exact context order, admission-pinned snapshot/hash, verified read-only projection, no full Workspace scan/embedding, no hidden old-session history, and runtime resume data. Current execution path is `src/application/runs/execute-run.ts`.
- [ ] **F-2 (interface/domain):** Implement `assembleContext`, verified projection reads, and admission rejection on changed/mismatched snapshots.
- [ ] **F-3 (route/application wiring):** Implement `createFreshSession` with a new Product Session and Runtime Binding, selected Agent Version, same Workspace, ready Snapshot, and empty old Message History; no production migration.
- [ ] **F-4 (GREEN/E2E):** Add deterministic real-socket E2E for recall, rejected/late/other-Workspace absence, reset archiving, read-only projection, admission pinning, and old-task stability; rerun focused tests GREEN.
- [ ] **F-5 (docs/evidence):** Update context/session/runtime contracts, components, features, and runbook; record `F-CONTEXT`, `F-PIN`, `F-FRESH`, and the old-task stability evidence.
- [ ] **F-6 (gate):** Run unit, integration, E2E, `make e2e-smoke`, and `pnpm check`; commit behavior and docs/gate changes explicitly, ending with `feat: assemble pinned fresh-session context` and `F-ORACLE`.

### G — Auto-safe Memory and Gardener

- [ ] **G-1 (RED/eval):** Add the versioned dataset and tests for disabled/proposal/auto_safe, exact category allowlist, source trust, secret/PII/conflict/action rejection, and zero-tolerance counters.
- [ ] **G-2 (interface/domain):** Implement versioned policy decisions, redacted owner-scoped traces, default-off auto-safe checks, and optional 0009 only if trace durability requires a table.
- [ ] **G-3 (route/application wiring):** Implement proposal-only gardener deduplication/supersession/expiry/compaction; preserve model-name rejection and free-only policy. Use the existing exact `make eval-smoke` target; do not add a new target.
- [ ] **G-4 (GREEN/docs/evidence):** Run `make eval-smoke` and the focused evaluation command; require zero unsafe auto-accepts, rejected-memory leakage, cross-Workspace leakage, and secret exposure; record precision, duplicate, contradiction, recall, and budget metrics; update quality/evaluation, contracts, features, and runbook.
- [ ] **G-5 (gate):** Run unit, integration, docs, and `pnpm check`; commit policy, behavior, and docs/gate changes explicitly, ending with `feat: add default-off memory safety policy` and `G-ORACLE`.

### H — Fault injection, operations, and release evidence

- [ ] **H-1 (RED):** Add deterministic fault tests for admission crash, worker crash, runtime/DB receipt failure, reconnects, snapshot crash/hash mismatch, reset race, follow-ups, duplicate review, idempotency, isolation, stale activation, cancellation, and restart.
- [ ] **H-2 (interface/recovery):** Implement bounded forward recovery only: lease/fence rejection, receipt reconciliation, reconnect normalization, previous-ready snapshot fallback, idempotent reset/review, and durable dispatch draining. H adds no production schema.
- [ ] **H-3 (migration/recovery/docs):** Add the dry-run reconciliation script, V1 runbook, rollback controls, migration list, limitations, escalation, and Evidence Packet structure without secrets, private paths, or raw provider errors.
- [ ] **H-4 (route/application wiring/GREEN):** Add the full deterministic API transcript covering YAML through second-session recall, queue, SSE cursor, cancel, rejection, reset, isolation, and recovery. Run `make test-unit`, `make test-contract`, `make test-integration`, `make e2e-smoke`, `make paseo-smoke`, `make eval-smoke`, `make ci`, `pnpm check:docs`, and `pnpm check:exec-plans`; record external blockers explicitly.
- [ ] **H-5 (docs/evidence):** Synchronize README, product/features/components/contracts, ADRs, operations, quality, and agent instructions; verify no stale claims, unchecked implementation items, debug output, credentials, raw prompts/paths/provider errors, or unexplained skipped evidence remain.
- [ ] **H-6 (final gate/cleanup):** Review full fault matrix, final real-PG lane, Paseo canary, Node24 gate, docs, and Evidence Packet; make explicit recovery, behavior, and docs/gate commits and final release commit/review. At H completion set both spec and plan `status: completed`, move both to `docs/exec-plans/completed/`, update links, run `pnpm check:exec-plans` and `pnpm check:docs`, and ensure no unchecked boxes remain.

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
- **B-YAML:** Package-domain evidence is 30 tests at the accepted checkpoint;
  application/domain boundary reviews are approved.
- **B-POLICY:** Human Gate approval is recorded for the exact pinned `re2js`
  compiler decision. A future compiler upgrade requires a new package version
  and compiler snapshot.
- **B-IMPORT:** Migration-focused Node 24 evidence is 25/25 at the accepted
  checkpoint. Relevant range: `165d966..81af392`.
- **B-MIGRATION:** Latest registry Node 24 real evidence is 40/40, with the
  required real-PG lane 44/44. Relevant range: `ec2761d..87ec2fa`.
- **B-ROUTES:** API contract evidence is 60 tests on Node 24; resolver/Task
  admission focused and contract evidence is recorded by `d88a679` and
  `b7c1464`. Relevant route range: `bbeadf6..d1b4047`.

## Current blocker

None. P0, Phase A, and B-1 through B-5 are complete; B-6 remains unchecked.

## Next exact command

```bash
make test-unit && make test-contract && make test-integration && pnpm check
```

## Completion checklist

- [x] **DOD-1:** P0 commit and baseline evidence are recorded.
- [ ] **DOD-2:** A–H gates, Oracle reviews, focused RED/GREEN evidence, and phase commits are recorded.
- [x] **DOD-3:** Every §4–§14 requirement has a labeled task and evidence ID.
- [ ] **DOD-4:** Final spec and plan are completed/moved with updated links and no unchecked boxes.
