# Orchestration Kernel component

## Purpose

The kernel turns admitted intent into durable, bounded, recoverable execution. Task is the canonical node invocation; Run is one attempt; Activation is temporary worker authority.

## Baseline implementation

The current walking skeleton deliberately contains only:

- [`Run`](../../src/domain/runs/run.ts) and its minimal state invariant;
- Submit, execute, and get use cases under [`src/application/runs`](../../src/application/runs/);
- [`InMemoryRunRepository`](../../src/infrastructure/memory/in-memory-run-repository.ts);
- an in-process asynchronous callback that calls `AgentRuntimePort`.

This proves API and adapter separation. It does not survive restart, serialize concurrent work, provide idempotency, or guarantee accepted-work durability.

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
