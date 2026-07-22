# Orchestration Kernel component

## Purpose

The kernel turns admitted intent into durable, bounded, recoverable execution. Task is the canonical node invocation; Run is one attempt; Activation is temporary worker authority.

## Current implementation

The current walking skeleton contains:

- canonical root [`Task`](../../src/domain/tasks/task.ts) admission under [`src/application/tasks`](../../src/application/tasks/);
- compatibility Run submit/get/claim/complete use cases under [`src/application/runs`](../../src/application/runs/);
- PostgreSQL-backed Task, Run, admission, and migration infrastructure under [`src/infrastructure/postgres`](../../src/infrastructure/postgres/);
- an in-process [`PostgresRunDispatcher`](../../src/infrastructure/postgres/postgres-run-dispatcher.ts) that claims queued Runs and executes them through `AgentRuntimePort` with lease/activation/fence metadata behind the repository boundary;
- the unchanged public `/api/v1/runs` compatibility surface.

This proves durable admission, idempotent replay, and fenced in-process execution without exposing internal Task state over HTTP yet.

Still out of scope for this phase: child-task trees, waiting/resume, cancel, retry, reconcile, Team execution, tenant/identity enforcement, and artifact/evidence orchestration.

## V1 responsibilities

- Materialize root and child Tasks before execution and enforce idempotency.
- Create Run attempts only for eligible Tasks.
- Atomically claim Runs with lease owner, unpredictable activation ID, and increasing fence.
- Normalize leaf-runtime events and apply only current fenced writes.
- Persist child completion, joins, approvals, waiting conditions, and resume state.
- Propagate bounded cancel, retry, budget, trace, and capability attenuation through the Task tree.
- Reconcile lease loss from runtime timeline and side-effect receipts; use `unknown` when safety cannot be proven.

## Team boundary

Agent and Team are both Invokable versions. A Team activation executes control-plane graph IR and creates Child Tasks; it never creates a Paseo session for the whole graph. Leaf Agent Runs alone cross the Runtime Port.

## Completion evidence

V1 requires state-machine property tests, claim/fence concurrency tests, replay and duplicate-completion tests, restart/kill fault tests, and end-to-end lineage assertions. See [Execution and recovery](../architecture/execution-and-recovery.md).
