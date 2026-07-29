# Data and Operations component

## Purpose

This component supplies durable storage, queue/outbox integration, audit, telemetry, deployment controls, migrations, reconciliation, and operator tooling.

## Baseline state

- PostgreSQL migrations plus durable Task, Run, admission, and dispatch tables.
- PostgreSQL durable Team execution and node-execution state for the observed
  `dag-mve-v1` join path: root waiting, two leaf completions, and synthesizer
  release.
- Structured JSON log records with request and Run identifiers.
- Separate liveness and dependency readiness.
- Deterministic CI plus a manually/scheduled external smoke.
- Signal-aware local process cleanup and ignored evidence.

There is no external queue service, durable event log beyond the current enqueue table, metrics backend, tracing backend, service-level objective, backup, or production deployment.

The DAG MVE uses one shared immutable EnvironmentVersion and task-scoped
RuntimeSession/RuntimeCell records for each child. Failure handling is
fail-fast/deferred; this does not establish crash recovery, restart/resume,
retries, cancellation propagation, or production durability.

## V1 direction

PostgreSQL is the system of record for tenant-scoped aggregates, Task/Run state, idempotency, outbox, approvals, Artifact metadata, and audit projections. A queue transports hints; database state remains authoritative. Object storage holds source and Artifact bytes. Reconciliation is a first-class worker, not an operator-only repair script.

Every schema migration requires compatibility and rollback/recovery planning. Operational views must distinguish ingress, queue, claim, runtime, tool, artifact, and delivery failures without exposing prompt or secret content.
