# Managed Single-Agent V1 Evidence Packet

Status: **DRAFT / PENDING final reviewer status**

## Scope and source

- Source baseline: `3e5e61d`.
- Current pre-documentation HEAD: `cfc630de79f09b867e75d3639e7e6b4acf0fa3bf`.
- Evidence runtime: Node 24.
- Migration sequence: `0001` through `0008`, including `0005b`.
- Final reviewer status: **PENDING**.

This packet records milestone evidence, not production readiness. It contains
no raw prompts, YAML, content, credentials, local filesystem paths, provider
errors, or raw owner/resource identifiers.

## Command evidence

| Command / lane          | Result                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| `make ci`               | unit 133; contract 68; deterministic integration 75; 16 expected real-PG skips; E2E 2; checks/build green     |
| `make test-real-pg`     | PostgreSQL16: 59/59 passed                                                                                    |
| `make e2e-smoke`        | 2/2 passed                                                                                                    |
| `make paseo-smoke`      | provider `opencode`; model `opencode/mimo-v2.5-free`; terminal succeeded; marker `PASEO_OPENCODE_BASELINE_OK` |
| `make eval-smoke`       | 13 cases; all zero-tolerance counters 0                                                                       |
| `pnpm check:docs`       | passed                                                                                                        |
| `pnpm check:exec-plans` | passed                                                                                                        |

The Paseo lane records only safe provider/model labels and the exact marker;
raw logs and evidence paths are intentionally omitted.

## H evidence IDs

### H-FAULTS

Focused fault matrix: 3/3 passed. The lane covers the minimum bounded fault
and fail-closed behavior required for this draft; it is not exhaustive crash
recovery or receipt reconciliation evidence.

### H-TRANSCRIPT

Managed single-agent transcript contract: 1/1 passed as an in-process
authenticated Hono `app.request` contract test, including governed memory,
Fresh Session pin/recall, and final assistant Message persistence. This is not
real-socket evidence. Separate Vitest E2E tests provide the real ephemeral HTTP
socket evidence; the packet records that lane separately as `make e2e-smoke`
2/2.

### H-RECOVERY

Dry-run reconciliation output:

```json
{
  "mode": "DRY_RUN",
  "nonterminal_runs": 46,
  "queued_dispatches": 81,
  "pending_memory_projections": 0,
  "failed_memory_projections": 4,
  "snapshots_lacking_ready_projection": 0,
  "runtime_receipt_reconciliation": "unavailable"
}
```

These counts came from a local verification database. They are inspection
evidence only and are not release-state health claims. The dry-run performs no
mutation.

### H-OPS

Runbook, rollback, escalation, limitation, and no-secret/no-path boundaries
are documented in the draft managed single-agent runbook. Rollback retains
additive data and does not rewrite immutable history.

### H-PACKET

This packet, the draft ADR, and the Active Exec Plan record the evidence source,
commands, limitations, and pending final review. The packet is not an approval.

## Known limitations and deferred hardening

Deferred hardening remains consolidated in the existing ledger entries,
including ML/LLM classification, rich PII/i18n, UI, advanced metrics/tuning,
durable traces, semantic contradiction, expiry/compaction execution,
distributed evaluation/rollout/performance, crash recovery, fsync,
backup/restore, object storage/KMS, multi-node locking, sandboxing, provider
mounts, and broad context assembly. Auto-safe remains disabled by default and
model-based gardening is not implemented.

## Release decision

**PENDING.** H-6 blocker-only Oracle review, final release decision, and archive
are still required. This draft must not be read as a production readiness claim.
