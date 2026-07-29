---
status: completed
owner: gpt-5.6-sol
created_at: 2026-07-29
updated_at: 2026-07-29
authority: execution-plan
---

# Control-plane Team DAG MVE

## Outcome

Implement the approved `MVE-TEAM1` path from baseline
`origin/master` `7bacdcfc39a07549dd5b59b1127e76474cd54cbd`: one published
`dag-mve-v1` TeamVersion pins one EnvironmentVersion, starts two independent
leaf Tasks/Runs concurrently, durably waits, then starts one synthesizer and
completes the root. Preserve published `sequential-mvp-v1`; do not implement
`MVE-LONG1` restart/resume.

## Context and authority

Authority is the approved spec at
`docs/exec-plans/completed/2026-07-29-control-plane-team-dag-mve-spec.md`, the
protocol at `docs/agents/exec-plan-protocol.md`, repository instructions, and
current code. Existing seams are `ExecuteTeamTask` in
`src/application/tasks/execute-team-task.ts`, `SequentialTeamCompiler` in
`src/application/invokables/sequential-team-compiler.ts`, `ExecuteRun` in
`src/application/runs/execute-run.ts`, and `PostgresRunDispatcher` in
`src/infrastructure/postgres/postgres-run-dispatcher.ts`.

## Scope

- **Prerequisite P1/P2:** correct managed `SessionLaunchSnapshot`/
  `AgentVersion` ownership lookup so public ProductWorkspace launches safely;
  replace Environment write-route `c.req.json()` with bounded ingress.
- **Domain/compiler:** add opt-in invoke-only `dag-mve-v1` with `dependsOn`,
  cycle/reference/reachability/kind/output validation, exact Agent/Skill/Tool
  resolution, and one Team EnvironmentVersion; leave sequential compiler intact.
- **Schema/repositories:** add migration `0019_team_dag_mve.sql`, durable
  `TeamExecution`/`TeamNodeExecution`, transactional owner-scoped repositories,
  unique child creation, locks, result limits, and public Run
  `waiting_children` through Task reads.
- **Waiting/advancement:** root creates ready children, enters
  `waiting_children`, releases lease/activation, and returns. Child completion
  advances exactly once; synthesis follows two successes; failure blocks
  downstream and fails root without retry.
- **Task-scoped runtime:** RuntimeSession scope becomes
  `product_session | task`; every child gets distinct snapshot/session/cell/
  Workspace/provider Agent while sharing only immutable EnvironmentVersion.
- **Dispatcher:** give `PostgresRunDispatcher` at least two worker slots;
  PostgreSQL claim/fence remains authoritative.
- **Smoke:** add real `pnpm smoke:team-dag` with free-only Paseo/OpenCode and
  sanitized PostgreSQL evidence. Do not add tests, fixtures, evals, or public
  Team APIs.
- **Docs/verification:** after real evidence, update `README.md`,
  `docs/features.md`, `docs/components/orchestration-kernel.md`,
  `docs/components/data-and-operations.md`,
  `docs/components/paseo-runtime-adapter.md`,
  `docs/contracts/agent-team-api.md`, `docs/contracts/task-api.md`, and
  `docs/contracts/run-api.md`, plus a minimal Team DAG smoke runbook/evidence
  reference. Run smoke first as behavior verification, then only narrow
  existing checks and `git diff --check`.

## Non-goals

No restart/resume, retry, approval, cancellation propagation, reconciliation,
crash recovery, nested/dynamic/conditional/looping Teams, alternate joins,
node Environments, artifacts/evidence lineage, structured outputs, budgets,
full ACL/OIDC, production rollout hardening, or new test/fixture/eval suites.

## Work breakdown

- [x] P1/P2 prerequisite fixes.
- [x] DAG domain/compiler and immutable resolved snapshot.
- [x] `0019_team_dag_mve.sql`, repositories, locks, and public status.
- [x] Root waiting, bounded handoff, idempotent advancement, and failure.
- [x] Task-scoped RuntimeSession/RuntimeCell path.
- [x] Dispatcher concurrency and bootstrap wiring.
- [x] Real `pnpm smoke:team-dag` and sanitized acceptance evidence.
- [x] Narrow existing checks after smoke; no test authoring.
- [x] Record deferred ledger, migration/smoke recovery, and cleanup state.

## Verification

- [x] First behavior-verification command after implementation:
      `pnpm smoke:team-dag`; combined smoke, retained inspection, and static
      evidence observed the real orchestration path and runtime isolation. The
      script does not independently assert all ten detailed design assertions;
      Skill/MCP invocation and semantic output quality are transferred to
      Protect/Harden.
- [x] Run only applicable existing narrow checks after smoke and record exact
      results.
- [x] Run `git diff --check` and inspect scope.

## Documentation impact

- [x] After real evidence, update the listed README, Feature, Component, and
      Contract documents plus a minimal Team DAG smoke runbook/evidence
      reference; keep all changes scoped to observed MVE behavior.
- [x] Keep public `waiting_children` and smoke evidence references aligned with
      implementation; no new public Team CRUD or orchestration API.

## Decisions and discoveries

The root coordinator is durable orchestration, not a provider session. Children
must enter ordinary `ExecuteRun`; a `Promise.all` inline executor is rejected.
Handoff is only bounded root brief, node IDs, child IDs, and successful text:
32 KiB per child and 64 KiB combined, with explicit overflow failure.

Foundation slice decisions (2026-07-29): `SequentialTeamGraph` and
`CompiledSequentialTeamPlan` retain their existing shape and compiler version;
the opt-in DAG uses graph mode/compiler version `dag-mve-v1`. DAG compilation
pins only owner-scoped published AgentVersion IDs and one published
EnvironmentVersion ID; Skill bodies and resolved Tool details remain outside
the Team plan. TeamExecution persistence owns execution/node row locks in the
future advancement transaction; creation of Tasks and Runs remains the caller's
transaction seam and is intentionally not performed by this repository.

Task-scoped runtime discovery (2026-07-29): DAG child Tasks without a
ProductSession now resolve their TeamExecution EnvironmentVersion and use a
dedicated task-scoped launch snapshot/runtime session; ordinary direct Agent
Tasks continue to use the legacy path. Runtime activation and TeamExecution
advancement remain separate follow-up work.

Activation/join slice (2026-07-29): the DAG root now creates and enqueues
dependency-free children through the ordinary admission/run-dispatch path,
releases the root to `waiting_children`, and returns without terminal
completion. Child terminal persistence invokes bounded advancement, creates
eligible downstream nodes once, and finalizes the root after the final node.
Creation and advancement are intentionally not crash-atomic beyond existing
row locks and uniqueness constraints; retry/recovery remains deferred.

Smoke validation (2026-07-29, Node v24.18.0): the fresh disposable database,
isolated Paseo process, authenticated API, Agent/Environment publication, and
direct DAG Team compilation all reached the real Team invoke path. The first
activation blocker was child-task FK ordering; child Tasks/Runs are now saved
before TeamExecution rows. The second blocker was the missing
`waiting_children` run-state check; migration 0019 now includes it. The
third blocker was provider/model availability; the final run used explicit
free `opencode/deepseek-v4-flash-free` and completed the full three-child flow.
The first successful output revealed a smoke cleanup bug: the script closed only
partial resources and left handles alive. The cleanup now awaits API close and
uses `service.close()` for the full service resource bundle. Disposable database
and runtime cleanup ran after each attempt; no retained database or evidence was
changed.

P1/P2 prerequisite root causes traced on 2026-07-29:

- P1: migration `0018_managed_environment_runtime_session_mve.sql` declares
  `session_launch_snapshots.agent_version_id` as a composite foreign key over
  `(id, tenant_id, workspace_id, principal_type, principal_id)`. Public
  ProductWorkspace IDs are generated independently, while managed AgentVersion
  rows are owned under the configured registry workspace. The snapshot insert
  therefore fails even when tenant/principal ownership matches. Existing
  AgentVersion lookups include tenant and principal identity (not tenant alone),
  so the correction is an owner-scoped `(id, tenant_id, principal_type,
principal_id)` key/FK while retaining snapshot `workspace_id` as data.
- P2: `routes/environments.ts` calls `c.req.json()` directly in the shared body
  helper for both Environment package writes and publish. Parsing happens before
  any byte limit can be enforced, unlike the existing `readBoundedJson` ingress;
  oversized bodies can consequently be fully buffered. The fix reuses that
  helper with a focused Environment request-byte limit and preserves its 400/413
  `HttpError` behavior.

## Risks and recovery

Use one transaction with TeamExecution locks and unique node-child keys for
activation/advancement; never retry provider calls for a repository race.
Commit root waiting and lease release atomically. Create a fresh isolated smoke
database before applying the migration and never apply an unproven migration
to a retained evidence database. On migration or smoke failure, stop workers
and preserve sanitized evidence; do not manually roll back or delete durable
rows. Discard the isolated smoke database through normal environment cleanup
and fix forward in a new isolated database. The deferred ledger is
restart/resume, reconciliation, retry, cancellation, crash-window recovery,
multi-node dispatch, and artifact storage, transferred to `MVE-LONG1` or a
later plan.

## Validation evidence

P1/P2 prerequisite validation (2026-07-29): static inspection confirms
`0019_team_dag_mve.sql` is registered after `0018`, creates the owner-scoped
AgentVersion key, removes the generated 0018 snapshot-to-AgentVersion FK, and
adds the owner-only replacement while retaining snapshot `workspace_id`.
Environment write routes now use `readBoundedJson` with a 64 KiB focused limit;
the helper provides 400 invalid-JSON and 413 over-limit errors before schema
validation. The real `pnpm smoke:team-dag` remains the required first behavior
evidence command for the later Team DAG implementation. Existing checks are
supporting only, and no tests, fixtures, evals, credentials, prompts, or raw
provider errors may be added.

Team DAG behavior validation (2026-07-29, Node v24.18.0):

```bash
POSTGRES_ADMIN_URL=<retained-local-admin-url> \
PASEO_MODEL=opencode/deepseek-v4-flash-free \
pnpm smoke:team-dag
```

Output:

```json
{
  "status": "passed",
  "child_tasks": 3,
  "environment_version": "shared",
  "runtime_sessions": "task-scoped",
  "provider": "free-only"
}
```

The command exited cleanly after the smoke cleanup fix. Optional retained
inspection captured `waiting_children`, synthesizer creation, completed
snapshots, and three distinct Paseo Workspace/provider Agent bindings. Retained
state is local/ignored and is not committed. The real main orchestration path
and runtime isolation were observed through combined smoke, retained
inspection, and static evidence; the smoke script itself does not independently
assert all ten detailed design assertions. Built-in Skill/MCP Tool invocation and
semantic output-quality validation were not independently proven and are
explicitly transferred to later Protect/Harden work, without blocking this MVE
orchestration PR.

Independent Oracle review found ProductSession partial-index conflict inference
and a bounded-handoff overflow root hang. Both were fixed; Node 24 typecheck
passed, and Oracle re-review reported no remaining blocker for those issues.

The final post-archive Node 24 `pnpm run ci` passed type/format/docs/exec-plan
checks; unit 370, contract 71, integration 143 with 36 skipped, and E2E 7; and
the production TypeScript build. Before that final run, integration had
identified only stale migration-list expectations missing 0019; those existing
assertions were updated.

## Completion checklist

- [x] MVE smoke passes and preserves sequential behavior.
- [x] Durable schema/status/runtime/dispatcher requirements are verified.
- [x] Supporting checks and `git diff --check` are recorded.
- [x] Deferred work, recovery, documentation impact, and cleanup are truthful.

## Current blocker

None for `MVE-TEAM1`; `MVE-LONG1` recovery/restart/resume remains deferred.

## Next exact command

For repeat evidence, run:

```bash
POSTGRES_ADMIN_URL=<retained-local-admin-url> PASEO_MODEL=opencode/deepseek-v4-flash-free pnpm smoke:team-dag
```

## Cleanup state

The user authorized final PR preparation; this task must not commit. Leave only
the intended implementation and these completed plans; terminate smoke
processes and remove generated credentials, fixtures, and debug output using the
existing cleanup path, retaining only sanitized evidence referenced here.
The default free model preference is now
`opencode/deepseek-v4-flash-free`; MiMo is removed from the preferred selection
list. Historical evidence documents are not rewritten. Crash
recovery/restart/resume/retry/reconciliation/cancel propagation and the general
Team API remain deferred to later Protect/Harden work.
