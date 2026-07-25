---
status: active
owner: orchestrator
created_at: 2026-07-25
updated_at: 2026-07-25
authority: execution-plan
---

# Lark Memory Task 14 Hardening Follow-up

## Boundary

Task 14 implementation was explicitly cancelled for the current PR. Current
command + Card/Doc code ships after documentation/code hygiene. This plan keeps
deferred hardening visible and must not be read as evidence that any item is
complete.

## Deferred work

- [ ] Add exact Preview successor `savePreview` lease/attempt fencing. After
      authorization, if synthesis spans lease expiry and another worker reclaims
      the ingress, a stale worker must not commit a successor. Add the exact
      takeover regression test.
- [ ] Add post-canonical ingress retry/fencing.
- [ ] Prove manual snapshot rebuild versus concurrent Accept behavior.
- [ ] Resolve rolling-upgrade workspace allocator races.
- [ ] Add generalized synthesis retry/audit state only if required by a later
      acceptance boundary.
- [ ] Add crash/restart and fault-injection coverage.
- [ ] Add multi-node leadership/recovery hardening.
- [ ] Add performance/load hardening proportionate to a future rollout decision.

## Baseline facts to revalidate, not undone work

The following earlier findings were already implemented before this transfer and
must be revalidated by future work rather than treated as open regressions:

- retryable outbox ambiguity uses `delivery_unknown` handling;
- Lark Session AgentVersion validation checks exact Workspace equality;
- UTF-8 truncation is byte-safe; and
- stale `lark-memory-smoke` wording was corrected.

## Acceptance and evidence boundary

Task 12 deterministic normal-path E2E used fresh caller-provided PostgreSQL with
fake Lark/runtime. Task 13 real-provider normal-path evidence is recorded in the
Card/Doc evidence packet. Neither establishes canonical Lark identity,
production readiness, physical exactly-once delivery, multi-node leadership, or
full crash recovery.

Do not start this plan for the current PR without a new explicit execution
decision. When resumed, add focused RED tests, affected integration evidence,
fresh PostgreSQL contention evidence where relevant, and final Node 24 gates.
