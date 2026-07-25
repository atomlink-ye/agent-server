# Operations

The baseline supports local development and external smoke only. It has no production deployment or SLO.

- [Local development](operations/local-development.md) covers installation, commands, configuration, and process isolation.
- [Runbook](operations/runbook.md) covers diagnosis and safe recovery for the current boundaries.
- [Lark Managed Memory command canary runbook](operations/lark-memory-command-canary-runbook.md) covers fixed configuration, readiness, one-consumer operation, verification, and graceful shutdown.
- [Lark Managed Memory Card/Doc evidence](evidence/lark-managed-memory-card-doc-canary-evidence-packet.md) records the sanitized normal-path provider boundary.
- [Task 14 hardening plan](exec-plans/active/2026-07-25-lark-memory-task14-hardening.md) owns deferred lease, retry, recovery, multi-node, and performance work; it is not part of the current PR.

Production operations require a separate plan covering deployment topology, durable storage, migrations, backup/restore, secret management, metrics, alerts, reconciliation, and incident ownership.
