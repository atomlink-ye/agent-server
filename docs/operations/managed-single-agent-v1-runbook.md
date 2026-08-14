# Managed Single-Agent V1 Runbook

Status: **minimum-scenario operational guidance; production hardening deferred**

This runbook describes the current managed single-Agent path without preserving one historical acceptance run as repository evidence. Public responses and retained diagnostics must remain free of prompts, YAML source, credentials, private local paths, raw provider errors, and raw owner identifiers.

## Minimum happy path

1. Validate/import and publish an immutable Managed Agent version.
2. Create an owner-visible Product Workspace and ProductSession using the explicitly published AgentVersion.
3. Admit a user Message into the durable Task/Run lane.
4. Resolve the exact configured/pinned Workspace Memory snapshot when the path uses managed memory.
5. Execute through the runtime/execution boundary, persist normalized events and the formal assistant result, and read the owner-scoped result.

The product/session identity and durable Task/Run state belong to Agent Server. Provider execution state is an external runtime concern. Do not treat a provider Agent ID as the product Agent identity.

## Queue, cancel, reset, and replay

Use authenticated Task/Run routes to inspect queued and active work. Cancellation records durable intent and forwards one runtime cancel when applicable. Session reset advances generation according to the current lane rules. Run event replay uses the persisted cursor/SSE boundary. These are current single-node/MVE semantics, not distributed recovery guarantees.

## Memory governance and projection

Create/review proposals through the current Memory APIs, then inspect accepted entries/snapshots. Rebuild creates a new immutable snapshot. A pinned snapshot mismatch or missing verified projection fails closed: never silently substitute latest, expose a local path, or leak hash/path details in a public error.

The API-first Memory Store/Memory/Version model remains owner-scoped and PostgreSQL-backed. Changed content uses compare-and-swap semantics and immutable versions; same-content updates are no-ops. The built-in `agent-server/memory-api` Skill documents the API boundary but does not itself grant credentials or unrestricted HTTP execution.

## Fresh Session recall

Admission pins the exact ready memory/context identity required by the current product path. Execution reads that exact identity rather than silently following a newer pointer. A successful run persists the formal assistant result.

Memory policy evaluation is explicit and separate from deterministic tests:

```bash
pnpm eval:memory
```

`auto_safe` remains disabled unless a separate product decision enables it.

## Recovery inspection

Recovery/operator inspection must remain bounded and sanitized. Do not persist one local database's counts or one run's observations in this runbook. When runtime side effects are uncertain, stop automatic retry and escalate rather than guessing completion.

Operator recovery/migration helpers live under `scripts/ops/` and are not part of ordinary test/CI orchestration.

## Rollback and escalation

Rollback means deploying a previously accepted application revision while retaining additive durable migrations/data unless a specific migration recovery decision says otherwise. Do not delete or rewrite accepted entries, snapshots, events, published AgentVersions, or user data merely to make a verification pass.

## Filesystem threat boundary

The current single-node development/runtime setup may share an operating-system account between trusted control-plane/runtime processes. Existing path/descriptor validation is defense in depth, not a complete sandbox against hostile same-UID interference. Stronger UID/container/sandbox isolation remains separate hardening work.

## Limitations

This runbook does not claim production fsync/crash recovery, durable runtime receipt reconciliation, backup/restore, multi-node locking, object storage/KMS, complete sandboxing, generalized context retrieval, automatic rollout, or production readiness.
