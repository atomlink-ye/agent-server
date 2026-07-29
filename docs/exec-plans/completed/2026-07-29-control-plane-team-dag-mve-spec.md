---
status: completed
owner: gpt-5.6-sol
created_at: 2026-07-29
updated_at: 2026-07-29
authority: approved-design
---

# Control-plane Parallel Agent Team + Join MVE

## Outcome

Prove one real `MVE-TEAM1` path in which a published TeamVersion starts two
real leaf Agents concurrently, waits durably for both, then starts one real
Synthesizer. Every child is a canonical Task/Run and executes through the
ordinary managed RuntimeSession/RuntimeCell path. The Team root coordinates
durable state and never owns a Team-wide provider session.

## Authority and baseline

- User approval on 2026-07-29 covers the public Run status, durable schema and
  migration, Team environment pin, task-scoped RuntimeSession, bounded handoff,
  dispatcher concurrency, and the two PR #15 prerequisite corrections below.
- Baseline is merged `origin/master` commit
  `7bacdcfc39a07549dd5b59b1127e76474cd54cbd` (PR #15).
- Product and implementation authority remains `docs/product.md`,
  `docs/features.md`, relevant Components and Contracts, current code, and the
  MVE-first roadmap supplied by the user.
- Existing `sequential-mvp-v1` behavior remains compatible and unchanged.

## Implementation status and evidence

The canonical `pnpm smoke:team-dag` previously passed under Node 24 with
explicit `opencode/deepseek-v4-flash-free`, producing
`{status:passed, child_tasks:3, environment_version:shared,
runtime_sessions:task-scoped, provider:free-only}`. Optional retained inspection
captured `waiting_children`, synthesizer creation, completed snapshots, and
three distinct Paseo Workspace/provider Agent bindings; retained state is
local/ignored and is not committed.

The real main orchestration path and runtime isolation were observed through
combined smoke, retained inspection, and static evidence. The smoke script does
not independently assert all ten detailed design assertions. Built-in Skill/MCP
Tool invocation and semantic output-quality validation were not independently
proven and are explicitly transferred to later Protect/Harden work; they do not
block this MVE orchestration PR.

Independent Oracle review found ProductSession partial-index conflict inference
and a bounded-handoff overflow root hang. Both were fixed; Node 24 typecheck
passed, and Oracle re-review reported no remaining blocker for those issues.

The default free model preference is now `opencode/deepseek-v4-flash-free`;
MiMo is removed from the preferred selection list. Historical evidence
documents are not rewritten. Crash recovery/restart/resume/retry/
reconciliation/cancel propagation and the general Team API remain deferred.

## Fixed scenario

One published `dag-mve-v1` TeamVersion pins one published EnvironmentVersion
and contains exactly three invoke nodes:

```text
research-a ─┐
            ├─> synthesize (final output)
research-b ─┘
```

`research-a` and `research-b` have no dependencies. `synthesize` depends on
both and is eligible only after both succeed. At least one research child uses
a resolved native Skill or Agent Server MCP Tool.

## Architecture

### Versioned Team graph

- Preserve the immutable `sequential-mvp-v1` compiler and execution path for
  already-published TeamVersions.
- Add an opt-in `dag-mve-v1` graph/compiler with only:
  - invoke nodes;
  - `dependsOn` edges;
  - all-success dependency semantics;
  - one final output node;
  - one Team-level published EnvironmentVersion.
- Reject cycles, missing references, unreachable nodes, unsupported node kinds,
  and multiple output nodes at publish/compile time.
- Do not generalize conditional branches, loops, nested Teams, dynamic fan-out,
  node-specific Environments, or alternate join policies.

### Durable orchestration

`TeamExecution` is one activation of a published DAG Team. A
`TeamNodeExecution` is the durable state of one compiled node and owns at most
one child Task.

Minimum states:

```text
TeamExecution: running | waiting_children | succeeded | failed
TeamNodeExecution: pending | queued | running | succeeded | failed | blocked
```

The claimed root Run creates the TeamExecution and all currently ready child
Tasks/Runs, then transitions to `waiting_children`, clears its lease and
activation, and returns from the worker call stack. Root Task remains `active`.

Child completion calls a small durable advancement service. The service records
the child result on its node, evaluates downstream eligibility, and creates the
Synthesizer child exactly once after both research nodes succeed. Synthesizer
success writes its text to the waiting root Run and completes the root Task. A
research or synthesizer failure marks unstarted downstream nodes `blocked` and
fails the root without retry.

### Ordinary child execution

All DAG children enter the existing run-dispatch queue and execute through
`ExecuteRun`; the Team coordinator must not claim a child inline or call
`AgentRuntimePort` directly. The in-process dispatcher may run at least two
worker slots concurrently, while PostgreSQL claim/fence remains the authority
for each Run.

### RuntimeSession and RuntimeCell

Extend RuntimeSession scope from only `product_session` to:

```text
product_session | task
```

Each Team child uses its Task ID as scope, receives one immutable
SessionLaunchSnapshot, one RuntimeSession, one derived RuntimeCell, one Paseo
Workspace, and one provider Agent. Siblings never share these objects. The
Team-level EnvironmentVersion is common immutable configuration, not shared
runtime state.

Child launch resolves the exact AgentVersion, Skill `{ref,digest}` facts, Tool
refs, and shared EnvironmentVersion through the same leaf execution path used
by managed ProductSession Agents. No Team-wide Paseo Agent or provider session
exists.

### Result handoff

The Synthesizer receives only:

- the original root brief;
- each source node ID;
- each child Task and Run ID;
- each successful child result text.

It does not receive child conversation history or scan sibling RuntimeCells.
Each child result is limited to 32 KiB UTF-8 and the combined handoff to 64 KiB.
Oversize input fails explicitly; it is not silently truncated. Formal Artifact,
Evidence, and structured output resources remain deferred.

## PR #15 prerequisite corrections

Before relying on the merged Environment baseline:

1. Correct SessionLaunchSnapshot/AgentVersion ownership so a ProductWorkspace
   created through the public Workspace API can launch a managed Agent without
   requiring its generated ProductWorkspace ID to equal the service account's
   registry workspace scope.
2. Replace unbounded `c.req.json()` parsing on Environment write routes with the
   existing bounded JSON ingress pattern.

The first correction must preserve owner isolation without weakening AgentVersion
lookup to tenant-only scope. The second is a bounded transport fix, not a new
Environment feature.

## Public and internal contracts

- Reuse `POST /api/v1/tasks:invoke` and existing Task/tree reads.
- Do not add public Team CRUD, TeamExecution, RuntimeSession, or approval APIs.
- Add `waiting_children` to the public Run status returned through Task reads.
- ProductSession Team conversation is not supported in this MVE.
- `/api/v1/runs` compatibility remains unchanged for direct Agent work.

## Failure behavior

- One failed child causes the TeamExecution and root Run/Task to fail.
- Unstarted downstream nodes become `blocked`.
- No child retry, partial success, quorum, first-success, compensation,
  reconciliation, or cancel propagation is implemented.
- Provider errors remain normalized; raw errors, prompts, Skill bodies,
  credentials, provider logs, and local paths do not enter evidence.

## Real main-flow acceptance

The canonical smoke is:

```text
pnpm smoke:team-dag
```

It must use real Paseo/OpenCode/free-only execution and sanitized PostgreSQL
evidence to prove:

1. the root Run entered `waiting_children` and held no lease or activation;
2. exactly three child Tasks exist under the root;
3. research A and B were both `started` before either reached a terminal event;
4. A and B used distinct RuntimeSessions, RuntimeCells, Paseo Workspaces, and
   provider Agents;
5. all children used the Team's one published EnvironmentVersion;
6. at least one research child used its resolved Skill or MCP Tool;
7. Synthesizer started only after A and B succeeded;
8. Synthesizer received both real child results and produced the root result;
9. the root tree and final result are readable through the authenticated API;
10. the outputs cannot be explained by a fake runtime, prompt echo, or a static
    marker supplied in the submitted root prompt.

Service restart/resume is not part of this acceptance. It belongs to
`MVE-LONG1` after this slice.

## Non-goals and deferred ledger

- Approval, external signals, clean restart/resume, and long-running waits;
- retry, reconciliation, cancel propagation, crash windows, and multi-node;
- nested Teams, manager-worker delegation, Agent messaging, rooms, or mailbox;
- conditional/dynamic nodes, loops, alternate joins, or node Environments;
- Artifact/Evidence lineage and structured result services;
- budget ledger, full ACL/OIDC, credential attenuation, and production grants;
- schedules, UI, placement, performance, fairness, GC, and production rollout;
- new unit, contract, integration, deterministic E2E, fixture, or evaluation
  suites unless the user separately requests them.

## Alternatives rejected

- `Promise.all` around the inline Sequential Team executor keeps the root call
  stack alive and preserves a Team-specific runtime bypass; it is not durable
  Join evidence.
- A Sequential-only task-scoped RuntimeSession probe does not satisfy the
  approved Phase 2 Parallel + Join outcome.
- Restarting the service during this smoke would pull `MVE-LONG1` into the
  current slice and is therefore deferred.
