---
status: active
owner: orchestrator
created_at: 2026-08-03
updated_at: 2026-08-04
authority: execution-plan
---

# Outcome

Deliver Agent Teams v2 as one durable Team runtime: real inner-loop member work,
durable addressed wake, dependency-aware Work Board collaboration, narrow gates,
safe Web projection, and destructive removal of the old Team modes.

## Current status

**Current Phase 1 evidence:** the retained single-Run path reached Attempt 2
terminal, and the effective focused `attempt2_terminal` smoke passed in 133223ms
(recorded in `.local/phase1-attempt2-terminal-720s-configured-fix.log`). Phase 1
implementation remains dirty and uncommitted; `completion` and `full` remain
prohibited and have not been run.

The required effective focused smoke ran with the authorized environment loaded
before Make invokes `docker-run`. The earlier `OpenCodeModelUnavailableError` was
preflight-only and did not create a fixture: although Make forwards
`OPENCODE_GO_API_KEY` when present, its caller shell lacked the variable, so the
smoke script did not construct or pass `OPENCODE_CONFIG_CONTENT` to Paseo. The
valid invocation loaded the approved org `.local/.env` before Make; Docker
forwarding then showed a present (never printed) key, the smoke registered the
custom `opencode-go` provider/model, and runtime logs recorded that exact model
ID. No product orchestration change was required.

### Historical preflight state — superseded

On 2026-08-04, the first retained single-Run fixture
`.local/agentic-team-step-20260804` exercised root activation, Lead turn 1,
analyst Attempt 1, and verifier Attempt 1 through
`claimQueuedById → ExecuteRun → CompleteRun → TeamPhaseCoordinator`, without the
free-running dispatcher or manual TeamDriver replay. It stopped at Lead review:
its Run persisted `failed` with `runtime_execution_failed`, no
RuntimeSession/provider agent was materialized for continuation, and no unique
next queued Run existed. That lifecycle diagnosis was superseded by the retained
long-lived-service proof and the current focused-smoke evidence above.

## Context and authority

The approved design is
[`docs/superpowers/specs/2026-08-03-agent-teams-v2-design.md`](../../superpowers/specs/2026-08-03-agent-teams-v2-design.md).
The executable plan is
[`docs/superpowers/plans/2026-08-03-agent-teams-v2.md`](../../superpowers/plans/2026-08-03-agent-teams-v2.md).
Repository instructions require the real main-flow E2E first, prohibit proactive
new test authoring, and require Human Gates for durable state, public contracts,
security boundaries, migrations, and core dependencies.

## Scope

- One branch and one eventual PR with four independent phase commits.
- One runtime and one canonical v2 TeamVersion shape for new invocation.
- Stable TeamRun, TeamMemberRun, RuntimeSession, WorkItem, Attempt, Run Events,
  registry, owner fencing, shared Work Board, TeamMessage wake, gates, and safe BFF.
- Exact implementation file map and removal list in the linked design and plan.

## Non-goals

- This active plan tracks the dirty Phase 1 implementation and its retained
  debugging/smoke evidence; it is not a documentation-only revision.
- No new unit, contract, integration, deterministic E2E, evaluation, or fixture
  tests.
- No second generic worker/queue, Project Lab, dynamic roster, nested Team, or
  unbounded workflow engine.
- Implementation and smoke evidence are phase-gated and will be recorded as each
  corresponding phase produces it.

## Work breakdown

- [ ] Phase 1: implement and prove the loose inner loop with context-bound tools,
      same-member continuation, TeamDriver in-process sequencing, and no
      message/durable-outer-scheduler/migration.
- [ ] Phase 2: implement and prove TeamMessage, canonical queued wake, one
      scheduler/reconciler, terminal facts, and context projection.
- [ ] Phase 3: implement and prove dependencies, atomic claims, gates, graceful
      finish semantics, Direct Message, Team Overview, and Web projection; permission
      framework and graceful shutdown remain deferred.
- [ ] Phase 4: after the v2 main-chain E2E, destructively remove old executors,
      compilers, repositories, routes, contracts, templates, smokes, tools, and
      documentation claims.
- [ ] Resolve durable-state, public-contract, security, migration, and core
      dependency Human Gates before the affected phase is accepted.
- [ ] Obtain implementation-time artifact review for the required TeamMessage
      migration and public Direct Message route; no new user question is needed
      unless an invariant materially changes.

## Verification

- [ ] `git diff --check` — expected boundary: zero whitespace errors.
- [ ] Inspect only the three created docs for unresolved placeholder
      contradictions — expected boundary: none; future unchecked work boxes remain
      intentional execution tracking.
- [ ] Run the Phase 1 real smoke with short timeout and retained state — expected:
      TeamDriver root activation, member checkpoint/submit, Lead request-changes, and
      same-member continuation.
- [ ] Run the Phase 2 retained flow — expected: addressed TeamMessage, canonical
      queued Task wake, one reconciler, and durable pause/resume evidence.
- [ ] Run `PASEO_MODEL=opencode-go/deepseek-v4-flash make agent-teams-v2-smoke`
      with the authorized environment secret through the safe allowlist — expected:
      terminal Team and safe replay; secret is not printed.
- [ ] Run only applicable existing focused checks — expected: exact command/result
      recorded as supporting evidence, with no new tests authored.

## Documentation impact

- [ ] Product/Feature — update only when implementation evidence changes the
      capability ledger.
- [ ] Component/Contract — resolve Team, runtime, message, gate, and safe BFF
      contract impact at the relevant Human Gate.
- [ ] ADR/Runbook — add or update only when migration, recovery, security, or
      operational behavior is actually implemented.

## Decisions and discoveries

- One v2 TeamVersion/TeamDriver is authoritative; old Team modes are not accepted
  for new invocation and are deleted rather than adapted.
- Phase 1 creates `src/application/teams/team-driver.ts` immediately. It owns root
  activation, Lead/member turn scheduling, and final completion; retained
  `src/application/tasks/execute-team-task.ts` calls only TeamDriver, while
  `src/application/runs/execute-run.ts` remains leaf Run execution.
- RuntimeSession bearer/grant and providerAgentId are stable across Tasks; no new
  token or Provider Agent/MCP session is created per Task. Turn-boundary refresh
  atomically updates taskId/runId/allowedTools/contextEpoch after old Run terminal,
  no in-flight Team tool, and no other active member Task; refresh precedes
  runtime.execute(continue).
- Phase 1 includes `src/infrastructure/extensions/local-runtime-extension-binder.ts`
  and `src/entrypoints/mcp/direct-memory-mcp.ts`; Direct MCP has no productSessionId
  fallback for Team actors and registers no mutation tools without
  teamMemberRunId/taskId/runId. Repository mutations validate Run.taskId,
  Task.teamMemberRunId, TeamRun/root, current non-terminal state, and fence.
- Team MCP re-resolves bearer/current grant per call, never initialize-cached
  actor/context. Stale epoch/context is a typed zero-write error; repository
  transactions also enforce owner scope, single active Task, policy/action, and
  Work/Attempt ownership/state. Whole-process recovery is not claimed.
- The owner explicitly approved one branch, four phase commits, and one eventual
  PR. This is an owner decision, not an implementation default.
- Phase 1 maps to existing schema: create writes Work `pending` plus Attempt
  `queued`; materialization/claim uses `in_progress`; member submit sets Attempt
  `completed` and leaves Work `in_progress` for Lead review; only Lead may request
  changes, accept, or finish. No Phase 1 migration.
- Lead-only tools are `team_work_create`, `team_work_request_changes`,
  `team_work_accept`, and `team_finish`; Member tools are `team_state`,
  `team_work_list`, `team_work_checkpoint`, and `team_work_submit`. `assignee`
  is a stable published-roster logical key resolved server-side within the
  owner-scoped roster, not an internal UUID or authorization credential.
- Phase 2 requires a forward-only TeamMessage migration and the persisted-queued,
  unique dedup, atomic consumed Task binding, one-active-Task, queued-on-failure,
  Reconciler rebuild, and bound Task/Run proof invariants.
- Prefer TeamMessage plus `Task`, `run_dispatches`, and `PostgresRunDispatcher`.
  Do not add `TeamTurnRequest` by default.
- `CompleteRun` records terminal facts and durable wake; it is not the Team
  semantic state machine.
- Phase 1 intentionally has no message, durable outer scheduler, or migration;
  TeamDriver still performs in-process turn sequencing.
- Phase 3 is Golden Path only: dependency, atomic claim, minimum gates, owner-safe
  Direct Message, and Team Overview. Generic permission and graceful shutdown are
  deferred.
- Phase 3 requires forward-only
  `0025_agent_team_work_dependencies.sql`, an owner-scoped unique dependency
  relation with self-edge prohibition, and atomic claims requiring every
  dependency WorkItem to be `accepted`.
- Phase 4 leaves only the v2 fixed TeamVersion/TeamDriver; no legacy
  `execution_mode` or `compiled_plan` contract remains.
- Phase 1 replacement smoke permits deletion of AgenticTeamExecutor; Phase 4
  retains ExecuteTeamTask as the canonical root Task entry and deletes only old
  mode branches/dependencies.
- Durable TeamMessage migration and the public Direct Message route require
  implementation-time artifact review. No further user question is needed unless
  an invariant materially changes.
- Phase 3 Web user-visible changes are designer-owned; Project Lab is out of scope.

## Risks and recovery

- Durable wake gaps may prevent continuation: retain state, reproduce with short
  timeout, and stop at the durable-state Human Gate rather than adding a second
  queue or `TeamTurnRequest` by default.
- Cross-member or stale claims may violate tenancy: stop at the Human Gate and
  preserve owner/revision fencing; do not weaken the contract to unblock smoke.
- Destructive cleanup may reveal stale references: run reference scan before and
  after deletion. Old smoke scripts are behavior reference only, never a gate.
- Paid smoke may fail for provider availability: report the exact failure without
  exposing secrets, retain diagnostic state, and do not claim acceptance.
- TeamMessage schema or consumption binding may violate durable evidence: stop at
  the migration Human Gate and preserve `queued` Message state until the atomic
  Task binding is proven.
- Stable grant refresh may race an in-flight tool or another active Task: stop at
  the runtime Human Gate and preserve the terminal/no-in-flight/single-active-Task
  preconditions rather than weakening the fence.
- Destructive schema cleanup may require
  `0026_agent-teams-v2-cutover.sql`; preserve prior migration files as immutable
  chain records only, not as runtime/API compatibility.

## Validation evidence

Current implementation validation: under Node 24 (`v24.18.0`) and pnpm 11.7.0,
`pnpm exec tsc --noEmit` passed after the retained single-Run debugger and Exec
Plan updates. `git diff --check` also passed with zero whitespace errors. The
current real-path evidence is the retained single-Run proof through Attempt 2
terminal and the focused `attempt2_terminal` smoke pass in 133223ms recorded in
`.local/phase1-attempt2-terminal-720s-configured-fix.log`. Historical
documentation-only `make check` evidence is superseded and is not a claim about
the current dirty implementation.

## Completion checklist

- [ ] Four phase commits exist on one branch and no unrelated production changes
      are present.
- [ ] Real main-flow smoke evidence covers inner loop, durable wake, collaboration,
      safe Web replay, and destructive no-reference cleanup.
- [ ] Existing focused checks, if run, are reported exactly as supporting evidence.
- [ ] Human Gates and documentation impact are resolved.
- [ ] This plan is moved to `docs/exec-plans/completed/`, marked completed, and has
      no unchecked items only after all work is actually complete.

## Current blocker

none for the Phase 1 `attempt2_terminal` acceptance boundary. A non-blocking
operational requirement remains: invoke the Docker focused smoke from a process
that has loaded the authorized org `.local/.env`, so `docker-run --pass-env
OPENCODE_GO_API_KEY` can forward the credential and the smoke can register its
non-sensitive `OPENCODE_CONFIG_CONTENT` model descriptor. The previous unavailable-model
run was preflight-only; the effective run below is the sole valid smoke evidence.

## Next exact command

Stop Phase 1 acceptance work here. Do not run `completion` or `full`; preserve
retained evidence and await the next authorized phase instruction.

## Cleanup state

Preserved all existing `.local/phase1-*` artifacts and the earlier retained
fixture. Retained fixtures and mode-0600 manifest/evidence live under
`.local/agentic-team-step-20260804*`; the effective Docker smoke retained its own
DB/runtime evidence as reported by the smoke. No commit, push, PR, merge, reset,
or clean was run.
