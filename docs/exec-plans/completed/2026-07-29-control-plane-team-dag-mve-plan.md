---
status: completed
owner: gpt-5.6-sol
created_at: 2026-07-29
updated_at: 2026-07-29
authority: execution-plan
---

# Control-plane Team DAG MVE implementation plan

## Outcome

Deliver the approved `MVE-TEAM1` vertical slice from `origin/master` at
`7bacdcfc39a07549dd5b59b1127e76474cd54cbd`: a published `dag-mve-v1`
TeamVersion pins one published EnvironmentVersion, starts independent
`research-a` and `research-b` child Tasks/Runs through the ordinary dispatcher,
waits durably, then starts one `synthesize` child after both succeed. The root
Run exposes `waiting_children`, releases its claim, and receives the final
result. `sequential-mvp-v1` remains compatible. This plan excludes
`MVE-LONG1` restart/resume.

## Context and authority

- Approved design: `docs/exec-plans/completed/2026-07-29-control-plane-team-dag-mve-spec.md`.
- Required protocol: `docs/agents/exec-plan-protocol.md`.
- Repository authority: `AGENTS.md`, `docs/product.md`, `docs/features.md`,
  `docs/components.md`, `docs/contracts.md`, current code, and the approved
  spec in that order after the explicit user approval.
- Existing team entry points are `src/application/tasks/execute-team-task.ts`
  (`ExecuteTeamTask`), `src/application/invokables/sequential-team-compiler.ts`
  (`SequentialTeamCompiler`), `src/domain/invokables/team-graph.ts`,
  `src/domain/invokables/team-version.ts`, and
  `src/application/runs/execute-run.ts` (`ExecuteRun`).
- No new tests, fixtures, or evals are in scope. Production documentation is
  in scope after real evidence exists; existing checks may be run only after
  the real smoke.

## Scope

### Prerequisite P1/P2 corrections

1. In the existing managed launch path (`SessionLaunchSnapshot` creation and
   AgentVersion resolution used by `ExecuteRun`), separate ProductWorkspace
   ownership from the service-account registry workspace scope. A workspace
   created through the public Workspace API must launch its managed Agent while
   preserving owner isolation and tenant/principal-scoped managed lookup; do
   not weaken lookup to tenant-only and do not introduce legacy fallback for a
   draft managed row.
2. Replace unbounded `c.req.json()` in the Environment write routes with the
   repository's existing bounded JSON ingress helper/pattern. This is a
   transport correction only and must not broaden Environment semantics.

### Domain/compiler

3. Add an opt-in DAG model beside, not inside, the sequential model in
   `src/domain/invokables/team-graph.ts`, `team-version.ts`, and
   `compiled-team-plan.ts`. Model invoke-only nodes, `dependsOn`, one output,
   one Team-level EnvironmentVersion, and graph mode `dag-mve-v1`.
4. Add a DAG compiler adjacent to
   `src/application/invokables/sequential-team-compiler.ts` (for example
   `src/application/invokables/dag-team-compiler.ts`, symbol
   `DagTeamCompiler`). Validate duplicate/missing references, cycles,
   unreachable nodes, unsupported kinds, multiple outputs, and all-success
   eligibility at publish/compile time. Resolve exact AgentVersion, Skill
   `{ref,digest}` facts, Tool refs, and the pinned EnvironmentVersion into the
   immutable compiled snapshot. Preserve `SequentialTeamCompiler` and its
   published behavior unchanged.

### Schema/repositories

5. Add one ordered migration after `0018_managed_environment_runtime_session_mve.sql`
   (the next migration is `0019_team_dag_mve.sql`) for durable
   `team_executions` and `team_node_executions`, including tenant/owner scope,
   root Task/Run identity, TeamVersion and EnvironmentVersion identity,
   node/child identity, dependency state, result text, timestamps, and the
   states `running|waiting_children|succeeded|failed` and
   `pending|queued|running|succeeded|failed|blocked`. Use constraints and
   unique keys to enforce one activation per root and at most one child per
   node.
6. Add domain/application ports and PostgreSQL implementations next to
   `src/application/ports/task-repository.ts`, `run-repository.ts`, and
   `src/infrastructure/postgres/postgres-task-repository.ts`,
   `postgres-run-repository.ts` (for example
   `TeamExecutionRepository`/`TeamNodeExecutionRepository` and
   `PostgresTeamExecutionRepository`). Repository methods must make root
   activation, child creation, child result recording, and finalization
   transactional and owner-scoped; use row locks/unique constraints for
   duplicate advancement races.
7. Extend `src/domain/runs/run-status.ts`, `src/domain/runs/run.ts`,
   `src/contracts/runs.ts`, and Task tree/read mapping to expose public
   `waiting_children` without changing direct `/api/v1/runs` compatibility.

### Waiting root/advancement

8. Replace the inline sequential-only Team behavior in
   `src/application/tasks/execute-team-task.ts` with a durable DAG activation:
   claim the root, create `TeamExecution` plus all ready child Tasks/Runs,
   transition the root to `waiting_children`, clear lease and activation, and
   return from the worker stack. The coordinator never claims a child inline
   and never calls `AgentRuntimePort` directly.
9. Add a small advancement service (for example
   `src/application/tasks/advance-team-execution.ts`, symbol
   `AdvanceTeamExecution`) called by child completion. In one transaction,
   record the child result, make downstream nodes eligible only when all
   dependencies succeeded, create `synthesize` exactly once, and keep the root
   waiting. On any child failure, mark unstarted downstream nodes `blocked` and
   fail TeamExecution, root Run, and root Task without retry.
10. Keep handoff bounded and explicit: each child result is at most 32 KiB
    UTF-8 and the combined synthesizer input is at most 64 KiB. On overflow,
    fail explicitly; never truncate. Pass only root brief, source node IDs,
    child Task/Run IDs, and successful result text. Do not scan sibling cells or
    pass conversation history.

### Task-scoped runtime

11. Extend the RuntimeSession scope union in the existing runtime-session
    domain/contracts/repository path from `product_session` to `task`.
    `ExecuteRun`, `PostgresRuntimeSessionRepository`,
    `src/application/ports/runtime-session-repository.ts`, and the managed
    launch snapshot path must create one immutable snapshot, RuntimeSession,
    derived RuntimeCell, Paseo Workspace, and provider Agent per child Task.
    Siblings must have distinct runtime objects while sharing only the
    immutable Team EnvironmentVersion.
12. Reuse the ordinary `ExecuteRun` launch/result path and its existing
    `AgentRuntimePort`; no Team-wide provider session, Team-wide Paseo Agent,
    prompt-only coordination, or runtime bypass is permitted. Preserve
    normalized errors and evidence redaction.

### Dispatcher

13. Extend `src/infrastructure/postgres/postgres-run-dispatcher.ts`
    (`PostgresRunDispatcher`) and bootstrap wiring in `src/bootstrap.ts` so the
    in-process dispatcher has at least two worker slots. PostgreSQL claim/fence
    remains authoritative per Run; queued child Runs must be independently
    claimable and concurrent, while root waiting state is not repeatedly
    redispatched.

### Smoke

14. Add the production smoke command wiring for `pnpm smoke:team-dag` and its
    script under `scripts/smoke/` using real Paseo/OpenCode/free-only execution
    and sanitized PostgreSQL evidence. Do not add test suites or fixtures.
15. Run `pnpm smoke:team-dag` first, before any narrow existing checks. The
    smoke must prove root waiting with no lease/activation; exactly three child
    Tasks; A and B started before either terminal event; distinct child
    RuntimeSessions, RuntimeCells, Workspaces, and provider Agents; one pinned
    EnvironmentVersion; resolved Skill or MCP Tool use; synthesizer gating;
    both real results in the root result; authenticated tree/result reads; and
    no fake runtime, prompt echo, or static marker explanation.

### Docs/verification

16. After the real smoke produces evidence, update the user-facing and
    component documentation in `README.md`, `docs/features.md`,
    `docs/components/orchestration-kernel.md`,
    `docs/components/data-and-operations.md`,
    `docs/components/paseo-runtime-adapter.md`,
    `docs/contracts/agent-team-api.md`, `docs/contracts/task-api.md`, and
    `docs/contracts/run-api.md`. Add a minimal Team DAG smoke runbook/evidence
    reference, also only after real evidence exists. Keep every update scoped
    to the implemented MVE and its observed evidence.
17. After the real smoke, run only narrow existing checks relevant to changed
    paths (for example `pnpm check` or the existing compiler/runtime checks),
    report exact commands and results, and do not author tests to make a check
    pass. Run `git diff --check` and inspect the final diff for scope.

## Non-goals

- `MVE-LONG1` restart/resume, reconciliation, crash-window recovery, or
  service restart acceptance.
- Retry, approval, cancellation propagation, compensation, quorum,
  first-success, partial success, or long-running waits.
- Nested Teams, dynamic fan-out, conditional branches, loops, alternate joins,
  node-specific Environments, public Team CRUD, TeamExecution APIs, or
  ProductSession Team conversation.
- Artifact/Evidence lineage, structured result resources, budgets, full ACL/OIDC,
  production isolation, placement, fairness, performance, or rollout hardening.
- New unit, contract, integration, deterministic E2E, fixture, or evaluation
  suites.

## Work breakdown

- [x] Record baseline and apply the P1 SessionLaunchSnapshot ownership fix.
- [x] Apply the P2 bounded Environment JSON ingress fix.
- [x] Implement the opt-in `dag-mve-v1` domain/compiler and validation rules.
- [x] Add migration `0019_team_dag_mve.sql`, ports, repositories, and transaction
      constraints for TeamExecution and TeamNodeExecution.
- [x] Add public `waiting_children` Run status and preserve direct Run API
      compatibility.
- [x] Implement durable root waiting and idempotent advancement/failure paths.
- [x] Implement task-scoped RuntimeSession/Cell launch for every child.
- [x] Configure dispatcher concurrency of at least two worker slots.
- [x] Add `pnpm smoke:team-dag` using real runtime evidence without tests or
      fixtures.
- [x] Run the real smoke first, then only applicable existing narrow checks.
- [x] Record evidence, deferred work, migration/smoke recovery outcome, and
      cleanup.

## Verification

- [x] `pnpm smoke:team-dag` — the real free-only Paseo/OpenCode path passed;
      combined smoke, retained inspection, and static evidence observed the real
      main orchestration path and runtime isolation. The script itself does not
      independently assert all ten detailed design assertions; built-in
      Skill/MCP Tool invocation and semantic output-quality validation remain
      explicitly transferred to Protect/Harden work.
- [x] Applicable existing narrow checks after smoke — no new test authoring and
      exact command/result recorded.
- [x] `git diff --check` — no whitespace errors.
- [x] Final diff — exactly the intended implementation and documentation scope;
      no credentials, raw provider errors, prompts, local paths, or generated
      evidence committed.

## Documentation impact

- [x] Product/Feature — update `README.md` and `docs/features.md` only after
      the real smoke establishes the implemented capability and evidence.
- [x] Component/Contract — update the three listed component/contract files
      after evidence, keeping `waiting_children` and child execution semantics
      aligned; no separate public Team API is added.
- [x] ADR/Runbook — add the minimal Team DAG smoke runbook/evidence reference
      after the real smoke; no new ADR is required for this MVE.

## Decisions and discoveries

- The durable join, not `Promise.all` around `ExecuteTeamTask`, is the acceptance
  boundary. The root must leave the worker stack before children complete.
- Child execution is ordinary `ExecuteRun`; the coordinator cannot bypass the
  dispatcher or `AgentRuntimePort`.
- EnvironmentVersion is shared immutable configuration only. Runtime state is
  task-scoped and never shared between siblings.
- The public status addition is limited to `waiting_children`; existing direct
  Run compatibility remains unchanged.
- Result handoff is bounded and text-only for this MVE. Formal Artifact,
  Evidence, and structured-output services remain deferred.

## Risks and recovery

- **Transactional hazard:** creating a child, recording completion, and advancing
  a join in separate transactions can duplicate children or start synthesis
  early. Use row locks plus unique `(team_execution_id,node_id)` constraints;
  retry only the safe repository transaction, never a provider call.
- **Lease hazard:** a waiting root retained in the dispatcher claim path can
  be re-run or hold an activation indefinitely. Commit waiting state and lease
  release atomically before returning.
- **Failure hazard:** a child failure racing a sibling completion must produce
  one terminal root outcome. Lock the TeamExecution and make terminal
  transitions idempotent; block unstarted downstream nodes.
- **Runtime hazard:** sharing a RuntimeSession, Cell, Workspace, or provider
  Agent across siblings would invalidate isolation evidence. Enforce task scope
  at launch and verify distinct IDs in smoke evidence.
- **Migration safety:** create a fresh isolated smoke database before applying
  `0019_team_dag_mve.sql`. Never apply an unproven migration to a retained
  evidence database. If migration or smoke fails, stop the dispatcher and
  preserve sanitized failure evidence; do not manually roll back or delete
  durable rows. Discard the isolated smoke database through its normal
  environment cleanup path and fix forward in a new isolated database.
- **Deferred recovery ledger:** restart/resume, reconciliation, retry,
  cancellation, crash windows, multi-node dispatch, and oversized-result
  artifact storage are explicitly transferred to `MVE-LONG1` or a subsequent
  plan; they are not acceptance blockers for this slice unless they invalidate
  the real smoke.

## Validation evidence

The canonical `pnpm smoke:team-dag` previously passed under Node 24 with
explicit `opencode/deepseek-v4-flash-free` and produced:

```json
{
  "status": "passed",
  "child_tasks": 3,
  "environment_version": "shared",
  "runtime_sessions": "task-scoped",
  "provider": "free-only"
}
```

Optional retained inspection captured `waiting_children`, synthesizer creation,
completed snapshots, and three distinct Paseo Workspace/provider Agent
bindings. The retained state is local/ignored and is not committed.

Independent Oracle review found two blockers: ProductSession partial-index
conflict inference and a bounded-handoff overflow root hang. Both were fixed;
Node 24 typecheck passed, and Oracle re-review reported no remaining blocker for
those issues.

The final post-archive Node 24 `pnpm run ci` passed type, format, docs, and
exec-plan checks; unit 370, contract 71, integration 143 with 36 skipped, and E2E
7; and the production TypeScript build. Before that final run, integration had
identified only stale migration-list expectations missing 0019; those existing
assertions were updated.

The smoke script does not independently assert all ten detailed design
assertions. The real main orchestration path and runtime isolation were observed
through combined smoke, retained inspection, and static evidence. Built-in
Skill/MCP Tool invocation and semantic output-quality validation were not
independently proven and are explicitly transferred to later Protect/Harden work;
they do not block this MVE orchestration PR.

## Completion checklist

- [x] Approved MVE path works without changing sequential published behavior.
- [x] P1/P2 prerequisites are fixed and verified.
- [x] Durable schema, migration, repositories, locks, and public status are
      verified against the root/child lifecycle.
- [x] Real smoke ran first and provides the combined evidence described above;
      detailed Skill/MCP invocation and semantic output quality are transferred.
- [x] Narrow existing checks and `git diff --check` results are recorded.
- [x] Deferred ledger, failure recovery, documentation impact, and cleanup are
      truthful.

## Current blocker

None. P1/P2 are the first implementation steps, not a blocked state.

## Next exact command

For repeat real-runtime evidence, run the canonical smoke under Node 24 with the
explicit default free model. The final post-archive CI result is recorded above.

```bash
POSTGRES_ADMIN_URL=<retained-local-admin-url> PASEO_MODEL=opencode/deepseek-v4-flash-free pnpm smoke:team-dag
```

## Cleanup state

The worktree contains the approved implementation changes and these completed
plan documents. Generated smoke processes/evidence and credentials were removed
through the existing cleanup path; only the sanitized evidence described above
is retained locally/ignored. Historical evidence documents are not rewritten.
Commit and PR preparation are authorized by the user, but this task must not
commit.

The default free model preference is now
`opencode/deepseek-v4-flash-free`; MiMo is removed from the preferred selection
list. Crash recovery/restart/resume/retry/reconciliation/cancel propagation and
the general Team API remain deferred to later Protect/Harden work.
