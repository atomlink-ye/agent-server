# Data and Operations component

## Purpose

This component supplies durable storage, queue/outbox integration, audit, telemetry, deployment controls, migrations, reconciliation, and operator tooling.

## Baseline state

- PostgreSQL migrations plus durable Task, Run, admission, and dispatch tables.
- PostgreSQL durable Agent Teams v2 execution state: TeamRun, MemberRun, Work,
  Work attempts, TeamMessage, command receipts, and child Task/Run linkage.
- Structured JSON log records with request and Run identifiers.
- Separate liveness and dependency readiness.
- Deterministic CI plus a manually/scheduled external smoke.
- Signal-aware local process cleanup and ignored evidence.

There is no external queue service, durable event log beyond the current enqueue table, metrics backend, tracing backend, service-level objective, backup, or production deployment.

Agent Teams v2 uses one immutable TeamVersion and member-scoped RuntimeSessions
for Lead/member child Runs. `task_id` on a runtime session is the creating
task only; continuation Tasks reuse the member scope under a keyed mutex. The
launch snapshot and immutable catalog are checked against workspace, agent,
and environment ownership on every turn, while dynamic allowed tools are a
policy subset. Lead grants are narrowed to zero immediately after execution,
before provider/event/memory/completion persistence, and fail closed on revoke
or refresh errors. It does not establish general restart/resume,
retries, cancellation propagation, or production durability. The bounded
fail-closed recovery path terminalizes an expired running Team child Run and its
Team/root projection after locking the Team first; it does not resume a provider
turn whose durable runtime grant cannot be reconstructed.

## V1 direction

PostgreSQL is the system of record for tenant-scoped aggregates, Task/Run state, idempotency, outbox, approvals, Artifact metadata, and audit projections. A queue transports hints; database state remains authoritative. Object storage holds source and Artifact bytes. Reconciliation is a first-class worker, not an operator-only repair script.

Every schema migration requires compatibility and rollback/recovery planning. Operational views must distinguish ingress, queue, claim, runtime, tool, artifact, and delivery failures without exposing prompt or secret content.
