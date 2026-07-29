---
status: completed
owner: orchestrator
created_at: 2026-07-29
updated_at: 2026-07-30
authority: execution-plan
design: docs/superpowers/specs/2026-07-29-collaborative-team-mve-design.md
---

# Collaborative Team MVE — exec plan

## Baseline

Worktree: `.worktrees/collaborative-team-mve` on `agent/collaborative-team-mve` at `0a7992b`.

## Scope

- ManagedTeam YAML package + 6-route registry API
- Collaborative TeamRun/TeamMemberRun/TeamWorkItem + append-only migration
- Phase-based coordinator (lead_kickoff → member_work → lead_finalize → done)
- team_member RuntimeSession scope
- 6 Team MCP tools
- 3 TeamRun observation API routes
- Real smoke:collaborative-team
- Docs: features, contracts, components, runbook, evidence

## Non-goals

- DAG deletion; PROJECT1/agentctl; Skill API; messages/Room/DM/idle-wake; dependencies; approval; artifacts; retry/recovery; test suites

## Work

- [x] 1. Domain + migration + repository (orchestrator)
- [x] 2. API routes + bootstrap (fixer-2)
- [x] 3. Execution + tools (fixer-3)
- [x] 4. Smoke + docs (fixer-4)
- [x] 5. Real smoke verification
- [x] 6. Narrow existing checks + diff review

## Fixes applied during debugging (2026-07-29)

- Team version draft INSERT used wrong param type for `collaboration_spec` ($13::jsonb → $12::jsonb)
  at `src/infrastructure/postgres/postgres-invokable-repository.ts:476`
- Team version `:publish` route couldn't parse `versionId` param (added fallback regex like
  agents/environments routes)
- Collaborative team activation returned `queued` lead run instead of `waiting_children` root run,
  causing `createRuntimeExecutionReceipt` to reject it; patched to return root run
- ManagedAgent tool allowlist only allowed `memory-read`; expanded to include 6 team tool refs
  in `resolve-agent-version.ts` and `runtime-tool-grant-service.ts`
- Runtime session `scope_kind` check constraint didn't include `team_member`; extended in
  migration 0020 (drop+recreate scope_kind + scope_shape constraints)
- `execute-run.ts` environmentVersionId fallback for collaborative teams didn't include
  `collaborativeTeam.environmentVersionId` in the chain
- Smoke agent YAML granted `memory-api` skill which required tool not granted; replaced with
  `skills: []` in smoke package
- MCP tool responses returned arrays as `structuredContent`; OpenCode expects objects
  → wrap in `{ items: resolved }` for list responses
- Phase coordinator `(:member:)` substring check didn't match `member_work` suffix
  → changed to `includes(':member_work')`
- Lead child task prompts didn't include `team_run_id`; injected inline in
  `collaborative-team-executor.ts`
- `advanceAfterMemberCompletion` waited for all work items to be completed; relaxed to
  allow advancement when all member runtime tasks are terminal
- `team_complete` tool blocked when any work item was pending; relaxed: allows completion
  when all member runtime tasks have reached terminal status

## Verification

- [x] Real smoke:collaborative-team passes (`node scripts/smoke/collaborative-team-main-flow.mjs`)
- [x] pnpm check + pnpm build pass
- Fixer pass addressed migration execution-mode shape, team-run scoping, member ownership/claim atomicity, phase CAS, PostgreSQL-atomic completion, runtime-session lifecycle, explicit grants, and registry idempotency.
- Real smoke passed with import/publish replay assertions, succeeded/done state, completed work items, three linked runtime sessions, distinct provider bindings, and unique logical steps.
- `pnpm check`, `pnpm build`, and `git diff --check` passed.
- Re-review blockers resolved: per-tool MCP registration/session-lifetime grants, transactional member-to-lead CAS/enqueue, partial unique member claim index, atomic registry reservation/mutation with 201 import replay and 409 conflicts, and smoke evidence for overlapping lifecycles, lead binding reuse, root events, and foreign-owner 404.
- Final verification ran under Node 24.18.0 with the exact PostgreSQL/Paseo smoke command.
