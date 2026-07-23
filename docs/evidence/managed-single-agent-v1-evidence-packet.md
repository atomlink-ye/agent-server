# Managed Single-Agent V1 Evidence Packet

Status: **FINAL MINIMUM-SCENARIO EVIDENCE / APPROVED AFTER REAL-SOCKET CORRECTION**

## Scope and source

- Source baseline: `3e5e61d`.
- Current evidence HEAD before documentation closeout: `9cde3a9`.
- Evidence runtime: Node 24.
- Migration sequence: `0001` through `0011`, including `0005b`.
- Final blocker-only Oracle reviewer status: **APPROVED**.

This packet records milestone evidence, not production readiness. It contains
no raw prompts, YAML, content, credentials, local filesystem paths, provider
errors, or raw owner/resource identifiers.

## Command evidence

| Command / lane                       | Result                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `make ci`                            | unit 159; contract 71; deterministic integration 84; 28 expected real-PG skips; E2E 5; checks/build green     |
| `DATABASE_URL=... make test-real-pg` | PostgreSQL16: 67/67 passed                                                                                    |
| `pnpm test:e2e`                      | 5/5 passed over real ephemeral TCP HTTP/SSE                                                                   |
| `make paseo-smoke`                   | provider `opencode`; model `opencode/mimo-v2.5-free`; terminal succeeded; marker `PASEO_OPENCODE_BASELINE_OK` |
| `make eval-smoke`                    | 13 cases; all zero-tolerance counters 0                                                                       |
| `pnpm check:docs`                    | passed                                                                                                        |
| `pnpm check:exec-plans`              | passed                                                                                                        |

The Paseo lane records only safe provider/model labels and the exact marker;
raw logs and evidence paths are intentionally omitted.

## H evidence IDs

### H-FAULTS

Focused fault matrix: 3/3 passed. The lane covers the minimum bounded fault
and fail-closed behavior required for this scenario; it is not exhaustive crash
recovery or receipt reconciliation evidence.

### H-TRANSCRIPT

Managed single-agent transcript contract: focused Node24 1/1 passed as an
in-process authenticated Hono `app.request` contract test. It verified a
source-task-scoped unique recall marker, owned cancellation, governed memory,
Fresh Session pin/recall, and final assistant Message persistence. The marker
itself is intentionally not reproduced here. This is not real-socket evidence.
Separate Vitest E2E tests provide the real ephemeral HTTP socket evidence; the
packet records that lane separately as `pnpm test:e2e` 5/5.

### Socket canary correction evidence

The final real-socket suite proves the fixed Product Session canary over
ephemeral TCP HTTP/SSE rather than in-process `app.request`:

- YAML validation/import/publish, Fresh Session admission, succeeded Run, and a
  persisted final assistant Message.
- Live SSE disconnect/reconnect from an active Run cursor, terminal replay
  closure, and no duplicate terminal event.
- Runtime-origin memory candidates with complete Message/Task/Run/AgentVersion
  and candidate-index provenance; accept/reject review; exact immutable snapshot
  ID/hash pinning; and Fresh Session recall from the pinned snapshot.
- Rejected and genuinely later accepted memory excluded from a task pinned to the
  earlier snapshot.
- Durable queued follow-ups, database-arbitrated active cancellation, reset
  generation linkage, and dispatcher outage/recovery through Product Session
  message admission.
- Bidirectional Product Workspace memory isolation using explicit
  production-use-case fixture setup, plus owner and foreign-principal visibility
  checks. These fixture entries are not runtime-origin evidence; runtime-origin
  proposal flow is proven by the fixed canary.

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

Runbook, rollback, escalation, limitation, and no-secret/no-path boundaries are
documented in the managed single-agent runbook. The runbook also records the
single-node filesystem threat boundary for Paseo memory artifacts: path checks,
random run directories, `O_NOFOLLOW`, regular-file checks, and bounded reads are
defense-in-depth; a hostile same-UID filesystem principal requires separate
UID/container/openat-class containment and remains deferred. Rollback retains
additive data and does not rewrite immutable history.

### H-PACKET

This packet, the ADR, completed Exec Plan, and completed correction plan record
the evidence source, commands, limitations, and final reviewer decision. It
approves only the minimum scenario evidence boundary.

### H-ARCHIVE

Final blocker-only Oracle review approved the corrected transcript provenance,
runtime memory provenance, cancellation arbitration, and real-socket evidence.
The plan, spec, and correction plan are now completed documents, their internal
links point to `docs/exec-plans/completed/`, and H-6 archive closeout is
complete. Deferred hardening remains active in the ledger.

## Known limitations and deferred hardening

Deferred hardening remains consolidated in the existing ledger entries,
including ML/LLM classification, rich PII/i18n, UI, advanced metrics/tuning,
durable traces, semantic contradiction, expiry/compaction execution,
distributed evaluation/rollout/performance, crash recovery, fsync,
backup/restore, object storage/KMS, multi-node locking, sandboxing, provider
mounts, and broad context assembly. Auto-safe remains disabled by default and
model-based gardening is not implemented.

## Release decision

**APPROVED for the minimum scenario evidence package.** This is not a
production readiness claim; post-E2E deferred-hardening triage remains required.
