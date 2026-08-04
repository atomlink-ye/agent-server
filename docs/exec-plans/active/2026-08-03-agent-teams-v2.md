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

**Current Phase 1 evidence:** Phase 1 is committed at `76ef014` on
`agent/agent-teams-v2`. Its retained single-Run path reached Attempt 2 terminal,
and the effective focused `attempt2_terminal` smoke passed in 133223ms (recorded
in `.local/phase1-attempt2-terminal-720s-configured-fix.log`).

**Current Phase 2 accepted evidence:** one Node `v24.18.0` retained
real-server/Postgres flow passed in 5336ms with outer timeout 180s and exit 0. It used `createService`,
a real TCP Hono server, canonical HTTP import/publish/invoke, real Runtime MCP
bearer/grant resolution, and `PostgresRunDispatcher`; the provider runtime driver
and model decisions were deterministic substitutes, with no provider or Paseo use.
The authoritative redacted artifact is
`.local/phase2-server-1785843608320-eae1b3ac/manifest.json`. Independent
specification and migration/security reviews accepted the implementation. Phase 2
is committed at `ca5cfd5`; the applicable existing checks passed before commit.

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

## Phase 2 acceptance evidence (exact)

The Phase 2 MVE is accepted only when one retained real-server/Postgres flow records
all of these linked facts for the same owner-scoped TeamRun and member:

1. `team_messages`: an addressed `queued` Message with sender/recipient, safe kind,
   dedup key, and immutable body; duplicate wake insertion is a no-op.
2. One reconciler pass consumes that Message by atomically creating exactly one
   canonical queued child Task and binding `consumed_by_task_id` plus immutable
   input Message IDs; a second pass creates no second active Task.
3. The existing `run_dispatches` row is claimed by `PostgresRunDispatcher`, and the
   child Task/Run reaches terminal state through the canonical Task/Run path.
4. The durable Message is `consumed` only after Task binding; if materialization is
   rejected it remains `queued`. The proof is DB/API state, never provider delivery.
5. The scheduler/reconciler pause/resume log shows rebuild from durable queued
   Message state and a single addressed wake path; no second queue or
   `TeamTurnRequest` exists.

Required retained evidence IDs/paths: the smoke's redacted manifest, the database
query snapshot containing Message/Task/Run/run_dispatches IDs and states, the
reconciler pause/resume log, and the command exit result. Credentials, prompts,
provider payloads, and local secret paths must not appear in evidence.

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

- [x] Phase 1: implement and prove the loose inner loop with context-bound tools,
      same-member continuation, TeamDriver in-process sequencing, and no
      message/durable-outer-scheduler/migration.
- [x] Phase 2: implement and prove TeamMessage, canonical queued wake, one
      scheduler/reconciler, terminal facts, and context projection.
- [x] Phase 3: dependencies, atomic claims, gates, graceful finish semantics,
      Direct Message, Team Overview, and Web projection are proven by the accepted
      real-provider main flow; permission framework and graceful shutdown remain
      deferred.
- [ ] Phase 4: after the v2 main-chain E2E, destructively remove old executors,
      compilers, repositories, routes, contracts, templates, smokes, tools, and
      documentation claims.
- [ ] Resolve durable-state, public-contract, security, migration, and core
      dependency Human Gates before the affected phase is accepted.
- [ ] Obtain implementation-time artifact review for the required TeamMessage
      migration and public Direct Message route; no new user question is needed
      unless an invariant materially changes.

## Verification

- [x] `git diff --check` — zero whitespace errors at the Phase 2 boundary.
- [x] Inspect only the three created docs for unresolved placeholder
      contradictions — expected boundary: none; future unchecked work boxes remain
      intentional execution tracking.
- [x] Run the Phase 1 real smoke with short timeout and retained state — expected:
      TeamDriver root activation, member checkpoint/submit, Lead request-changes, and
      same-member continuation.
- [x] Run the Phase 2 retained flow — expected: addressed TeamMessage, canonical
      queued Task wake, one reconciler, and durable pause/resume evidence.
- [x] Accepted Phase 3 paid main flow: `.local/agent-teams-v2-1785869240170-c8676f41/manifest.json`
      recorded `RESULT_PASS` with `opencode-go/glm-5.2` in 156116ms (exit 0),
      real provider/Paseo, no deterministic substitution, and empty stderr. It
      proved 3 members, 2 accepted Work items/Attempts, 3 messages including 1
      delivered Direct Message, 4 Lead turns, 2 member Runs, and four unique Lead
      create/send/provider bindings.
- [x] Phase 3 supporting verification passed on the current implementation:
      `make test-integration` (143 passed, 36 skipped), `make web-check-types`,
      `make web-build`, `make check`, `make test-real-pg` (74 passed), and the
      scripted real-server/PostgreSQL/MCP main-flow smoke with `RESULT_PASS`.
- [x] The retained Phase 3 `init/status/next/step` fixture proved exact single-Run
      execution with the dispatcher stopped. Root advanced alone to
      `waiting_children`; the selected Lead timeout atomically converged the child
      Run, root Run, and Team to terminal failure without a second claim.
- [x] Run only applicable existing focused checks — `make check` passed and the
      existing focused ProductSession provenance test passed 1/1 (4 skipped); no
      new test was authored.

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
- RuntimeSession bearer/grant and providerAgentId remain stable across member Work
  and Direct continuations. Because a real Paseo/OpenCode `continue` retains its
  initial MCP catalog, each agentic Lead control Task gets a fresh task-scoped
  RuntimeSession, task/run/context-fenced grant, and Provider Agent with its exact
  policy tool set; the durable task/board snapshot supplies Lead context. Old Lead
  grants cannot authorize later Tasks, and no all-tools grant is issued. Member
  turn-boundary refresh still follows old-Run-terminal, no-in-flight-Team-tool, and
  no-other-active-member-Task checks before `runtime.execute(continue)`.
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

### Authoritative Phase 2 retained flow

The accepted artifact is
`.local/phase2-server-1785843608320-eae1b3ac/manifest.json` with retained database
`agent_server_phase2_server_1785843608320_eae1b3ac`. It records TeamRun
`8db96226-4981-48b9-bf6d-80899c414363` and member
`6126830e-bedd-4635-9476-cd66ef5ae4e8` across both attempts. Attempt 1 bound
Message `fbb54d72-8ecd-4b87-9e8d-0a9f7d92c1ec` to Task
`76efb992-472c-4581-8ad7-dc34f6721069` and Run
`2e53f4fc-0709-4031-bfc5-a9b778b4fef4`. Attempt 2 replay preserved Message
`87acf595-f6cb-4da9-9601-73c753484616`, dedup key, queued status, and body hash
with cardinality Message=1/Task=0/Run=0/dispatch=0 before materialization.

A deliberate same-member active-Task conflict caused admission rollback with the
Message still queued and Task/Run/dispatch still zero. After the fault was
restored, a fresh Reconciler instance produced exactly one Task
`7b37c21d-c315-42f4-92e8-b9dc065493df`, Run
`0652b093-65c5-4fba-a63e-efa7893d0697`, and `run.enqueue`; the second reconcile
returned zero. The real dispatcher published both dispatches, both attempts and
their Tasks/Runs reached terminal success, the member returned idle with zero
active Tasks, and Lead turns separately performed request-changes, accept, then
finish. The Team, root Task, and root Run reached `succeeded/completed/succeeded`.
The Team control state advanced through `member_work_running`,
`member_work_running`, `lead_ready`, `lead_running`, then `terminal`.
Task Team provenance is exact and ProductSession provenance remains null; no
`TeamTurnRequest` relation exists. Evidence directory mode is 0700, manifest/log
files are 0600, stderr is empty, and the retained evidence files contain no
credential, prompt, provider payload, or local path.

Independent reviewers returned `PHASE2_SPEC_ACCEPTED`,
`PHASE2_QUALITY_APPROVED`, and a durable-state/migration/security Human Gate pass.
The plan's separately named scheduler/context-projector responsibilities are
implemented equivalently by `TeamWakeReconciler`, the existing
`CompleteRun`/`TeamPhaseCoordinator`/`TeamDriver` composition, and
`TeamToolContextResolver`/`ProjectAgenticTeam`; Direct Message remains Phase 3.

The supporting production-component rebuild artifact is
`.local/phase2-cd-1785842428909-d935dda1/manifest.json`. It independently closes
the exact pre/post replay fields and fresh-pool component rebuild boundary. It is
supporting evidence only; the real-server artifact above is authoritative.

### Superseded Phase 2 investigations

The earlier `.local/phase2-production-wiring.json` contains only a retained-ready
`lead_command` checkpoint, despite an intermediate prose claim that it represented
a passed full flow. It and `.local/phase2-production-lead.log` are historical
diagnostics only and are explicitly excluded from acceptance.

The older stepwise repository harness used directly seeded prerequisites and
different TeamRuns for its wake observations. It helped locate the durable path
but did not prove the current exact same-flow contract; it is superseded by the
two authoritative/supporting artifacts above.

Superseded bounded-contract result: the earlier candidate stopped before Scenario C
because its captured Lead Task/Run were queued instead of active/running. Its
different-TeamRun evidence remains retained at
`.local/phase2-bounded-scenario-cd.json` and is not used for acceptance.

- [ ] Four phase commits exist on one branch and no unrelated production changes
      are present.
- [ ] Real main-flow smoke evidence covers inner loop, durable wake, collaboration,
      safe Web replay, and destructive no-reference cleanup.
- [ ] Existing focused checks, if run, are reported exactly as supporting evidence.
- [ ] Human Gates and documentation impact are resolved.
- [ ] This plan is moved to `docs/exec-plans/completed/`, marked completed, and has
      no unchecked items only after all work is actually complete.

## Current blocker

No Phase 3 product or provider blocker remains. The accepted GLM artifact also
proves dependency/migration/replay, Direct delivery, safe projection, the
completion fence, and mode-accurate member completion evidence. Key fixes retained
by the implementation are fresh task-scoped Lead catalogs, canonical fixture
prompts, stale-Lead/all-actor scheduling fences, recursive projection scanning, and
the split between durable Lead commands and exposed coordination commands. Final
verification also retained explicit stale-worker fencing, preserved the bound
session-message receiver, made migration 0025 constraint replay schema-local, and
made every later Lead CAS/Task/Run/dispatch admission one atomic transaction.

Deferred, non-blocking: Direct redaction body text may retain the literal `$1`; it
contains no secret and can be cleaned up later.

## Next exact command

Begin Phase 4 Task 4.1 with the approved non-destructive canonical-v2 rewiring and
reference scan. Destructive cleanup remains separately gated by the approved Phase
4 scope and no-reference review. Do not push, merge, reset, or clean.

## Cleanup state

Preserved all existing `.local/phase1-*` artifacts and the earlier retained
fixture. Retained fixtures and mode-0600 manifest/evidence live under
`.local/agentic-team-step-20260804*`; the effective Docker smoke retained its own
DB/runtime evidence as reported by the smoke. No commit, push, PR, merge, reset,
or clean was run.
