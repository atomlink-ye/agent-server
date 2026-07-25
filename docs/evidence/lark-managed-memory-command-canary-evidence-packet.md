# Lark Managed Memory command canary evidence packet

## Scope

This packet records the fixed command-only compatibility baseline: one
`agent-test` App/group/user and one service-account ownership tuple. It does not
claim canonical Lark identity, production readiness, Card/Doc review, crash
recovery, multi-node leadership, or physical exactly-once delivery.

## Deterministic evidence

- `e2e/lark-memory-command.e2e.test.ts` proves source root → successful Run →
  source-provenance proposal → review notification → `/memory edit-and-accept`
  → accepted Entry → ready snapshot → second root/Fresh Session → exact
  snapshot ID/hash pin → prompt recall.
- Provider-message replay does not duplicate Runs, outboxes, attempts, or review
  materialization.
- The fixture opts into a managed published AgentVersion with
  `workspace_snapshot` memory and proposal limit 2; legacy fixture versions
  intentionally resolve proposal limit 0.
- Under Node `v24.18.0` / pnpm `11.7.0`, focused Lark E2Es passed twice together
  (2 files / 2 tests).

## Repository and external gates

- `make ci` passed: docs 75 files; Exec Plans 15; unit 53 files / 246 tests;
  contract 7 / 71; deterministic integration 9 passed + 6 skipped, 123 passed
  - 33 skipped; E2E 5 files / 7 tests; build passed.
- Fresh caller-provided PostgreSQL acceptance database passed 6 files / 72
  tests. An earlier stale developer database failed because it contained an
  unreleased migration shape; that run is non-acceptance evidence and required
  no production change.
- `make eval-smoke` passed 13 cases with unsafe/leak counters zero.
- `make paseo-smoke` passed with the free OpenCode model and marker
  `PASEO_OPENCODE_BASELINE_OK`.

## Real Lark evidence

- Agent Server was the sole consumer. A real Agent generated a source-provenance
  proposal and the command review path delivered feedback.
- Thread `edit-and-accept` used marker
  `LARK_REAL_MEMORY_ACCEPTED_20260725_0039`.
- Ready snapshot `d81ab128…` had full content hash
  `07f3b8e86b1f238952603c3f6ee47d57a8e4db5d894d4601b79a5282834baa4d`.
- A second Fresh Session pinned that exact snapshot ID/hash and the real Agent
  recalled the marker.
- Durable result: 2 Sessions, 2 bindings, 2 succeeded Runs, and 4 delivered
  outboxes/attempts. The worker shut down gracefully.

## Evidence hygiene and limits

No credentials, bearer tokens, App Secrets, raw events, raw provider errors,
prompts, local paths, or local smoke evidence paths are included here. Outbox
attempts provide durable evidence and bounded provider UUID replay; they do not
prove physical exactly-once delivery. Card/Doc review, crash recovery,
multi-node leadership, extra redrive/fault injection, performance, and polish
remain deferred.
