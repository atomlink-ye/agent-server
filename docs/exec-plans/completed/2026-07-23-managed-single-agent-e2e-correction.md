---
title: Managed Single-Agent real-socket E2E correction
status: completed
date: 2026-07-23
---

# Managed Single-Agent real-socket E2E correction

## Objective

Correct blocker-level gaps found after the first full real-socket E2E
implementation and produce honest E2E-01 through E2E-09 evidence for the fixed
canary.

## Scope completed

- Run-scoped, bounded Paseo memory-candidate artifact parsing, gated so direct
  compatibility smoke prompts are not polluted by the artifact contract.
- Immutable Message/Task/Run/AgentVersion/candidate-index proposal provenance.
- Transactional, replay-idempotent candidate materialization per Run/index, with
  relationship validation and real PostgreSQL mismatch coverage.
- Minimum published memory-policy bounds and Workspace-scoped proposal listing.
- Database-arbitrated active cancellation, terminal-event ownership, and required
  real PostgreSQL cancellation race coverage.
- Real socket SSE disconnect/reconnect, queue/cancel/reset/recovery,
  version-pinning, owner isolation, bidirectional Workspace isolation, and fixed
  canary recall evidence.
- Node 24 gates, required runtime smoke, eval smoke, and evidence updates.

## Explicit deferrals

- General candidate outbox/import worker and multi-node recovery.
- Exactly-once model or tool execution; only candidate materialization is
  idempotent.
- Semantic/global candidate deduplication and rich source-trust analysis.
- Provider-native reusable sessions and durable external-effect receipts.
- Strong filesystem sandboxing against a hostile same-UID process; separate
  UID/container/openat-class containment is future hardening.

## Work

- [x] Implement and test production runtime memory correctness.
- [x] Pass independent data-integrity review.
- [x] Complete fixed-canary real-socket evidence.
- [x] Pass independent E2E evidence review.
- [x] Run focused and full Node 24 verification, including runtime smoke.
- [x] Update evidence/docs and move this plan to `completed/`.

## Final verification

Fresh Node 24 (`v24.18.0`) verification after the final Paseo adapter smoke fix:

- `make ci`: unit 159, contract 71, deterministic integration 84 with 28
  expected real-PG skips, E2E 5, build/checks green.
- `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/agent_server_test make test-real-pg`:
  67/67 passed.
- `make paseo-smoke`: provider `opencode`, model
  `opencode/mimo-v2.5-free`, terminal succeeded, marker
  `PASEO_OPENCODE_BASELINE_OK`.
- `make eval-smoke`: 13 cases; all zero-tolerance counters 0.

## Review closure

- Phase 1 data-integrity review advanced after provenance, replay, policy,
  trigger, and real PostgreSQL coverage were closed.
- Cancellation review advanced after terminal events became projection-last,
  cancellation timestamps became monotonic, required real-PG coverage included
  cancellation races, and repeated-cancel/runtime-cancel behavior was proven.
- Phase 2 E2E review advanced after reset assistant linkage and bidirectional
  Workspace isolation were closed.

## Recovery notes

- Baseline before socket work: `5c3e760`.
- Initial socket/runtime-candidate commits: `c8f5b67..4b43fcc`.
- Independent SSE correction: `764b669`.
- Final evidence head before documentation closeout: `9cde3a9`.
