# ADR 0007: Managed Single-Agent Scenario V1 narrow release boundary

Status: **DRAFT — pending H-6 final review**

## Decision

The A–H milestone is documented as a narrow managed single-agent scenario:
immutable published AgentVersion, owner-visible Product Workspace and Fresh
ProductSession, durable Task/Run admission, queue/claim/fence, normalized
events/SSE, cancellation/reset minimums, governed memory proposals, verified
local immutable snapshots, pinned Fresh Session context, deterministic memory
policy evaluation, and dry-run recovery inspection.

## Boundaries and decisions

- Product ownership and tenant/principal authorization remain explicit; foreign
  resources are hidden.
- Fresh Session admission pins an exact ready snapshot ID/hash; execution never
  substitutes a newer snapshot.
- The minimum context order is fixed header, published instructions, current
  Task input, and pinned verified memory only.
- The FileStore is local and verified; public surfaces never expose local paths.
- Memory policy is deterministic and default-off. `proposal` preserves the
  manual governance path; `auto_safe` is not enabled for release.
- Gardener behavior is proposal-only and never mutates durable history.
- Recovery inspection is dry-run and non-mutating.
- Additive migration history is retained through 0008, including 0005b.

## Non-goals

This ADR does not approve production durability, fsync, crash fallback,
receipt reconciliation, backup/restore, object storage/KMS, multi-node locking,
sandboxing, provider-native mounts, broad context assembly, retrieval/RAG,
model-based gardening, auto-safe rollout, UI, or distributed operations.

## Evidence and release status

The draft evidence packet records fresh Node24 deterministic, PostgreSQL16,
real-socket, Paseo/OpenCode, evaluation, and dry-run inspection results. Final
release status remains **PENDING** until H-6 blocker-only Oracle review and
archive steps are complete.
