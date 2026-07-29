---
status: completed
owner: orchestrator
created_at: 2026-07-28
updated_at: 2026-07-28
authority: execution-plan
---

# Managed Environment and Runtime Session MVE

## Outcome

Deliver the smallest real API-to-runtime path in which a published Managed
Environment is pinned to ProductSession, first use creates a durable
SessionLaunchSnapshot and RuntimeSession with a per-session Runtime Cell/Paseo
Workspace, a second turn continues the same provider Agent, and a second
ProductSession runs in a different cell.

## Context and authority

- User approved direct implementation of the minimum MVE on 2026-07-28,
  including the public Environment API, durable schema/migration, Session API
  field, and real Paseo/OpenCode smoke. Merge and destructive cleanup remain
  separate Human Gates.
- Design authority:
  `docs/superpowers/specs/2026-07-28-managed-environment-runtime-session-mve-design.md`.
- External roadmap:
  `managed-environment-runtime-session-agent-team-mve-first-architecture-roadmap-post-pr-14-mainline-2026-07-28.md`.
- Worktree: `.worktrees/managed-environment-runtime-session-mve`.
- Branch: `agent/managed-environment-runtime-session-mve`.
- Baseline: `origin/master` / `9989a5a58cb5845e67dd1e286e1085855f5fed1d`.
- Product stage: `Prove`. The primary evidence is the real Agent Server → Paseo
  0.1.110 → OpenCode 1.18.4 main flow. Existing checks are supporting signals.

## Scope

- Strict Managed Environment YAML package with fixed `paseo`, `opencode`,
  `free-only`, and `per_runtime_session` values.
- Authenticated validate/import/version-read/publish Environment endpoints using
  existing Managed Agent API conventions.
- Durable Environment Definition/Version, ProductSession environment pin,
  SessionLaunchSnapshot, and RuntimeSession records.
- Optional Session create `environment_version_id`; omission resolves only when
  exactly one published owner EnvironmentVersion exists.
- Runtime Cell directory derived from RuntimeSession ID.
- Runtime extension binding and Paseo Workspace opening against that cell.
- Canonical continuation through RuntimeSession while retaining current per-Run
  binding evidence.
- One real three-turn smoke: Session A Turn 1/2 plus Session B Turn 1.

## Non-goals

- No Environment list/update/delete/archive/default administration or UI.
- No install scripts, dependencies, images, arbitrary environment variables,
  secrets, sandbox/network/filesystem policy, Host registry, placement, leases,
  quotas, GC, remote Host, or second adapter.
- No public RuntimeSession API, restart reconstruction, reset/rebind, crash-window
  recovery, first-turn concurrency framework, retry, reconciliation, multi-node,
  or production Tool Grant lifecycle.
- No Team DAG, Team Child RuntimeSession, wait/resume, schedule, performance, or
  operational hardening.
- No proactive unit, contract, integration, deterministic E2E, evaluation, or
  fixture authoring. The real smoke is primary acceptance evidence.
- No commit, push, PR, merge, branch/worktree cleanup, or retained-evidence
  cleanup without corresponding authorization.

## File map

### New Environment boundary

- `src/domain/environments/managed-environment-package.ts`: strict package model,
  canonicalization, fingerprint, and rehydration.
- `src/domain/environments/managed-environment-yaml.ts`: bounded safe YAML parse.
- `src/contracts/environments.ts`: public request/response schemas and error
  types.
- `src/application/ports/environment-registry.ts`: owner-scoped registry port.
- `src/application/environments/validate-environment-package.ts`: read-only
  validation.
- `src/application/environments/import-environment.ts`: idempotent import.
- `src/application/environments/read-environment-version.ts`: owner-hidden read.
- `src/application/environments/publish-environment-version.ts`: immutable
  publication.
- `src/infrastructure/postgres/postgres-environment-registry.ts`: PostgreSQL
  registry implementation.
- `src/entrypoints/api/routes/environments.ts`: four authenticated routes.

### Session/runtime persistence

- `src/application/ports/runtime-session-repository.ts`: launch snapshot and
  RuntimeSession port.
- `src/infrastructure/postgres/postgres-runtime-session-repository.ts`: atomic
  create/read/bind operations.
- `src/infrastructure/postgres/migrations/0018_managed_environment_runtime_session_mve.sql`:
  Environment registry, ProductSession FK, launch snapshot, and RuntimeSession
  schema.
- `src/infrastructure/postgres/postgres.ts`: register migration 0018.
- `src/contracts/sessions.ts`: optional `environment_version_id` request field.
- `src/application/ports/session-repository.ts`: persisted and returned
  EnvironmentVersion identity.
- `src/infrastructure/postgres/postgres-session-repository.ts`: published
  Environment resolution and ProductSession pin.
- `src/entrypoints/api/routes/sessions.ts`: request/response and safe error map.

### Per-session runtime cell

- `src/shared/config.ts`: configured Runtime Cell root, using ignored local state
  by default.
- `src/application/extensions/runtime-extension-binder.ts`: bind against an
  explicit runtime-cell CWD.
- `src/infrastructure/extensions/local-runtime-extension-binder.ts`: remove fixed
  global Agent CWD ownership and materialize inside the selected cell.
- `src/application/ports/agent-runtime.ts`: create input cell context and safe
  workspace ID output.
- `src/adapters/paseo/paseo-client-port.ts`: preserve explicit per-call CWD and
  workspace boundary.
- `src/adapters/paseo/paseo-runtime-adapter.ts`: open/cache Workspaces by
  RuntimeSession instead of one process-global Workspace.
- `src/application/runs/execute-run.ts`: create/load/bind RuntimeSession and use
  it for canonical continuation.
- `src/bootstrap.ts`: construct and wire registries/repositories/binder/runtime.
- `src/entrypoints/api/app.ts`: Environment route dependencies and registration.

### Evidence and docs

- `scripts/smoke/managed-environment-main-flow.mjs`: real three-turn canary.
- `package.json`: `smoke:managed-environment` command.
- `docs/contracts/managed-environment-api.md`: implemented public contract.
- `docs/evidence/managed-environment-runtime-session-mve-evidence-packet.md`:
  sanitized real-run evidence and limits.
- `docs/features.md`, `docs/contracts.md`, `docs/components.md`, `README.md`:
  truthful baseline status.
- Relevant runtime/session component, architecture, and local-development/runbook
  pages only where behavior changed.

## Work breakdown

- [x] **1. Environment package and registry.** Implement strict package parse,
      canonicalization, fingerprint, port, application use cases, PostgreSQL
      registry, and the Environment portion of migration 0018 by adapting the
      existing Managed Agent patterns without copying unrelated compiler fields.
- [x] **2. Environment API.** Add exact validate/import/version-read/publish
      contracts and routes, common authentication/idempotency/error behavior,
      app dependencies, and bootstrap wiring.
- [x] **3. ProductSession environment pin.** Add the optional create field,
      deterministic sole-published fallback, durable FK, safe response field,
      and owner-hidden published-version resolution.
- [x] **4. Launch snapshot and RuntimeSession.** Add the repository port,
      PostgreSQL implementation, immutable resolved Skill/tool snapshot, unique
      ProductSession scope, and persisted Paseo Workspace/provider Agent binding.
- [x] **5. Per-session Runtime Cell.** Add the configured cell root, allocate one
      directory per RuntimeSession, pass explicit CWD through the extension and
      runtime ports, open one Paseo Workspace per cell, and remove canonical
      continuation dependence on latest Run history while preserving per-Run
      evidence.
- [x] **6. Run the real path early.** Add the minimum smoke harness and run it as
      soon as Environment API, Session pinning, and first-turn RuntimeSession
      creation can reach real Paseo/OpenCode. Fix only `BLOCKER-NOW` failures.
- [x] **7. Complete Session A/B acceptance.** Prove A Turn 1/2 provider reuse,
      B isolation, native Skill/MCP behavior, durable records, distinct cells and
      Workspaces, and prompt/body absence claims.
- [x] **8. Synchronize authority docs.** Record only observed behavior, sanitized
      evidence, and deferred non-blocking findings in Feature, Contract,
      Component, runbook, and evidence documents.
- [x] **9. Run narrow supporting checks.** Under Node 24 run `pnpm check`,
      `pnpm build`, and `git diff --check` after the real smoke; run broader
      existing suites only if needed to diagnose an observed blocker or later
      requested.

## Verification

- [x] Baseline Node `v24.18.0` dependency installation and `pnpm check` pass
      before product edits.
- [x] `pnpm smoke:managed-environment` completes the real A1/A2/B1 path.
- [x] Environment validate/import/read/publish responses are safe and the
      published version is pinned on both ProductSessions.
- [x] Session A has one launch snapshot, RuntimeSession, Runtime Cell, Paseo
      Workspace, and provider Agent across both turns.
- [x] Session B has distinct corresponding identities and returns a real result.
- [x] Existing native Skill projection and read-only MCP Tool work in both cells;
      marker/body absence claims are directly inspected.
- [x] Retained evidence contains no bearer, raw prompt, Skill body, provider error
      dump, or host path.
- [x] Final Node 24 `pnpm check`, `pnpm build`, and `git diff --check` pass after
      the final legacy create remediation.

## Documentation impact

- [x] Feature ledger and README state the implemented MVE without production or
      multi-runtime claims.
- [x] Contract index and managed Environment contract document exact routes,
      fields, fallback, errors, and non-goals.
- [x] Component/architecture docs describe Environment authority, RuntimeSession,
      deterministic Runtime Cell, and continued per-Run evidence.
- [x] Runbook documents the canonical smoke, local root behavior, cleanup, and
      sanitized evidence boundary.
- [x] ADR is deferred because Host placement, production isolation, provider
      profiles, and lifecycle policy remain unsettled.

## Decisions and discoveries

- Runtime Cell is a derived directory, not a table or public resource.
- Runtime binding columns live on RuntimeSession; existing
  `runtime_session_bindings` remain per-Run provenance.
- Environment is authoritative for adapter/provider/model/cell policy; existing
  Managed Agent runtime fields remain compatibility metadata.
- Memory snapshot ID is omitted from SessionLaunchSnapshot because current memory
  remains pinned by the existing Task/turn flow.
- The optional Environment fallback selects only a sole published owner version;
  there is no unstable latest-version behavior.
- Public contract tests are intentionally deferred by current user decision; the
  real smoke is the acceptance authority.
- Foundation spec review reached `SPEC_COMPLIANT`; independent quality review
  reached `QUALITY_APPROVED` after correcting Session-create error classification
  and deterministic Environment package rehydration.
- Registry claim-first transactions, existing broad-test fixture migration, and
  any mutable-draft workflow remain explicitly deferred because they do not
  block the approved real path.
- RuntimeSession/Cell spec review reached `SPEC_COMPLIANT`; independent quality
  review reached `QUALITY_APPROVED` after isolating launch snapshots/receipts,
  restricting managed Workspace fallback, and preserving legacy nullable Session
  continuation.
- Legacy nullable ProductSession first-turn create and continuation remain on
  the legacy runtime path; the Managed Environment RuntimeSession path does not
  rewrite those Sessions.
- Final independent review reached `CODE_APPROVED`.

## Risks and recovery

- A runtime failure after provider Agent creation but before binding persistence
  can orphan disposable provider state. Record and defer production recovery;
  fail the current Run safely.
- Concurrent first-turn RuntimeSession creation is bounded only by the unique
  ProductSession scope and existing Session lane. Do not add a generalized Lease
  or reconciliation system unless the real main flow exposes a blocker.
- Cell allocation must remain under the configured Agent Server-owned root and
  must not overwrite unmanaged paths. Responses/evidence never expose host paths.
- Paseo external MCP Authorization persistence and five-minute Grant expiry remain
  known production gaps. The immediate disposable smoke may proceed under the
  already accepted PR #14 evidence boundary.
- Recovery before commit is to preserve this isolated worktree and retained
  evidence. Do not reset, clean, or delete prior worktrees/databases.

## Validation evidence

- Baseline worktree created at `9989a5a` on
  `agent/managed-environment-runtime-session-mve`.
- Node `v24.18.0`, pnpm `11.7.0`, `pnpm install --frozen-lockfile`, and
  `pnpm check` passed before implementation. Documentation checks covered 98
  Markdown files and Exec Plan checks covered 23 plans.
- The successful real smoke retained database
  `agent_server_managed_env_1785255658420_fef8f5b0` and used Paseo `0.1.110`,
  OpenCode `1.18.4`, and `opencode/north-mini-code-free`. It completed three
  turns: A1/A2 reused provider Agent and Workspace; B1 used distinct provider
  Agent and Workspace; two RuntimeSessions, Cells, and snapshots were observed;
  outputs contained the stable marker; and all events were
  `started,output,succeeded`.
- The observed Workspace root cause/fix is recorded: Paseo `openProject`
  deduplicates an existing Workspace, while managed Cell execution uses
  `createWorkspace`. Disposable runtime state was removed. Earlier external
  provider failures are diagnostic only, not acceptance evidence. Paseo MCP
  Authorization persistence remains the known PR #14 deviation.
- Official Paseo behavior is recorded precisely: `openProject` deduplicates a
  Workspace by Project; managed Cells use low-level `createWorkspace`, while
  legacy runtime execution remains on `openProject`.
- Fresh Node 24 `pnpm check`, `pnpm build`, and `git diff --check` passed after
  the final legacy create remediation.

## Completion checklist

- [x] The approved real path and exact success criteria are met.
- [x] No `BLOCKER-NOW` remains; every non-blocking finding is explicitly deferred.
- [x] Implementation, public contract, Feature ledger, and evidence agree.
- [x] No secret, prompt, full Skill text, raw provider error, unmanaged path, or
      generated disposable state is tracked.
- [x] Working-tree diff is reviewed and no unrelated existing work is overwritten.
- [x] Plan is truthful and archived in `completed/` after all items were
      satisfied or explicitly transferred.

## Current blocker

None. Environment API, ProductSession pinning, RuntimeSession, per-session
Runtime Cell, the approved real smoke, final checks, and independent review are
complete. The next action is the owner decision on commit/PR, not additional
implementation.

## Next exact command

Owner decision on commit/PR. No further implementation action is pending in
this plan.

## Cleanup state

The successful smoke stopped task-specific Agent Server, Paseo, OpenCode, and
MCP processes and removed disposable Registry/Runtime/Cell roots. The retained
PostgreSQL container and acceptance database remain available by name only.
