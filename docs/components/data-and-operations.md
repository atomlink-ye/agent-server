# Data and Operations component

## Purpose

This component supplies durable storage, queue/outbox integration, audit, telemetry, deployment controls, migrations, reconciliation, and operator tooling.

## Baseline state

- PostgreSQL migrations plus durable Task, Run, admission, and dispatch tables.
- Structured JSON log records with request and Run identifiers.
- Separate liveness and dependency readiness.
- Deterministic CI plus a manually/scheduled external smoke.
- Signal-aware local process cleanup and ignored evidence.

There is no external queue service, durable event log beyond the current enqueue table, metrics backend, tracing backend, service-level objective, backup, or production deployment.

## V1 direction

PostgreSQL is the system of record for tenant-scoped aggregates, Task/Run state, idempotency, outbox, approvals, Artifact metadata, and audit projections. A queue transports hints; database state remains authoritative. Object storage holds source and Artifact bytes. Reconciliation is a first-class worker, not an operator-only repair script.

Every schema migration requires compatibility and rollback/recovery planning. Operational views must distinguish ingress, queue, claim, runtime, tool, artifact, and delivery failures without exposing prompt or secret content.
