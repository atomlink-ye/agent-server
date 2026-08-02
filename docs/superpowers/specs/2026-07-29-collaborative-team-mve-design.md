# Collaborative Team MVE Design

## Outcome

API-submitted published ManagedTeam with fixed lead plus two roster members, each with independent RuntimeSession/Cell, running real Paseo/OpenCode; lead dynamically creates WorkItems, teammates self-claim and execute in parallel, and a fresh task-scoped lead finalization run synthesizes completed work before the control plane finishes the root.

## Authority

- Oracle-approved TEAM1-min design (three rounds, final APPROVED).
- Master baseline: `0a7992b` (`Add control-plane team DAG MVE (#16)`).
- Existing DAG remains in-place; legacy path stays read-only/runnable until post-MVE cleanup.

## ManagedTeam YAML

```yaml
apiVersion: agent-server/v1alpha1
kind: ManagedTeam
metadata:
  name: research-team
spec:
  environmentVersionId: <published-environment-version-uuid>
  lead:
    name: lead
    agentVersionId: <published-agent-version-uuid>
  roster:
    - name: researcher
      agentVersionId: <published-agent-version-uuid>
    - name: critic
      agentVersionId: <published-agent-version-uuid>
  coordination:
    mode: collaborative
    taskAssignment: lead_or_self_claim
```

- Exactly one lead, two roster members with unique names.
- All agent version IDs must be published and in the authenticated owner scope.
- `environmentVersionId` must reference one published, owner-scoped EnvironmentVersion.
- Publish validates all references and creates immutable published TeamVersion.
- Package canonicalization and fingerprinting reuse existing Managed Agent patterns.

## TeamVersion coexistence

Internal discriminator `execution_mode`:

- `legacy_graph` — existing DAG/sequential records (read-only, writable only through internal path).
- `collaborative_mve` — new managed Collaborative Team, created only through public ManagedTeam API.

Exactly one mode per record; published `collaborative_mve` versions carry `collaboration_spec` (lead, roster, environment), never `graph`.

## Durable state (append-only migration)

```sql
ALTER TABLE team_versions ADD COLUMN execution_mode text NOT NULL DEFAULT 'legacy_graph' CHECK (execution_mode IN ('legacy_graph','collaborative_mve'));
ALTER TABLE team_versions ADD COLUMN collaboration_spec jsonb NULL;
-- constraint: collaborative_mve MUST have collaboration_spec; legacy_graph MUST have graph.

CREATE TABLE team_runs (id uuid PRIMARY KEY, root_task_id uuid NOT NULL UNIQUE, root_run_id uuid NOT NULL UNIQUE, team_version_id uuid NOT NULL, environment_version_id uuid NOT NULL, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','waiting','succeeded','failed')), phase text NOT NULL DEFAULT 'lead_kickoff' CHECK (phase IN ('lead_kickoff','member_work','lead_finalize','done')), final_text text NULL, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, UNIQUE(id,tenant_id,principal_type,principal_id));

CREATE TABLE team_member_runs (id uuid PRIMARY KEY, team_run_id uuid NOT NULL REFERENCES team_runs(id), name text NOT NULL, role text NOT NULL CHECK (role IN ('lead','member')), agent_version_id uuid NOT NULL, runtime_session_id uuid NULL, status text NOT NULL DEFAULT 'starting' CHECK (status IN ('starting','active','idle','stopped','failed')), current_work_item_id uuid NULL, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, UNIQUE(team_run_id,name), UNIQUE(id,team_run_id));

CREATE TABLE team_work_items (id uuid PRIMARY KEY, team_run_id uuid NOT NULL REFERENCES team_runs(id), subject text NOT NULL, description text NULL, status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','blocked','cancelled')), owner_member_id uuid NULL REFERENCES team_member_runs(id), created_by_member_id uuid NOT NULL REFERENCES team_member_runs(id), completion_summary text NULL, execution_task_id uuid NULL, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, completed_at timestamptz NULL);

ALTER TABLE runtime_sessions ALTER COLUMN scope_kind TYPE text;
ALTER TABLE runtime_sessions DROP CONSTRAINT IF EXISTS runtime_sessions_scope_kind_check;
ALTER TABLE runtime_sessions ADD CONSTRAINT runtime_sessions_scope_kind_check CHECK (scope_kind IN ('product_session','task','team_member'));
```

## Public API

### ManagedTeam registry

```
POST /api/v1/team-packages:validate         200  read-only
POST /api/v1/teams:import                   201  idempotent
GET  /api/v1/teams/{teamId}                 200  owner-scoped
GET  /api/v1/teams/{teamId}/versions        200  cursor pagination
GET  /api/v1/team-versions/{versionId}      200  owner-scoped
POST /api/v1/team-versions/{versionId}:publish 200  idempotent, immutable
```

Published TeamVersion resolves lead and roster AgentVersions plus EnvironmentVersion at publish time.

### TeamRun observation

```
GET /api/v1/tasks/{rootTaskId}/team-run     200|null  task→team-run link
GET /api/v1/team-runs/{id}                  200       summary
GET /api/v1/team-runs/{id}/members          200       member list
GET /api/v1/team-runs/{id}/tasks            200       work item list
```

All routes are authenticated, owner-scoped. Foreign resources return hidden not-found.

## Execution flow

```
Phase lead_kickoff:
  1. tasks:invoke(kind=team) → root Task/Run admitted
  2. Dispatcher claims root Run
  3. Create TeamRun(phase=lead_kickoff) + 3 TeamMemberRuns
  4. Create Lead kickoff Task/Run + dispatch
  5. Root Run → waiting_children, release lease/activation

Lead kickoff terminal → atomic transaction:
  A. Persist lead terminal state
  B. Create 2 member-bound generic initial Tasks/Runs
  C. Enqueue both dispatches
  D. TeamRun phase CAS lead_kickoff→member_work

Phase member_work:
  6. Each teammate turn is already running via ordinary ExecuteRun
  7. Member calls team_task_claim (atomically claims one pending WorkItem)
  8. Member performs work, calls team_task_update(status=completed)
  9. Member Run terminates

Second member terminal → atomic transaction:
  A. Persist member terminal state
  B. Check both required WorkItems completed
  C. Create lead-finalization Task/Run + dispatch
  D. TeamRun phase CAS member_work→lead_finalize

Phase lead_finalize:
  10. Lead finalization uses a fresh task-scoped RuntimeSession/provider Agent; the lead member's canonical session remains the kickoff team_member session
  11. Lead receives bounded WorkItem summaries and returns plain-text synthesis
  12. TeamPhaseCoordinator completes the TeamRun/root after the finalization Run succeeds with non-empty text

Lead finalization completion → atomic transaction:
  A. Validate finalization phase, successful lead finalization Run, and no pending/in-progress required WorkItems
  B. Set TeamRun status=succeeded, phase=done
  C. Finalize root waiting Run: status=succeeded, result text, output + succeeded events
  D. Complete root Task
  E. TeamRun phase CAS lead_finalize→done

`team_complete` remains a lead-only tool contract for compatibility, but root
completion in this MVE does not depend on the model invoking it.
```

## Team MCP tools

```
team_members_list
team_task_create(subject, description?)
team_task_list
team_task_claim(work_item_id) — atomic owner update
team_task_update(id, status, completion_summary?)
team_complete(final_text)
```

- All tools derive identity from authenticating RuntimeSession (teamRunId, memberRunId, role, tenant, principal, workspace).
- Only lead can invoke team_complete; members claim only their TeamRun's WorkItems.
- Owns same member cannot hold more than one in_progress WorkItem.
- Claim uses atomic PostgreSQL conditional update.

## Phase guard

TeamRun.phase and unique logical keys prevent duplicate fan-out:

```
Unique key: (team_run_id, member_id, phase)
```

## Non-goals

- Old DAG deletion (separate post-MVE gate).
- PROJECT1, agentctl, ResourceRef URIs, lockfiles.
- Skill API.
- Messages, room/DM, Paseo Chat projection, idle/wake.
- WorkItem dependencies.
- Plan approval, artifacts.
- Retries, recovery, reconciliation, dynamic roster.
- New test suites beyond real smoke.

## Human Gates

- Six new public Team registry routes and TeamRun reads.
- Append-only durable schema (team_runs, member_runs, work_items, runtime_session scope_kind).
- Tenant+principal definition ownership versus authenticated workspace execution scope.
- Collaborative TeamVersion semantics alongside legacy DAG.

## Smoke

`pnpm smoke:collaborative-team` — real HTTP→Agent Server→Paseo→OpenCode/free model:

- 3 Agents + 1 Environment + 1 Team via public API import/publish.
- tasks:invoke(kind=team) creates TeamRun.
- Lead kickoff creates 2 WorkItems dynamically.
- Both members execute in parallel (observed overlapping lifecycle intervals).
- Four distinct runtime executions: one lead kickoff team_member session, two member team_member sessions, and one fresh task-scoped lead finalization provider Agent.
- Finalization Run succeeds with non-empty synthesis text.
- Control-plane completion succeeds root; output/succeeded events present.
- Task tree shows member execution lineage.
- Foreign-owner read returns hidden not-found.
