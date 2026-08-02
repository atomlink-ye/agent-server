# Agentic Team Chat MVE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed Collaborative Team sequence with one bounded Lead-directed rework loop and expose the Lead/member execution history through the existing Web Chat surface.

**Architecture:** Add an `agentic_mve` Team execution mode beside the legacy fixed mode. The Lead emits narrow semantic commands, while PostgreSQL-backed Team state, WorkItemAttempts, command receipts, canonical Tasks/Runs, and the coordinator control scheduling and recovery. Web projects each `TeamMemberRun` as one read-only Agent Session and reuses the existing Chat transcript/Event projection.

**Tech Stack:** TypeScript, Node.js, Hono, PostgreSQL 16, Next.js/React, Zod, Paseo/OpenCode, Docker Compose.

**Validation policy:** Repository instructions prohibit proactively creating a broad new test matrix during the Prove stage. The primary gate is the real retained Agentic Team Chat smoke. Update existing assertions only where the forward migration or public contract requires it, then run the narrowest existing checks that cover touched boundaries.

---

## File Structure

### Create

- `src/infrastructure/postgres/migrations/0023_agentic_team_chat_mve.sql` — forward-only Agentic Team schema.
- `src/domain/teams/team-work-item-attempt.ts` — immutable semantic dispatch attempt.
- `src/application/teams/agentic-team-executor.ts` — bounded Lead/member scheduling loop.
- `apps/web/lib/agentic-team-bff.ts` — owner-checked Project and Agent Session projection.
- `apps/web/app/api/team-project/runs/route.ts` — fixed Team launch.
- `apps/web/app/api/team-project/route.ts` — refresh-safe Project discovery.
- `apps/web/app/api/team-project/sessions/[team_member_run_id]/route.ts` — one Agent Session transcript.
- `apps/web/app/api/team-project/sessions/[team_member_run_id]/runs/[run_id]/events/route.ts` — historical Event replay.
- `apps/web/app/api/team-project/runs/[run_id]/events/route.ts` — live owner-checked Event stream.
- `scripts/smoke/agentic-team-chat-main-flow.mjs` — real rework and browser-refresh smoke.

### Modify

- `src/domain/teams/team-run.ts` — execution mode, control state, revision, limits, completion intent.
- `src/domain/teams/team-work-item.ts` — Agentic `open|accepted` semantics while preserving legacy statuses.
- `src/domain/tasks/task.ts` — optional explicit Team member/sequence/kind association.
- `src/contracts/teams.ts` — Agentic TeamVersion/TeamRun/WorkItemAttempt response contracts.
- `src/application/ports/team-execution-repository.ts` — command, attempt, scheduling, and transcript queries.
- `src/infrastructure/postgres/postgres-collaborative-team-repository.ts` — implement new durable operations without rewriting legacy rows.
- `src/application/teams/team-tools.ts` — Lead semantic command handlers and member attempt completion.
- `src/application/teams/team-phase-coordinator.ts` — dispatch legacy vs Agentic executor.
- `src/application/runs/execute-run.ts` — reuse member RuntimeSessions for every Agentic Lead/member Task.
- `src/application/managed-registry/managed-team-package.ts` — accept `agentic_mve` package execution mode.
- `src/entrypoints/api/routes/team-runs.ts` — expose Agentic state and attempts.
- `src/entrypoints/api/server.ts` — construct and inject Agentic executor/BFF dependencies.
- `templates/self-learning-market-research/team-project.yaml` — select Agentic execution mode and fixed limits.
- `templates/self-learning-market-research/agents/lead.yaml` — quality criteria and semantic command usage, not fixed topology.
- `templates/self-learning-market-research/agents/opportunity-analyst.yaml` — first-turn fixture behavior that leaves one evidence gap, then responds to focused feedback.
- `apps/web/app/page.tsx` — one selection union for ProductSession and Team Agent Session.
- `apps/web/components/chat/conversation-sidebar.tsx` — grouped Project and Chat sections.
- `apps/web/components/chat/activity-panel.tsx` — compact Team links inside Lead transcript.
- `apps/web/lib/agent-server-client.ts` — Team project/session/Event client functions.
- `apps/web/app/globals.css` — Project hierarchy and read-only Team session states.
- `package.json`, `Makefile` — canonical Agentic Team Chat smoke command.
- `docs/features.md`, `docs/components.md`, `docs/contracts/agent-team-api.md`, `docs/contracts/self-learning-web-api.md`, `docs/operations/local-development.md` — capability and operating truth.
- Existing migration-list assertions in `tests/integration/agent-registry-postgres.integration.test.ts` and `tests/integration/durable-kernel-postgres.integration.test.ts` — include `0023_agentic_team_chat_mve` only.

### Remove after replacement smoke passes

- `apps/web/app/projects/page.tsx`
- `apps/web/components/projects/project-lab.tsx`
- Project Lab-only API routes under `apps/web/app/api/projects/self-learning/`

Do not remove `apps/web/lib/self-learning-bff.ts` until the new real Web path has passed; then delete only code with no remaining API consumer.

---

### Task 1: Add the forward-only Agentic Team schema and domain contracts

**Files:**

- Create: `src/infrastructure/postgres/migrations/0023_agentic_team_chat_mve.sql`
- Create: `src/domain/teams/team-work-item-attempt.ts`
- Modify: `src/domain/teams/team-run.ts`
- Modify: `src/domain/teams/team-work-item.ts`
- Modify: `src/domain/tasks/task.ts`
- Modify: `src/contracts/teams.ts`
- Modify: `src/application/managed-registry/managed-team-package.ts`
- Modify: `tests/integration/agent-registry-postgres.integration.test.ts`
- Modify: `tests/integration/durable-kernel-postgres.integration.test.ts`

- [ ] **Step 1: Add migration `0023_agentic_team_chat_mve`**

Use a forward-only migration that preserves `collaborative_mve` rows:

```sql
BEGIN;

ALTER TABLE team_versions DROP CONSTRAINT team_versions_execution_mode_check;
ALTER TABLE team_versions ADD CONSTRAINT team_versions_execution_mode_check
  CHECK (execution_mode IN ('legacy_graph','collaborative_mve','agentic_mve'));
ALTER TABLE team_versions DROP CONSTRAINT team_versions_execution_shape_check;
ALTER TABLE team_versions ADD CONSTRAINT team_versions_execution_shape_check CHECK (
  (execution_mode = 'legacy_graph' AND graph IS NOT NULL AND collaboration_spec IS NULL)
  OR (execution_mode IN ('collaborative_mve','agentic_mve') AND graph IS NULL AND collaboration_spec IS NOT NULL)
);

ALTER TABLE team_runs
  ADD COLUMN execution_mode text NOT NULL DEFAULT 'collaborative_mve',
  ADD COLUMN control_state text NULL,
  ADD COLUMN revision integer NOT NULL DEFAULT 0,
  ADD COLUMN lead_turn_count integer NOT NULL DEFAULT 0,
  ADD COLUMN stop_reason text NULL,
  ADD COLUMN completion_requested_by_run_id uuid NULL;

ALTER TABLE team_runs ADD CONSTRAINT team_runs_control_state_check CHECK (
  control_state IS NULL OR control_state IN ('lead_ready','lead_running','member_work_running','terminal')
);

ALTER TABLE team_work_items DROP CONSTRAINT team_work_items_status_check;
ALTER TABLE team_work_items ADD CONSTRAINT team_work_items_status_check CHECK (
  status IN ('pending','in_progress','completed','blocked','cancelled','open','accepted')
);

CREATE TABLE team_work_item_attempts (
  id uuid PRIMARY KEY,
  work_item_id uuid NOT NULL REFERENCES team_work_items(id),
  team_run_id uuid NOT NULL REFERENCES team_runs(id),
  attempt_no integer NOT NULL CHECK (attempt_no > 0),
  assignee_member_id uuid NOT NULL REFERENCES team_member_runs(id),
  requested_by_lead_task_id uuid NOT NULL REFERENCES tasks(id),
  feedback text NULL,
  execution_task_id uuid NULL REFERENCES tasks(id),
  status text NOT NULL CHECK (status IN ('queued','running','completed','failed')),
  result_summary text NULL,
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  principal_type text NOT NULL,
  principal_id text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz NULL,
  UNIQUE (work_item_id, attempt_no),
  UNIQUE (execution_task_id)
);

ALTER TABLE tasks
  ADD COLUMN team_member_run_id uuid NULL REFERENCES team_member_runs(id),
  ADD COLUMN team_sequence integer NULL,
  ADD COLUMN team_task_kind text NULL,
  ADD CONSTRAINT tasks_team_task_kind_check
    CHECK (team_task_kind IS NULL OR team_task_kind IN ('lead_turn','work_attempt'));

CREATE TABLE team_command_receipts (
  source_run_id uuid NOT NULL REFERENCES runs(id),
  command_hash text NOT NULL,
  command_name text NOT NULL,
  result_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (source_run_id, command_hash)
);

COMMIT;
```

- [ ] **Step 2: Define exact Agentic domain types**

Add these shapes without removing legacy phase functions:

```ts
export type TeamExecutionMode = 'collaborative_mve' | 'agentic_mve';
export type AgenticTeamControlState =
  'lead_ready' | 'lead_running' | 'member_work_running' | 'terminal';

export interface TeamWorkItemAttempt {
  readonly id: string;
  readonly workItemId: string;
  readonly teamRunId: string;
  readonly attemptNo: number;
  readonly assigneeMemberId: string;
  readonly requestedByLeadTaskId: string;
  readonly feedback: string | null;
  readonly executionTaskId: string | null;
  readonly status: 'queued' | 'running' | 'completed' | 'failed';
  readonly resultSummary: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}
```

Extend `TeamRun` with `executionMode`, nullable `controlState`, `revision`, `leadTurnCount`, `stopReason`, and `completionRequestedByRunId`. Extend `Task` with nullable `teamMemberRunId`, `teamSequence`, and `teamTaskKind`.

- [ ] **Step 3: Add Agentic transition helpers**

Keep the state transitions narrow:

```ts
export function transitionAgenticControlState(
  run: TeamRun,
  expectedRevision: number,
  to: AgenticTeamControlState,
): TeamRun {
  if (run.executionMode !== 'agentic_mve')
    throw new Error('Not an agentic team run.');
  if (run.revision !== expectedRevision)
    throw new Error('Team run revision conflict.');
  return Object.freeze({
    ...run,
    controlState: to,
    revision: run.revision + 1,
  });
}
```

Do not introduce dynamic roster, arbitrary transitions, or generic workflow nodes.

- [ ] **Step 4: Extend Zod/public schemas compatibly**

Add `agentic_mve` to TeamVersion execution mode. Make Agentic fields nullable for legacy responses and add a WorkItemAttempt response schema. Do not expose RuntimeSession IDs through the new Web projection.

- [ ] **Step 5: Update only existing migration-list expectations**

Append `0023_agentic_team_chat_mve` to the three current expected migration lists. Do not add new tests in this task.

- [ ] **Step 6: Run the narrow schema checks**

Run:

```bash
make test-real-pg
```

Expected: existing real-Postgres suite completes with zero failures and migration `0023_agentic_team_chat_mve` is applied.

- [ ] **Step 7: Commit**

```bash
git add src/infrastructure/postgres/migrations/0023_agentic_team_chat_mve.sql \
  src/domain/teams src/domain/tasks/task.ts src/contracts/teams.ts \
  src/application/managed-registry/managed-team-package.ts \
  tests/integration/agent-registry-postgres.integration.test.ts \
  tests/integration/durable-kernel-postgres.integration.test.ts
git commit -m "Add agentic Team durable model"
```

### Task 2: Implement semantic Team commands and durable attempts

**Files:**

- Modify: `src/application/ports/team-execution-repository.ts`
- Modify: `src/infrastructure/postgres/postgres-collaborative-team-repository.ts`
- Modify: `src/application/teams/team-tools.ts`
- Modify: Team MCP registration/schema files found beside existing `team_task_*` registrations

- [ ] **Step 1: Add repository command input types**

Define owner-scoped atomic methods:

```ts
createAssignedWork(input: {
  teamRunId: string;
  sourceRunId: string;
  leadTaskId: string;
  assigneeMemberId: string;
  subject: string;
  description: string | null;
  commandHash: string;
  expectedRevision: number;
  owner: OwnerScope;
}): Promise<{ item: TeamWorkItem; attempt: TeamWorkItemAttempt }>;

acceptWork(input: { teamRunId: string; workItemId: string; sourceRunId: string; commandHash: string; expectedRevision: number; owner: OwnerScope }): Promise<TeamWorkItem>;

requestRework(input: { teamRunId: string; workItemId: string; assigneeMemberId: string; feedback: string; sourceRunId: string; leadTaskId: string; commandHash: string; expectedRevision: number; owner: OwnerScope }): Promise<TeamWorkItemAttempt>;

requestCompletion(input: { teamRunId: string; sourceRunId: string; commandHash: string; expectedRevision: number; owner: OwnerScope }): Promise<{ requested: true }>;
```

- [ ] **Step 2: Implement command receipt idempotency**

Normalize command JSON with stable key ordering, hash it with SHA-256, and return `result_json` when `(source_run_id, command_hash)` already exists. Perform receipt insert, Team revision CAS, WorkItem/Attempt mutation, and control-state update in one transaction.

- [ ] **Step 3: Replace Lead raw-status tools for Agentic mode**

Register only these mutating Lead tools in Agentic turns:

```text
team_work_create_and_assign
team_work_accept
team_work_request_rework
team_completion_request
```

Keep legacy `team_task_*` behavior for `collaborative_mve`. Validate that the assignee belongs to the same fixed TeamRun roster and that only the active Lead Run can issue commands.

- [ ] **Step 4: Add member completion semantics**

Members may complete only their current attempt. Store `result_summary`, mark the attempt `completed`, and leave the WorkItem `open` until the Lead accepts it. A failed member Run marks the attempt `failed` and returns control to the Lead.

- [ ] **Step 5: Run existing focused Team checks**

Run:

```bash
make test-integration
```

Expected: existing integration suite passes; legacy Collaborative Team behavior remains unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/application/ports/team-execution-repository.ts \
  src/infrastructure/postgres/postgres-collaborative-team-repository.ts \
  src/application/teams/team-tools.ts src/entrypoints
git commit -m "Add agentic Team commands"
```

### Task 3: Build the bounded Agentic turn scheduler

**Files:**

- Create: `src/application/teams/agentic-team-executor.ts`
- Modify: `src/application/teams/team-phase-coordinator.ts`
- Modify: `src/application/runs/execute-run.ts`
- Modify: `src/entrypoints/api/server.ts`

- [ ] **Step 1: Route Team completions by execution mode**

Keep the current `CollaborativeTeamExecutor` untouched for legacy runs. Add:

```ts
if (team.executionMode === 'agentic_mve') {
  await this.agentic.handleTerminalRun({
    team,
    task: input.task,
    run: input.run,
  });
  return;
}
```

- [ ] **Step 2: Implement `lead_ready -> lead_running`**

`AgenticTeamExecutor.scheduleLeadTurn()` must:

1. lock/CAS the TeamRun revision;
2. reject scheduling if another Lead Task is active;
3. stop as failed when `leadTurnCount >= 4`;
4. create a Lead child Task with explicit `teamMemberRunId`, incremented `teamSequence`, `teamTaskKind='lead_turn'`, and logical key `lead:<teamRunId>:turn:<n>`;
5. create/admit its Run;
6. update `leadTurnCount` and `controlState='lead_running'`.

- [ ] **Step 3: Build the bounded Lead snapshot**

Construct Lead input from durable state only:

```ts
{
  goal,
  members: [{ member_id, name, role }],
  work_items: [{ id, subject, status, attempts: [{ attempt_no, assignee, status, result_summary, feedback }] }],
  limits: { max_lead_turns: 4, max_work_items: 4, max_attempts_per_item: 2 },
  allowed_commands: ['create_and_assign', 'accept', 'request_rework', 'request_completion']
}
```

The prompt must ask the Lead to inspect evidence and choose commands; it must not prescribe the number or sequence of member tasks.

- [ ] **Step 4: Materialize queued attempts**

For each queued attempt without `executionTaskId`, atomically create one member Task/Run with:

```text
logical_step_key = member:<teamRunId>:work:<workItemId>:attempt:<attemptNo>
team_member_run_id = assigneeMemberId
team_sequence = next Team sequence
team_task_kind = work_attempt
```

Bind the Task ID back to the attempt and change it to `running`. Never create two Tasks for one attempt.

- [ ] **Step 5: Resume the Lead after member work settles**

When no queued/running attempt remains, set `controlState='lead_ready'` and schedule another Lead turn. Reuse the Lead TeamMemberRun RuntimeSession; each Lead turn still has an independent Task/Run/Event history.

- [ ] **Step 6: Complete only after the requesting Lead Run succeeds**

On successful Lead Run:

```ts
if (team.completionRequestedByRunId === run.id) {
  assertNoActiveAttempts();
  assertAllWorkAccepted();
  const finalText = normalizeTeamRunFinalText(run.resultText ?? '');
  await repo.completeTeamRunAtomically(...);
}
```

If commands created queued attempts, materialize them. If neither completion nor durable progress occurred, schedule no more than the remaining Lead turn allowance; on exhaustion, fail with `lead_turn_limit`.

- [ ] **Step 7: Reuse Team member RuntimeSessions**

In `execute-run.ts`, select `createOrGetForTeamMember` for both `lead_turn` and `work_attempt` Tasks. Never expose the internal RuntimeSession ID to the Web API.

- [ ] **Step 8: Run existing focused checks and typecheck**

Run:

```bash
make check
make test-integration
```

Expected: zero type/lint failures and existing integration suite passes.

- [ ] **Step 9: Commit**

```bash
git add src/application/teams src/application/runs/execute-run.ts src/entrypoints/api/server.ts
git commit -m "Run bounded agentic Team turns"
```

### Task 4: Make the self-learning fixture prove autonomous rework

**Files:**

- Modify: `templates/self-learning-market-research/team-project.yaml`
- Modify: `templates/self-learning-market-research/teams/market-research.yaml`
- Modify: `templates/self-learning-market-research/agents/lead.yaml`
- Modify: `templates/self-learning-market-research/agents/opportunity-analyst.yaml`
- Create: `scripts/smoke/agentic-team-chat-main-flow.mjs`
- Modify: `package.json`
- Modify: `Makefile`

- [ ] **Step 1: Select `agentic_mve` with fixed roster and limits**

Keep one Lead and two members. Add only fixed limits and execution mode; do not encode a task graph.

- [ ] **Step 2: Give the Lead a quality rubric, not a topology**

Require the final evidence to contain the fixture timestamp, at least one snapshot fact, at least one event fact, and one analog/risk comparison. Tell the Lead to inspect member results and use rework when a required category is absent. Do not say “create exactly two tasks” or “always rework analyst.”

- [ ] **Step 3: Make the first analyst result observably insufficient**

Use a fixture-controlled first attempt that returns snapshot evidence but omits event evidence. On a second attempt containing Lead feedback, allow the analyst to call `synthetic_event_batch` and return the missing category. The decision to request rework must still come from the Lead's rubric evaluation.

- [ ] **Step 4: Implement the API-level smoke before Web polish**

The smoke must provision the Project, launch the Agentic Team, and assert:

```text
TeamRun succeeded/terminal
Lead turns >= 2
one WorkItem has attempts 1 and 2
attempt 1 result remains unchanged
attempt 2 has a different Task and Run
one rework command receipt exists
all WorkItems are accepted
Lead/member Tasks bind to explicit TeamMemberRun IDs
Lead and analyst each reuse one internal RuntimeSession
final report contains all rubric evidence
```

- [ ] **Step 5: Register the canonical command**

```json
"smoke:agentic-team-chat": "node scripts/smoke/agentic-team-chat-main-flow.mjs"
```

```make
agentic-team-chat-smoke:
	PASEO_MODEL="$${PASEO_MODEL:-opencode/deepseek-v4-flash-free}" ./scripts/dev/docker-run --postgres --pass-env PASEO_MODEL --pass-env OPENCODE_GO_API_KEY --pass-env AGENTIC_TEAM_SMOKE_RETAIN_FILE -- pnpm smoke:agentic-team-chat
```

- [ ] **Step 6: Run the real API smoke immediately**

Run:

```bash
make agentic-team-chat-smoke
```

Expected: one real Lead-driven rework loop passes. Fix only blockers that prevent or falsify this main path.

- [ ] **Step 7: Commit**

```bash
git add templates/self-learning-market-research scripts/smoke/agentic-team-chat-main-flow.mjs package.json Makefile
git commit -m "Prove agentic Team rework flow"
```

### Task 5: Add the Project and Agent Session BFF projection

**Files:**

- Create: `apps/web/lib/agentic-team-bff.ts`
- Create: `apps/web/app/api/team-project/runs/route.ts`
- Create: `apps/web/app/api/team-project/route.ts`
- Create: `apps/web/app/api/team-project/sessions/[team_member_run_id]/route.ts`
- Create: `apps/web/app/api/team-project/sessions/[team_member_run_id]/runs/[run_id]/events/route.ts`
- Create: `apps/web/app/api/team-project/runs/[run_id]/events/route.ts`
- Modify: `apps/web/lib/agent-server-client.ts`

- [ ] **Step 1: Define safe Web projection types**

```ts
export interface TeamProjectProjection {
  readonly root_task_id: string;
  readonly team_run_id: string;
  readonly name: string;
  readonly status: 'working' | 'completed' | 'failed';
  readonly sessions: readonly {
    agent_session_id: string;
    name: string;
    role: 'lead' | 'member';
    status: 'queued' | 'running' | 'completed' | 'failed';
    latest_summary: string | null;
  }[];
}

export interface TeamAgentSessionProjection {
  readonly agent_session_id: string;
  readonly team_run_id: string;
  readonly name: string;
  readonly role: 'lead' | 'member';
  readonly read_only: true;
  readonly turns: readonly {
    task_id: string;
    run_id: string;
    sequence: number;
    context: string;
    result_text: string | null;
    status: 'queued' | 'running' | 'completed' | 'failed';
  }[];
}
```

- [ ] **Step 2: Add fixed launch and refresh discovery**

`POST /api/team-project/runs` invokes only the server-configured TeamVersion, Workspace, Environment, and fixture. `GET /api/team-project?task=<rootTaskId>` accepts only an owner-checked root created by this entry point; without a task query it returns the latest owner-scoped Agentic TeamRun.

- [ ] **Step 3: Project one TeamMemberRun as one transcript**

Query Tasks by explicit `team_member_run_id`, order by `team_sequence`, obtain each latest Run, and expose assignment/feedback as `context`. Use current Run Event APIs for rich historical projection; do not synthesize ProductSession messages or expose RuntimeSession IDs.

- [ ] **Step 4: Reuse current Event replay and SSE policy**

Authorize a Run by owner plus membership in the selected TeamMemberRun. Proxy the same safe Event schemas used by normal Chat. Reject runs outside the Project even if their UUID is valid.

- [ ] **Step 5: Run Web typecheck**

Run:

```bash
make web-check-types
```

Expected: zero TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib apps/web/app/api/team-project
git commit -m "Project Team runs as agent sessions"
```

### Task 6: Integrate Project Agent Sessions into Web Chat

**Files:**

- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/components/chat/conversation-sidebar.tsx`
- Modify: `apps/web/components/chat/activity-panel.tsx`
- Modify: `apps/web/app/globals.css`

- [ ] **Step 1: Add a discriminated Chat selection**

```ts
type ChatSelection =
  | { kind: 'product_session'; sessionId: string }
  | { kind: 'team_agent_session'; teamRunId: string; memberRunId: string };
```

Keep all ProductSession behavior unchanged. Team Agent Sessions load from the new BFF and never call ProductSession message endpoints.

- [ ] **Step 2: Group the existing sidebar**

Render `Project` first with one row per Lead/member session, then the existing `Chats` list. Project click selects the Lead. Do not add nested attempt rows, a second app shell, or a dashboard.

- [ ] **Step 3: Reuse the current transcript renderer**

Map Team Agent Session turns into the current turn projection and load each Run's Events through the existing stream reducer. Show assignment/feedback as a compact context message and assistant result/activity as normal Chat content.

- [ ] **Step 4: Make Team Agent Sessions explicitly read-only**

Hide the composer for Team selection and display one restrained line: `This Agent Session is read-only.` Keep normal ProductSession composer behavior unchanged.

- [ ] **Step 5: Link compact Lead activity to member sessions**

In Lead transcript Team activity rows, route member selections through the same sidebar selection state. Keep details compact; do not restore Project Lab's People/WorkItems/Report dashboard.

- [ ] **Step 6: Preserve mobile behavior**

Reuse the existing sidebar drawer. Selecting a Team Agent Session closes the drawer; status labels and indentation must not introduce horizontal overflow.

- [ ] **Step 7: Run focused Web checks**

Run:

```bash
make web-check-types
make web-build
```

Expected: typecheck and production build pass.

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/page.tsx apps/web/components/chat apps/web/app/globals.css
git commit -m "Show Team agent sessions in Web Chat"
```

### Task 7: Prove the full Web path, then retire Project Lab

**Files:**

- Modify: `scripts/smoke/agentic-team-chat-main-flow.mjs`
- Remove after pass: `apps/web/app/projects/page.tsx`
- Remove after pass: `apps/web/components/projects/project-lab.tsx`
- Remove after pass: `apps/web/app/api/projects/self-learning/**`
- Remove if no consumer remains: `apps/web/lib/self-learning-bff.ts`

- [ ] **Step 1: Extend retained smoke through the browser-facing BFF**

Start Next Web with fixed server-side Team configuration, call `POST /api/team-project/runs`, and wait through Project/session APIs until the rework loop and final report are visible.

- [ ] **Step 2: Verify desktop, refresh, and mobile main flow**

Use Playwright only as a retained main-flow check, not as a broad new deterministic suite. Verify:

```text
Project contains exactly three Agent Sessions
Lead transcript shows at least two Lead turns
analyst transcript shows two attempt turns and rework feedback
final Team status is completed
refresh reconstructs the same selected session and transcript from server state
mobile page has zero horizontal overflow
browser storage/cookies contain no service credential
browser makes no direct /api/v1 request
```

- [ ] **Step 3: Remove the standalone Project Lab only after Step 2 passes**

Delete the route, component, and Project Lab-only APIs. Keep backend Learning Proposal/Memory APIs intact. Confirm no remaining imports reference deleted files.

- [ ] **Step 4: Re-run the retained real smoke**

Run:

```bash
AGENTIC_TEAM_SMOKE_RETAIN_FILE=.local/agentic-team-chat-retain.json make agentic-team-chat-smoke
```

Expected final JSON contains `status=passed`, `root_task_id`, `team_run_id`, Agent Session IDs, reworked WorkItem/attempt IDs, final report SHA, and retained Web URL. Keep values sanitized.

- [ ] **Step 5: Commit**

```bash
git add scripts/smoke/agentic-team-chat-main-flow.mjs apps/web
git commit -m "Replace Project Lab with Team chat"
```

### Task 8: Align documentation and run proportionate completion checks

**Files:**

- Modify: `docs/features.md`
- Modify: `docs/components.md`
- Modify: `docs/contracts/agent-team-api.md`
- Modify: `docs/contracts/self-learning-web-api.md`
- Modify: `docs/operations/local-development.md`
- Create: `docs/evidence/agentic-team-chat-mve-evidence.md`

- [ ] **Step 1: Update capability truth**

Document Agentic fixed-roster autonomy, WorkItemAttempt semantics, completion intent timing, Project-as-BFF projection, read-only Agent Sessions, limits, and all deferred features. Remove claims that Project Lab is the primary Web surface.

- [ ] **Step 2: Record sanitized real evidence**

Capture command, model identifier, root/Team/session/attempt IDs, statuses, report SHA, browser checks, and limitations. Never include tokens, credentials, prompts, raw provider payloads, or local absolute paths.

- [ ] **Step 3: Run the narrowest meaningful supporting checks**

Run:

```bash
make test-real-pg
make test-integration
make web-check-types
make web-build
```

Run `make ci` only if focused checks expose cross-boundary uncertainty or before a requested PR merge. The real retained smoke remains the primary acceptance evidence.

- [ ] **Step 4: Inspect scope and secrets**

Run:

```bash
git diff --check
git status --short
git diff --stat origin/master...HEAD
```

Inspect changed files for TODOs, skipped checks, debug output, secrets, credentials, raw provider errors, and generated artifacts.

- [ ] **Step 5: Commit**

```bash
git add docs
git commit -m "Document agentic Team chat MVE"
```

- [ ] **Step 6: Final acceptance review**

Compare every design requirement in `docs/superpowers/specs/2026-08-02-agentic-team-chat-design.md` against the real smoke evidence. Classify non-blocking findings as deferred rather than expanding the MVE.

---

## Execution Order and Ownership

1. Tasks 1–3 are one backend/durable-state lane and must remain sequential.
2. Task 4 depends on Tasks 1–3 and proves the architecture before Web work.
3. Task 5 begins only after the API smoke proves rework.
4. Task 6 is a Designer-owned UI implementation lane after Task 5's projection is stable.
5. Task 7 integrates and removes Project Lab only after replacement evidence passes.
6. Task 8 closes documentation and supporting checks.

Use one implementation worker per dependency lane and reuse its session for fix rounds. Do not run overlapping writers against `apps/web` or the Team domain/repository files.
