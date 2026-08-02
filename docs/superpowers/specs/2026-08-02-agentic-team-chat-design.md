# Agentic Team Chat MVE Design

**Status:** approved for implementation  
**Date:** 2026-08-02  
**Stage:** Prove  
**Human Gates:** durable schema, Team public contract, Team capability changes

## Problem

The current Collaborative Team proves a fixed sequence:

```text
Lead kickoff -> one task per fixed member -> one Lead finalization
```

The control plane, not the Lead, determines that topology. The Lead cannot judge
that a result is weak, request focused rework from one member, inspect the new
result, and only then finalize.

The current Project Lab also duplicates information already available through
Web Chat. Its dashboard does not expose the actual Lead and member transcripts,
so it is less useful than the existing Chat history and Run Event projection.

## Product Decisions

1. Web Chat remains the only primary interaction surface. The standalone
   Project Lab is removed from the MVE path.
2. The left sidebar gains one Project directory containing the Agent Sessions
   for one TeamRun. Cross-run Project history is deferred.
3. Selecting a Lead or member session opens a normal, read-only Chat transcript
   backed by that member's Tasks, Runs, and Run Events.
4. The Team roster remains fixed and published. The Lead may dynamically create
   work, assign it to a roster member, judge its result, request rework, and
   request Team completion.
5. A real smoke must reliably demonstrate one Lead-requested rework turn before
   final completion.
6. Learning Proposal and Memory review UI are removed from this slice. Their
   backend contracts remain intact.
7. Project is a fixed Web/BFF projection for this MVE, not a new server-side
   registry entity. The Web starts one configured TeamRun and can rediscover
   that owner-scoped run after refresh.

## Appetite and MVE Boundary

```yaml
stage: prove
outcome: A user can watch a fixed-roster Team complete a Lead-directed rework loop through normal Web Chat.
real_path: Web Chat launch -> Lead turn -> member work -> Lead review -> member rework -> Lead completion -> session replay
highest_unknown: Durable Lead autonomy can remain bounded and recoverable without building a general workflow engine.
scope_now:
  - one Project and one TeamRun in the Web sidebar
  - fixed Lead plus two fixed members
  - Lead-directed create, assign, review, rework, and completion commands
  - one reusable runtime session per Team member within the TeamRun
  - read-only Lead/member transcript projection
  - one deterministic real scenario that causes a rework turn
no_gos:
  - dynamic roster or arbitrary AgentVersion selection
  - nested Teams or general DAG expressions
  - cross-TeamRun long-lived Agent Sessions
  - user messages injected during an active TeamRun
  - public or multi-user deployment
  - Learning Proposal or Memory review UI
exit_condition: The real smoke shows the Lead rejecting an insufficient first result, dispatching a second attempt, completing the Team, and reconstructing all Agent transcripts after refresh.
```

## Architecture

Use a **controlled Agentic Turn Loop**. The model chooses semantic next actions;
the control plane remains authoritative for state, authorization, scheduling,
budgets, idempotency, and terminal completion.

### Lead responsibilities

The Lead may use narrow, typed Team tools to:

- create and assign a WorkItem to a published roster member;
- accept a completed WorkItemAttempt;
- request rework with feedback and an assignee;
- request Team completion, then return the final text as the Lead Run result.

The Lead cannot select arbitrary AgentVersions, mutate raw statuses, complete the
root Task directly, or bypass budget and capability checks.

### Control-plane responsibilities

The control plane:

- validates the actor, Team revision, roster member, command, and budget;
- persists each Lead decision before scheduling work;
- materializes each semantic dispatch as a canonical child Task and Run;
- resumes the Lead only when the currently dispatched work settles;
- preserves every prior attempt and result;
- enforces concurrency, turn, work, attempt, token, and wall-clock bounds;
- validates a completion request before atomically completing TeamRun, root Run,
  and root Task;
- reconstructs the next action solely from durable state after restart.

## Domain Model

### TeamRun

Add a new Team execution mode, `agentic`, while preserving existing
`collaborative` runs and their historical representation. Agentic TeamRuns use
this small control loop:

```text
status: active | succeeded | failed | cancelled
control_state: lead_ready | lead_running | member_work_running | terminal

active / lead_ready
  -> active / lead_running
  -> active / member_work_running
  -> active / lead_ready
  -> succeeded / terminal
```

Add durable counters and fencing:

- `revision`
- `lead_turn_count`
- `stop_reason`

MVE limits:

- maximum four Lead turns;
- maximum four WorkItems;
- maximum two attempts per WorkItem;
- maximum one active attempt per member;
- maximum two active member attempts per TeamRun;
- existing per-Run timeout remains authoritative.

Counts are derived under the TeamRun lock from WorkItems and attempts rather
than copied into TeamRun counters. Exhausted limits end the TeamRun as `failed`
with a safe `stop_reason`; they do not add another public status in this slice.

### WorkItem and WorkItemAttempt

`TeamWorkItem` is the stable semantic goal. Do not reopen and overwrite a
completed row. Add `TeamWorkItemAttempt` for each initial assignment or rework:

```text
TeamWorkItem
  id
  team_run_id
  created_by_member_id
  subject
  description
  status: open | accepted

TeamWorkItemAttempt
  id
  work_item_id
  attempt_no
  assignee_member_id
  requested_by_lead_task_id
  feedback
  execution_task_id
  status: queued | running | completed | failed
  result_summary
```

A provider timeout or worker crash creates another Run for the same execution
Task only when an existing explicit Run retry path requests it; generalized
automatic retry is not added here. A failed attempt returns control to the Lead.
Lead-requested semantic rework creates a new WorkItemAttempt and a new Task.
Historical attempts are immutable.

### TeamMemberRun and Agent Session

`TeamMemberRun` remains the durable identity of one roster member participating
in one TeamRun. It owns one reusable internal RuntimeSession and many Tasks:

```text
TeamRun
  -> TeamMemberRun (user-visible Agent Session projection)
      -> RuntimeSession (internal, never exposed)
      -> Lead-turn or WorkItemAttempt Tasks
          -> Run attempts
              -> Run Events
```

The Web-facing `agent_session_id` is the `team_member_run_id`. It is not a
ProductSession ID and not a provider RuntimeSession ID.

Every Team child Task has an explicit durable association:

```text
team_member_run_id
team_sequence
team_task_kind: lead_turn | work_attempt
```

Do not derive Agent Session membership by parsing `logical_step_key`.
`TeamWorkItemAttempt.execution_task_id` separately links one attempt to its
canonical execution Task.

## Commands and Events

Replace unrestricted status mutation in the Lead capability with semantic
commands:

- `team_work_create_and_assign`
- `team_work_accept`
- `team_work_request_rework`
- `team_completion_request`
- existing read/list capability

Each mutation requires the active Lead Run fence. A command receipt is unique by
`(source_run_id, normalized_command_hash)` and stores the result returned to the
tool, making runtime/tool replay idempotent for the MVE command set. The same
Lead Run cannot intentionally issue two byte-equivalent commands; that use case
is outside this slice.

`TeamWorkItemAttempt(status = queued)` is the durable dispatch intent. No
separate Team event stream or generic outbox is introduced in this slice.
Existing Run Events continue to provide immutable execution evidence and Chat
transcript projection.

`team_completion_request` only records completion intent on the active Lead
turn. It never completes the Team inside the tool call. After that Lead Run
succeeds, the control plane uses its canonical Run result as final text, checks
the current Team revision and completion conditions, and only then atomically
completes TeamRun, root Run, and root Task.

## Scheduling Loop

1. The root invocation creates the TeamRun and one TeamMemberRun for every fixed
   roster member.
2. The scheduler creates a Lead-turn Task when control state is `lead_ready` and
   no Lead turn is active.
3. The Lead receives a bounded snapshot of goal, WorkItems, latest attempts,
   accepted results, failures, remaining limits, and allowed commands.
4. A Lead command transactionally updates Team state, writes a command receipt,
   and creates queued WorkItemAttempts.
5. The scheduler materializes each queued attempt exactly once as a child
   Task/Run, using `work_item_attempt_id` as the unique materialization key.
6. When all active attempts settle, the scheduler returns the TeamRun to
   `lead_ready` and resumes the same Lead RuntimeSession with a new Lead-turn
   Task.
7. After the requesting Lead Run succeeds, completion succeeds only when no
   attempt is active, every WorkItem is accepted, the canonical final Lead text
   is non-empty, and the submitting Lead fence/revision is current.

No orchestration decision depends solely on an in-memory callback or prompt.

## Web Chat Information Architecture

### Sidebar

Extend the existing Conversation Sidebar rather than creating a second shell:

```text
Project
  Lead · Research direction           Completed
  Opportunity analyst                Completed
  Analog / risk reviewer             Completed

Chats
  Existing Product Sessions...
```

The Project item defaults to the Lead Agent Session. Member rows show role and
current activity. Rework attempts appear as ordered turns in that member's
transcript rather than adding another sidebar hierarchy.

### Transcript

The right side reuses the existing Web Chat message, activity, reasoning, tool,
usage, replay, and responsive components.

An Agent Session transcript is a server-side projection:

- each Task assigned to the TeamMemberRun becomes one turn;
- the control-plane assignment/feedback becomes the user-side turn context;
- Run Events reconstruct assistant text, reasoning, tools, usage, and lifecycle;
- attempts are ordered by Team sequence and Task creation time;
- historical and live projection share the existing stream reducer shape.

The first slice is read-only. The composer is hidden or disabled with clear copy
for Team Agent Sessions. Existing ProductSession chats remain interactive.

### Lightweight Team context

The Lead transcript may include compact Team activity blocks linking to member
sessions. Do not recreate People, WorkItems, Activity, Report, and Memory as a
dashboard. Low-frequency IDs and lineage remain in the existing details drawer.

## Web APIs

Add a bounded owner-checked BFF projection rather than overloading the existing
ProductSession contract:

```text
POST /api/team-project/runs
GET /api/team-project
GET /api/team-project/sessions/:teamMemberRunId
GET /api/team-project/sessions/:teamMemberRunId/runs/:runId/events
GET /api/team-project/runs/:runId/events/stream
```

`POST /runs` invokes the fixed server-side Team configuration and returns the
root Task ID. `GET /api/team-project` accepts that safe root Task ID when present
and otherwise returns the latest owner-scoped Agentic TeamRun created through
this fixed MVE entry point. This is sufficient for empty-storage refresh without
creating a Project registry. The browser cannot choose Workspace, Team,
AgentVersion, model, provider, token, or arbitrary non-project root Task.

Responses expose only display names, roles, safe statuses, attempt labels,
assignment/feedback summaries, assistant text, safe Run Events, usage, and
owner-checked IDs. They never expose prompts, service tokens, provider IDs,
RuntimeSession IDs, raw runtime payloads, tenant/principal IDs, or local paths.

## Failure and Recovery Semantics

- A failed member Run remains evidence; this slice does not add automatic Run
  retry.
- A failed WorkItemAttempt returns control to the Lead if budget remains.
- Invalid or duplicate Lead commands are rejected without partial state change.
- A scheduler restart reconstructs active TeamRuns from Team state, command
  receipts, attempts, Tasks, and Runs.
- Four Lead turns, exhausted attempts, or timeout produce `failed` with a safe
  stop reason and must never be reported as a successful final answer.
- The first MVE keeps automatic paid-model selection forbidden.

## Real Smoke Scenario

Use the fixed self-learning research fixture, adjusted so the first analyst
result omits one explicit required evidence category. The Lead quality criteria
require that category but do not prescribe a fixed task graph.

Expected observable path:

1. Lead creates and assigns initial work.
2. Analyst completes a first attempt with insufficient evidence.
3. Lead reviews the durable result and emits `team_work_request_rework` with
   focused feedback.
4. The same analyst runs a second WorkItemAttempt in the same member
   RuntimeSession but through a new Task/Run.
5. Lead accepts the improved result, optionally consumes the second member's
   result, and requests completion.
6. Control plane validates and completes the Team.
7. Web shows Lead plus member Agent Sessions, both analyst rounds, tool activity,
   and the final report.
8. Browser refresh reconstructs the same Project/session tree and transcripts
   from durable state with empty browser storage.

The smoke passes only if the rework command was chosen by the Lead from the
observed insufficient result, not injected as a fixed coordinator phase.

## Validation

Primary evidence is one real retained smoke through the Web Chat surface.
Supporting checks are limited to existing focused contract/integration checks
affected by the durable migration, Team commands, transcript projection, and
browser boundary. No broad new test matrix is required before the real path.

Success evidence includes:

- one TeamRun reaches `succeeded` only after explicit completion request;
- at least two attempts exist for one WorkItem and old evidence is unchanged;
- Lead turns reuse one Lead RuntimeSession while retaining independent Tasks and
  Runs;
- member attempts reuse one member RuntimeSession while retaining independent
  Tasks and Runs;
- refresh reconstructs Project, Agent Sessions, attempts, transcripts, and final
  output;
- browser receives no credentials, prompts, provider/runtime IDs, or direct
  `/api/v1` access;
- desktop and mobile retain the existing Chat interaction model without overflow.

Legacy `collaborative` TeamRuns remain readable and keep their existing fixed
phase semantics. The migration is forward-only: it adds Agentic Team fields,
attempts, command receipts, and Task associations without rewriting historical
WorkItems or execution Tasks.

## Deferred

- multiple TeamRuns per Project and Project history;
- user intervention during an active TeamRun;
- dynamic roster, arbitrary Agent selection, and generated Agents;
- nested Teams and general DAG/workflow definitions;
- cross-TeamRun persistent Agent Sessions;
- Learning Proposal and Memory review UI;
- generalized retry policy, multi-node leadership, advanced cost accounting,
  broad search, and production authentication.
