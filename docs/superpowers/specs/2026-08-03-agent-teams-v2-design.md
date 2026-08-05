# Agent Teams v2 Formal Design

**Status:** approved for implementation
**Date:** 2026-08-03
**Stage:** Prove, then cut over
**Human Gates:** durable state and migrations, public Team/Web contracts, tenant and credential boundaries, runtime/core dependency changes

## Decision summary

Agent Teams v2 uses one control-plane runtime. The final TeamVersion selects only
the v2 fixed roster, Lead, and Environment; TeamDriver owns the one fixed policy,
dynamic Work/dependency protocol, and final-output gate rather than accepting
caller-selectable variants. Old DAG, Sequential,
Collaborative MVE, and Agentic MVE shapes are not accepted by new invocation and
have no runtime or API read path. There is one branch and one eventual
PR, with four independent phase commits.

The durable kernel remains `Task`/`Run`, `TeamRun`/`TeamMemberRun`,
`WorkItem`/`Attempt`, owner fencing, `RuntimeSession` continuation, Run Events,
the registry, and the safe BFF. The Team runtime adds one shared dependency-aware
Work Board, atomic claims, context-bound Team tools, addressed mailbox delivery,
idle/wake behavior, narrow blocking gates, and a safe Web projection.

`src/application/teams/team-driver.ts` is the canonical v2 TeamDriver. From
Phase 1 onward it owns root Team activation, Lead/member turn scheduling, and the
final-completion facade. `src/application/tasks/execute-team-task.ts` remains
the canonical root Task entry and calls exactly one TeamDriver; it is not removed
in Phase 4. `src/application/runs/execute-run.ts` remains leaf member Run
execution and is not the Team root Driver.

Runtime continuation reuses a stable RuntimeSession bearer/grant and
`providerAgentId` across Tasks; it does not mint a new token per Task or rebuild
the Provider Agent/MCP session. Stable, non-rebindable fields are owner scope,
TeamMemberRun, and RuntimeSession. At each Turn boundary, the current grant may
atomically refresh `taskId`, `runId`, `allowedTools`, and `contextEpoch`.

Before refresh, the old Run must be terminal, no Team tool call may be in flight,
and the member must have no other active Task. Refresh occurs before
`runtime.execute(continue)`. `execute-run.ts` must not update only allowedTools
while retaining stale Task/Run bindings.

## MVE contract

The first vertical slice is a real Team run, not a synthetic coordinator demo:

```text
canonical Task admission
  -> one TeamRun and stable TeamMemberRuns
  -> one Lead turn with member-scoped context and real domain tools
  -> member work, checkpoint/submit, Lead review/request-changes
  -> durable message or queued wake
  -> dependency-aware claim and continuation
  -> narrow gate or graceful completion
  -> safe Web projection and replay from durable state
```

Phase 1 deliberately proves the loose inner loop without messages, a durable outer
scheduler, or migrations; the in-process TeamDriver still sequences root, Lead,
and member turns. The model submits no IDs, revision, or hash. A Lead may issue
multiple commands in one turn. Members have real domain tools for checkpoint and submit
and continue in the same member-scoped RuntimeSession; only the Lead can request
changes, accept, or finish.

The primary acceptance evidence is one retained real smoke. No new unit,
contract, integration, deterministic E2E, fixture, or evaluation test suite is
authored for this design. Existing focused checks are supporting evidence only.

## Object and state model

### Stable identities

```text
Task                  canonical invocation identity
Run                   one execution attempt of a Task
TeamRun               durable coordination identity for one Team invocation
TeamMemberRun         stable roster-member participation identity in a TeamRun
RuntimeSession        internal continuation identity owned by TeamMemberRun
WorkItem              stable semantic goal on the shared Work Board
Attempt               immutable execution history for one WorkItem claim
TeamMessage           addressed durable collaboration message
Run Event             immutable execution evidence and replay source
```

Every Team child Task carries explicit `team_member_run_id`, `team_sequence`, and
`team_task_kind`. Web uses `team_member_run_id` as its Agent Session identity and
never exposes the internal RuntimeSession ID. An Attempt points to its execution
Task; history is append-only and prior results are never overwritten.

#### Member execution-tree identity

An OpenCode member agent and every recursively spawned subagent belong to one
member execution tree. The tree owns exactly one `TeamMemberRun`, RuntimeSession,
stable Runtime Grant bearer, current Team child Task, Run, and Attempt. Descendants
do not create independent Team identities. Every descendant Team MCP call
re-resolves that stable bearer to the current owner-scoped member context, so a
descendant acts as the member without selecting internal identities.

Member instructions prefer a parent-owned protocol: subagents perform bounded
domain work and return findings, while the outer member aggregates the result and
calls checkpoint and submit. This is guidance rather than an authorization
boundary. A valid checkpoint or submit from any descendant is accepted as an
action by the same member. Work can complete only through the canonical Team
protocol; runtime text, idle state, or domain-tool activity never implies submit.

The first valid `team_work_submit` atomically completes the current Attempt and
leaves its WorkItem `in_progress` for Lead review. That durable Team-protocol
submission is authoritative: a later outer Run error or timeout cannot downgrade
the completed Attempt to `failed`. If the outer Run terminates before any valid
submit, the running Attempt fails. Repeated or stale submissions receive a safe
rejection and cannot modify another Attempt.

Phase 1 does not cancel the OpenCode execution tree immediately after submit.
The outer Run may continue until its normal terminal boundary, after which
TeamDriver schedules Lead review. Immediate tree cancellation is deferred until
the runtime has an explicit submit-to-cancel control path with defined race and
recovery semantics.

The Work Board is dependency-aware. The current MVE maps to the existing schema:
`WorkItem.status` uses the existing `pending` then `in_progress` path after
materialization/claim; the current Attempt is `queued`, `running`, `completed`,
or existing failure state. No Phase 1 migration is added.

### Current MVE Mapping

Phase 1 uses existing TeamRun/TeamMemberRun enums, existing WorkItem/Attempt
enums, and existing rows. A checkpoint is a safe durable RunEvent
plus a Team projection fact on the current Run. Member submit marks the current
Attempt `completed` and leaves the WorkItem in existing `in_progress` as the
Lead-review state. Only the Lead may request changes, creating the next immutable
`queued` Attempt with feedback; only the Lead may accept or finish. Members may
only state/list/checkpoint/submit in Phase 1. Message and block are Phase 2 or
later capabilities.

### Target-after-migration

After the required Phase 2 TeamMessage migration, addressed messages and queued
wakes become durable. Phase 3 adds only the required dependency relation through
the separate forward-only `0025_agent_team_work_dependencies.sql` migration; it
does not add unnecessary Work or Member enum values. Target states may
distinguish ready, claimed, blocked, submitted, changes-requested, accepted, and
terminal failure, but these are not claimed to exist in the current schema.

Claims remain atomic and fenced by owner, TeamRun revision, member identity, and
active attempt constraints.

### Runtime and control states

The common v2 runtime has one state machine:

```text
TeamRun: admitted -> active -> idle|waiting|blocked -> active -> succeeded|failed|cancelled
Member:  registered -> ready -> running -> idle|waiting|blocked -> ready -> finished
WorkItem (current): pending -> in_progress -> accepted
Attempt (current): queued -> running -> completed (or existing failure)

Target-after-migration WorkItem: pending -> ready -> claimed -> in_progress
          -> submitted|changes_requested -> accepted|failed|cancelled
Target-after-migration Attempt: queued -> claimed -> running
          -> submitted|changes_requested|failed
```

The scheduler/reconciler may wake durable work, but `CompleteRun` records terminal
facts and a durable wake; it is not a semantic Team state machine. A scheduler
pause/resume must preserve evidence and continue from durable state, but does not
claim whole Agent Server restart recovery in this slice.

## Inner-loop tools and context invariant

Phase 1 creates `team-tool-context.ts`, `team-command-service.ts`, and
`team-policy-evaluator.ts`, and updates Team tool/MCP registration and runtime
grants. The command surface is semantic and narrow:

Lead-only tools:

```text
team_work_create
team_work_request_changes
team_work_accept
team_finish
```

Member tools:

```text
team_state
team_work_list
team_work_checkpoint
team_work_submit
```

The current-turn legal subset is policy-derived. Both roles may use safe reads.
`team_work_create` and `team_work_request_changes` accept business-semantic
`assignee`, resolved from the published roster's stable logical name/key (with
role available for display or validation). The server uniquely resolves that key
within the owner-scoped TeamRun roster to a TeamMemberRun; ambiguity or absence
returns a typed error. `assignee` is a business-logic identifier, never an
authorization credential or internal member UUID. `team_message_send` is not
registered in Phase 1; messaging is introduced in Phase 2.

The exact available subset is derived twice from the same durable, owner-scoped,
member-scoped context: once for the prompt/tool context and once for the runtime
grant. No model input can select a Task ID, Run ID, revision, hash, member
identity, arbitrary AgentVersion, provider, or model. The server resolves current
TeamMemberRun, WorkItem, Attempt, dependencies, mailbox, gates, and limits from
the authenticated owner and active RuntimeSession. A stale or cross-member
context receives a safe rejection and cannot mutate state.

Phase 1 also creates `src/infrastructure/extensions/local-runtime-extension-binder.ts`
and `src/entrypoints/mcp/direct-memory-mcp.ts`. Direct MCP removes the Team actor
`productSessionId` fallback. If `teamMemberRunId`, `taskId`, and `runId` are not
all present, mutation tools are not registered. Every mutation repository call
checks `Run.taskId`, `Task.teamMemberRunId`, TeamRun/root identity, current
non-terminal state, and the current fence. Logical `assignee` resolution remains
unique within the owner-scoped published roster; the server generates command
hash/id and transactionally reads the current revision.

Each Team MCP tool call re-resolves the stable bearer and current grant; it never
uses actor/context cached at MCP initialize. Repository transactions additionally
check owner scope, single active Task, policy/action, and Work/Attempt ownership
and state. A stale epoch or context returns a typed error with zero partial writes.
This design does not claim whole-process recovery.

One Lead Turn may emit several valid commands; the command service applies each
through the same policy and owner fence, preserving command order and durable
results. Members use domain tools bound to their current Attempt and cannot claim
or mutate another member's work.

## Message and wake semantics

Prefer `TeamMessage` plus the existing canonical queued `Task` and
`run_dispatches`/`PostgresRunDispatcher`. Do not create a second generic worker or
queue. A TeamMessage is addressed to a TeamMemberRun, owner-scoped, durable, and
ordered by TeamRun sequence. It records sender, recipient, related WorkItem or
Attempt, safe kind, body, and delivery/read state without exposing secrets.

The TeamMessage migration is required and is a durable-state Human Gate. Message
persisted means `queued`. Its core invariants are:

- `dedup_key=member:<memberRunId>:wake:<reason/source>` is unique.
- Task materialization transactionally binds `consumed_by_task_id` and immutable
  input Message IDs.
- Each member has at most one active Task.
- If Task creation fails, Message remains `queued`.
- The Reconciler rebuilds work from queued Messages.
- After Run terminal, the bound Task/Run proves consumption; provider-delivered
  state is not used as evidence.

Message wake uses the existing canonical queued Task, `run_dispatches`, and
`PostgresRunDispatcher`. No `TeamTurnRequest` domain, table, or port is added by
default. The Reconciler coalesces redundant wakes and fences the recipient
continuation.

Idle means no runnable owned work exists and the member may sleep. Wake means a
new addressed message, dependency transition, gate decision, or queued Task makes
the member eligible. Waiting and blocked are distinct: waiting has a known future
wake condition; blocked requires a narrow human or policy gate.

## Gates, permissions, and completion

The current MVE keeps only the minimum owner-safe finish gate. Generic permission
frameworks and graceful shutdown semantics are deferred unless the real Golden
Path is blocked by one of them; the current plan does not claim those
capabilities.

`CompleteRun` may atomically record terminal facts, root/child relationships,
events, and a durable wake. It cannot infer semantic completion from a callback.
The Team runtime completes only after the Work Board and gate policy prove that
all required work is accepted, no forbidden active Attempt remains, and the final
result is safe and owner-scoped.

## Four-phase delivery and exact file map

### Phase 1: loose inner loop

Create `src/application/teams/team-driver.ts`,
`src/application/teams/team-tool-context.ts`,
`src/application/teams/team-command-service.ts`, and
`src/application/teams/team-policy-evaluator.ts`.

Modify `src/application/teams/team-tools.ts`,
`src/adapters/team-mcp/team-mcp-tools.ts`,
`src/application/extensions/runtime-tool-grant-service.ts`,
`src/application/agents/built-in-skills.ts`,
`src/infrastructure/extensions/local-runtime-extension-binder.ts`,
`src/entrypoints/mcp/direct-memory-mcp.ts`,
`src/infrastructure/postgres/postgres-collaborative-team-repository.ts`,
`src/application/tasks/execute-team-task.ts`,
`src/application/runs/execute-run.ts`,
`src/application/teams/agentic-team-executor.ts`,
`src/bootstrap.ts`, the template agents, and
`scripts/smoke/agentic-team-chat-main-flow.mjs`.
After the replacement smoke, delete `src/application/teams/agentic-team-executor.ts`
or move its complete logic into TeamDriver and remove every reference; do not
maintain both executors long-term. Do not add a message, scheduler, or migration
in this phase.

### Phase 2: durable outer loop

Create the TeamMessage domain/port/Postgres repository, the Team turn
scheduler/reconciler, and the context projector. Add the required forward-only
TeamMessage migration. Modify `src/application/runs/complete-run.ts`,
`src/infrastructure/postgres/postgres-collaborative-team-repository.ts`,
`src/bootstrap.ts`, contracts, routes, and the safe Web projection. Reuse
`run_dispatches` and `PostgresRunDispatcher`; do not create a
`TeamTurnRequest` domain/table/port by default. If the retained real flow proves
that Message plus canonical queued Task cannot reliably express wake, stop at the
durable-state Human Gate and choose the smallest primitive. The scheduler is one
reconciler, not a new semantic state machine.

### Phase 3: collaboration closure

Modify `src/domain/teams/team-work-item.ts`,
`src/domain/teams/team-work-item-attempt.ts`,
`src/domain/teams/team-run.ts`, command/policy/repository layers, MCP schemas,
and the Web BFF/routes/page/sidebar/styles. Implement dependencies, atomic claim,
minimum submit/idle/finish gates, owner-safe Direct Message, and Team Overview,
but only to the Golden Path required for acceptance. Generic permission and
graceful shutdown implementation are deferred. User-visible
changes are designer-owned. Do not build Project Lab.

### Phase 4: destructive single-runtime cutover

After the new v2 main-chain real E2E passes, directly delete the old
sequential/DAG/collaborative/agentic executors, compilers, repositories,
contracts, routes, templates, smokes, tool registrations, and documentation
claims. Development databases and fixtures may be rebuilt. Historical migration
files remain only as immutable migration-chain records; they do not preserve old
runtime or API reads. If required, add the approved forward-only
`0026_agent-teams-v2-cutover.sql` migration to remove or converge legacy tables,
columns, and constraints.

The final TeamVersion has no legacy `execution_mode` driver selection and no
`compiled_plan` policy for old no-Lead DAGs. Remove mode branches and the old
graph/compiled-plan execution contract; retain only the v2 fixed roster, Lead,
Environment, and the server-owned v2 policy/Work/dependency/final-output rules.

`src/application/tasks/execute-team-task.ts` is retained as the canonical root
Task entry and calls only TeamDriver. `src/application/runs/execute-run.ts` stays
the leaf member Run executor.

The cutover review must include these exact legacy/compiler paths:
`src/application/tasks/execute-team-task.ts`,
`src/application/tasks/advance-team-execution.ts`,
`src/application/invokables/dag-team-compiler.ts`,
`src/application/invokables/sequential-team-compiler.ts`,
`src/domain/teams/managed-team-package.ts`,
`src/infrastructure/postgres/postgres-team-execution-repository.ts`,
`src/infrastructure/postgres/postgres-invokable-repository.ts`, and
`src/bootstrap.ts`, then reference-scan and delete every runtime reference.

## Security boundary

All commands, messages, wakes, claims, gates, and projections are owner-scoped and
tenant-scoped. Authorization comes from the authenticated service/session context,
not model-provided fields. A member may see only its assigned context and safe
Team messages; the Lead sees only policy-allowed summaries. Web BFF routes perform
the same owner check and never expose service credentials, prompts, raw provider
payloads, local paths, tenant/principal internals, or RuntimeSession IDs. Clients
cannot select arbitrary models, providers, teams, agents, or wake targets.

## Destructive cutover invariant

Only the v2 TeamVersion shape is accepted by new invocation. Old inputs, runtime
reads, routes, tools, and mode contracts are deleted rather than compiled or
adapted. Historical migration files do not preserve runtime or API reads.

The owner explicitly approved one branch, four phase commits, one eventual PR,
and destructive removal of old Team modes. Durable TeamMessage migration and the
public Direct Message route require implementation-time artifact review, but no
further user question is required unless an invariant materially changes.

## Real acceptance

The retained smoke must use a real server, Postgres, dispatcher, RuntimeSession,
domain tools, and authorized paid smoke configuration:

```bash
PASEO_MODEL=opencode-go/deepseek-v4-flash make agent-teams-v2-smoke
```

The authorized environment secret is passed through the existing allowlisted
mechanism and is never printed. Debugging is stepwise with short timeouts and
retained state; after blockers are fixed, run one full real paid smoke. Evidence
must show stable TeamMemberRuns and RuntimeSessions, a dependency-aware claim,
addressed message/wake, checkpoint and submit or Lead request-changes, the minimum
finish gate, terminal facts, safe Web projection, and replay after refresh.

Phase 1 extends the existing `scripts/smoke/agentic-team-chat-main-flow.mjs` as a
stepwise harness. Phase 3 renames/converges it to
`scripts/smoke/agent-teams-v2-main-flow.mjs` and creates the canonical
`make agent-teams-v2-smoke` command. Phase 1 and Phase 2 therefore use the
existing harness name, while the Phase 3 cutover command is fixed.

## Deferred scope

Defer generic permission frameworks, graceful shutdown, dynamic rosters, nested Teams, general workflow/DAG authoring, a second
generic queue, automatic generalized retry, multi-node leadership, broad search,
cross-TeamRun sessions, production identity/ACLs, arbitrary model selection,
advanced cost accounting, and full Agent Server restart recovery. Defer these
without weakening owner fencing, durable evidence, gate semantics, or the first
real main-flow acceptance path.
