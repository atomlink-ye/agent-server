---
status: completed
owner: orchestrator
created_at: 2026-07-27
updated_at: 2026-07-27
authority: execution-plan
---

# Claude-inspired Memory API and built-in Skill MVE Implementation Plan

> **For agentic workers:** execute bounded tasks through the current
> subagent-driven workflow. Do not add automated tests or commit unless the user
> separately requests them.

# Outcome

Implement the paired
[`Design Spec`](2026-07-27-claude-memory-api-skill-mve-spec.md): a real
PostgreSQL-backed Memory Store → Memory → immutable Version management API plus
one managed Agent that loads the server-owned Memory API Skill in native Runtime
Bootstrap.

## Context and authority

- Branch: `agent/claude-memory-api-skill-mve` in isolated worktree
  `.worktrees/claude-memory-api-skill-mve`.
- Baseline: `origin/master` / `738509be33a7ed6f745541c7c27afecee61997a3`.
- Product stage: Prove; real PostgreSQL/API and real Paseo/OpenCode paths are
  primary evidence.
- User explicitly authorized public API, durable migration, owner-scope model,
  built-in Skill loading, implementation through completion, and replacement of
  the old Memory direction. CLI is explicitly deferred.
- `pnpm check` passes at baseline. PR #12 initially exposed two stale prompt
  assertions in the focused durable-kernel integration file: 25 passed, 2
  failed. They were repaired test-only during PR preparation; final gates are
  green.

## Scope

- Add migration 0017 and canonical Store/Memory/Version tables.
- Add strict contracts, repository, application use cases, and authenticated
  management routes.
- Add the canonical built-in Memory API Skill artifact and deterministic loader.
- Resolve supported Skill references with published managed AgentVersion data.
- Inject loaded Skill bodies into native create-time Bootstrap only.
- Run one real PostgreSQL API journey and one real external Runtime Skill journey.
- Update minimum Feature, Component, Contract, ADR, runbook, and evidence docs.

## Non-goals

- No CLI, Agent HTTP execution, Runtime credential/capability, MCP, Session
  resource attachment, Skills marketplace, filesystem mount, or old-data
  migration/deletion.
- No automated test/eval authoring.
- No broad legacy Lark/Memory hardening or physical cleanup.

## Work breakdown

- [x] Add `0017_claude_memory_api_skill_mve.sql` and register it in
      `src/infrastructure/postgres/postgres.ts`.
- [x] Add focused Store/Memory/Version domain types and validation helpers under
      `src/domain/memory-api/`.
- [x] Add `MemoryApiRepository` and focused create/list/get/update use cases.
- [x] Add `PostgresMemoryApiRepository` with exact-owner queries and atomic
      SHA-256 CAS Version append.
- [x] Add strict `src/contracts/memory-api.ts` schemas and safe response types.
- [x] Add authenticated `src/entrypoints/api/routes/memory-api.ts` routes using
      shared bounded JSON handling.
- [x] Wire the repository/use cases/routes through `src/bootstrap.ts`,
      `src/entrypoints/api/app.ts`, and test/service composition call sites
      mechanically without adding test cases.
- [x] Add `skills/agent-server-memory-api/SKILL.md` with API and credential
      guidance.
- [x] Add a deterministic built-in Skill catalog/loader and extend
      `ResolvedAgentVersion` to carry resolved Skill bodies.
- [x] Extend Bootstrap rendering so Skill content appears only on Agent create;
      continuation remains current-Turn-only.
- [x] Preserve the old Memory code/data as legacy and prevent it from becoming
      authority for the new API documentation or evidence.
- [x] Run the real API/PostgreSQL path as soon as the route is wired; fix only
      blockers, owner leaks, CAS defects, or invalid evidence.
- [x] Run the real managed-Agent Skill path; fix only blockers to Skill loading
      and native Bootstrap evidence.

## Verification

- [x] `pnpm check` under Node `v24.18.0` passes after source/docs changes.
- [x] Fresh real PostgreSQL applies migrations through 0017.
- [x] Real HTTP create Store → create/read V1 → CAS update/read V2 succeeds.
- [x] Direct DB inspection proves stable Memory ID, immutable V1, current V2,
      monotonic Version, and exact owner scope.
- [x] Stale V1 hash returns `409 memory_precondition_failed` and creates no row.
- [x] Foreign authenticated scope receives hidden `404` and creates no row.
- [x] Real published managed Agent referencing `agent-server/memory-api` returns
      the exact Skill-only API guidance through native Runtime Bootstrap.
- [x] `pnpm build` and `git diff --check` pass.
- [x] Existing focused checks are run only where useful; the baseline PR #12
      prompt assertions were repaired test-only during PR preparation.

## Documentation impact

- [x] Product/Feature: update `docs/features.md` and relevant release wording.
- [x] Component: update Workspace/Artifact Store and Orchestration Kernel.
- [x] Contract: add `docs/contracts/memory-api.md` and Skill-loading contract.
- [x] ADR: add the Store/Memory/Version and built-in Skill decision.
- [x] Runbook/evidence: add exact API and real Runtime commands/observations.
- [x] Mark old proposal/snapshot docs as legacy direction without rewriting
      historical completed plans or deleting evidence.

## Decisions and discoveries

- The user explicitly deferred CLI after reviewing the capability/runtime gap.
- Managed Agent packages already persist Skill references but current execution
  resolution drops them; the first Skill can use one static server-owned catalog
  without a Skill database or marketplace.
- A Skill can truthfully teach the API but cannot authenticate or execute HTTP in
  the current Runtime. This MVE proves Skill loading and API knowledge only.
- Public Version endpoints are not required for the first create/update path;
  immutable Version persistence remains mandatory.
- The old Memory path remains historical compatibility during this MVE. Physical
  deletion would add retention and destructive-migration work before the new
  main flow is proven.
- The final API evidence proved three immutable Versions (V1 → V2 → V3), CAS,
  no-op, revert, exact 65,536-byte content, invalid-input rejection, duplicate
  path conflict, and foreign-scope 404 behavior.
- Migration 0017 was reapplied successfully after deleting only its migration
  registry row; direct database probes rejected historical Version mutation,
  malformed byte-size rows, and pointerless Memories.
- The built-in Skill was proven through a real Paseo/OpenCode run with explicitly
  free `opencode/deepseek-v4-flash-free`, marker `MEMORY_API_SKILL_V1`, and exact
  API guidance. `opencode/mimo-v2.5-free` intermittently returned safe external
  provider `No provider available` / `401` failures. The Skill does not provide
  API execution capability.

## Risks and recovery

- Migration rollback before integration is branch/worktree disposal plus dropping
  only the isolated canary database. No production database is targeted.
- Owner scope must be enforced in every repository query; foreign and missing
  resources remain indistinguishable publicly.
- Current-version pointer and immutable Version append must be one transaction.
- Skill loading rejects unresolved references rather than silently omitting them.
- No credential, raw Skill body, prompt, local path, or raw provider error enters
  normal API responses, logs, Messages, or evidence.

## Validation evidence

- Node 24 `pnpm check`: passed.
- Node 24 `pnpm build`: passed; built module loaded the root Skill asset.
- Fresh PostgreSQL 16.14 migration and registry-row reapply: passed.
- Clean API/PostgreSQL evidence: Store and stable Memory, V1 → V2 CAS, stale
  409, same-content V2 no-op, V3 revert, exact 65,536 bytes, invalid input 400,
  duplicate path 409, and foreign scope 404.
- Direct DB evidence: exactly three immutable Versions, correct predecessor
  chain/current pointer, zero invalid rows, immutable-trigger rejection,
  malformed-byte-size rejection, and pointerless-Memory rejection.
- Real Paseo 0.1.110/OpenCode 1.18.4 `opencode/deepseek-v4-flash-free` Skill
  journey: passed with `started → output → succeeded`, provider binding, and
  durable assistant Message. Mimo's intermittent external provider failure is
  recorded separately above.
- The PR #12 prompt assertions were repaired test-only during PR preparation by
  recording native create-time `systemPrompt` separately from current-Turn
  prompts; no production behavior changed.
- Final Node 24 `pnpm run ci`: passed — unit **370/370**, contract **71/71**,
  integration **143 passed / 36 skipped / 0 failed**, deterministic E2E **7/7**,
  and build passed. The docs check covered **92 files** and the Exec Plan
  checker passed **6 tests / 22 plans**.
- Fresh real PostgreSQL `pnpm test:real-pg`: **74/74** across six files.

## Completion checklist

- [x] Real API/PostgreSQL exit condition met.
- [x] Real Skill-loading Runtime exit condition met.
- [x] No `BLOCKER-NOW` finding remains after final Oracle re-review.
- [x] Minimum authority docs agree with observed behavior.
- [x] Deferred CLI/tool/session-resource/cleanup work is explicit.
- [x] Worktree contains no secret or untracked generated evidence.
- [x] Spec and Plan moved together to `completed/` with no unchecked boxes.

## Current blocker

Final Oracle re-review found no remaining `BLOCKER-NOW` findings. The Spec and
Plan are complete and are being archived together.

## Next exact command

No further implementation command; retain the completed Spec/Plan and evidence
packet for historical review.

## Cleanup state

The implementation and sanitized documentation remain in the feature worktree.
The final Runtime stack stopped gracefully; PostgreSQL container and evidence
databases remain retained. No secrets or raw evidence were added. Spec and Plan
were moved together to `docs/exec-plans/completed/`.
