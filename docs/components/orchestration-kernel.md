# Orchestration Kernel component

## Purpose

The kernel turns admitted intent into durable, bounded, recoverable execution. Task is the canonical node invocation; Run is one attempt; Activation is temporary worker authority.

## Current implementation

The current walking skeleton contains:

- canonical root and child [`Task`](../../src/domain/tasks/task.ts) admission/query services under [`src/application/tasks`](../../src/application/tasks/);
- compatibility Run submit/get/claim/complete use cases under [`src/application/runs`](../../src/application/runs/);
- public `POST /api/v1/tasks:invoke`, `GET /api/v1/tasks/{id}`, and `GET /api/v1/tasks/{id}/tree` routes under [`src/entrypoints/api/routes/tasks.ts`](../../src/entrypoints/api/routes/tasks.ts);
- PostgreSQL-backed Task, Run, admission, and migration infrastructure under [`src/infrastructure/postgres`](../../src/infrastructure/postgres/);
- an in-process [`PostgresRunDispatcher`](../../src/infrastructure/postgres/postgres-run-dispatcher.ts) that claims queued Runs and executes published Agent work through `AgentRuntimePort` or published Team work through [`ExecuteTeamTask`](../../src/application/tasks/execute-team-task.ts) with lease/activation/fence metadata behind the repository boundary;
- the unchanged public `/api/v1/runs` compatibility surface.
- the authenticated API-first Memory Store/Memory routes composed beside the
  existing Task/Run kernel; Memory Version append and current-pointer CAS are
  owned by the Memory API repository rather than Task admission.
- the minimum Phase D `RuntimeSessionBinding`/`RunEvent` repository, lifecycle event persistence, final assistant Message write, replay/poll SSE routes, and owner-scoped Task cancellation.

Admission first creates or replays through a transaction-scoped repository. The real PostgreSQL 16 lane uses an admission `pg.Pool` with max 2 plus a separate reader pool with max 2, and a forced same-key race to prove committed visibility, replay, owner isolation, and unique-key convergence. This proves durable admission, owner-scoped Task reads, idempotent replay, fenced in-process execution, and sequential Team child genealogy while preserving `/api/v1/runs` as a compatibility API.

When runtime work succeeds but terminal persistence fails, the kernel preserves the distinction with `RunCompletionPersistenceError` and a safe `RuntimeExecutionReceipt`; it does not relabel the outcome as `runtime_execution_failed`. Receipt durability and reconciliation remain deferred to later recovery work.

Still out of scope: full Runtime Session V2 create/resume/status, incremental deltas, rich usage, retry/reconcile/receipts, multi-worker recovery, parallel/join semantics, approvals, budget propagation, and artifact/evidence orchestration.

## Minimum Phase D interaction

Claimed execution binds the Run to a provider session and persists `started`,
safe final `output`, and one terminal event. Successful ProductSession Runs add
one assistant Message using the locked Session Lane sequence; lane promotion
then permits the next queued Task. Event reads and SSE derive owner scope
through Task/Run ownership. Cancellation persists the request before forwarding
runtime cancellation; queued work terminalizes locally. This is not a claim of
crash-atomic recovery or a complete provider session API.

`ExecuteRun` resolves a stable Session Bootstrap separately from each Run's
current Turn. Existing ProductSession binding selects whether the runtime
operation creates an Agent or continues the bound Agent. Durable Task/Run
admission, completion, assistant Message, and result outbox behavior is
unchanged.

Published managed Agent resolution may load the server-owned
`agent-server/memory-api` Skill into create-time native Runtime Bootstrap. The
kernel records the resulting Agent/Run work normally; it does not grant the
Agent a Memory HTTP capability. Continuation sends only the current turn.

## V1 responsibilities

- Materialize root and child Tasks before execution and enforce idempotency.
- Create Run attempts only for eligible Tasks.
- Atomically claim Runs with lease owner, unpredictable activation ID, and increasing fence.
- Normalize leaf-runtime events and apply only current fenced writes.
- Persist child completion, joins, approvals, waiting conditions, and resume state.
- Propagate bounded cancel, retry, budget, trace, and capability attenuation through the Task tree.
- Reconcile lease loss from runtime timeline and side-effect receipts; use `unknown` when safety cannot be proven.

## Team boundary

Agent and Team are both Invokable versions. In this MVP, a Team activation executes compiled sequential control-plane IR and creates sibling child Tasks beneath the root Task with stable `logicalStepKey` and `nodePath` ordering; it never creates a Paseo session for the whole graph. Leaf Agent Runs alone cross the Runtime Port.

## Completion evidence

V1 requires state-machine property tests, claim/fence concurrency tests, replay and duplicate-completion tests, restart/kill fault tests, and end-to-end lineage assertions. See [Execution and recovery](../architecture/execution-and-recovery.md).
