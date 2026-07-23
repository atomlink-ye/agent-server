# Testing and evaluations

## Test philosophy

The repository separates deterministic product correctness from externally variable model/runtime availability. Pull requests must prove state, contracts, error safety, and adapter translation without network access. A separate smoke proves the pinned SDK/process/provider path. Future behavior evaluations judge research usefulness and evidence quality without replacing ordinary tests.

## Current suites

### Unit

`make test-unit` covers Task and Run invariants, idempotency conflict handling, dispatcher readiness/lifecycle behavior, config defaults and validation, structured logging, free-model priority/fallback, explicit operator override, refusal to auto-select unmarked paid models, and Paseo terminal-state mapping.

### HTTP contract

`make test-contract` covers liveness/readiness, request IDs, `202` creation, `Idempotency-Key` replay and conflict semantics, missing/unknown fields, caller model rejection, 64 KiB body limit, runtime-unavailable `503` for new work, unknown Run `404`, terminal response schema, and prompt absence.

### Component integration

`make test-integration` covers both durable-kernel and runtime-adapter seams. It verifies PostgreSQL migration replay, durable admission, idempotency, enqueue, atomic claim, fenced completion, stale-writer rejection, dispatcher execution, plus the existing fake-`PaseoClientPort` adapter checks for initialization, Workspace reuse, usage/result translation, timeout, and provider error.

For the managed registry, PGlite is the deterministic role: it proves parser,
application, migration replay, and ordinary repository transitions quickly. The
real `pg.Pool` role is separate and required on PostgreSQL 16: it proves
multi-connection visibility, import/publish races, owner hiding, database
immutability, and cursor traversal with tied `(created_at, id)` values. The
registry matrix covers idempotency replay/conflict, equal-canonical convergence,
concurrent imports and publication, foreign-owner hiding, database rejection of
published mutation, and strict multi-page cursor traversal without skips or
duplicates.

### Deterministic E2E

`make e2e-smoke` binds Hono to a real ephemeral TCP port and follows `POST → poll → succeeded` through the real route, durable admission/dispatch path, and fake Runtime Port.

HTTP contract security tests cover managed import/publish owner hiding,
published-only canonical Task admission, explicit version pinning,
secondary-owner rejection, idempotency, safe errors, and absence of
package/model/template fields from public responses. Managed runtime-input
execution and legacy fallback/Team preservation are proven by focused
application/unit evidence, not by HTTP contract tests.

### External Paseo/OpenCode smoke

`make paseo-smoke`:

1. selects the pinned platform OpenCode package;
2. creates isolated HOME/XDG/Paseo/workspace paths;
3. allowlists only non-secret runtime, proxy, certificate, and locale variables;
4. disables relay, Web UI, MCP injection, dictation, and voice;
5. starts Paseo and waits for daemon health;
6. starts Agent Server and waits for runtime readiness;
7. submits an exact-response prompt;
8. asserts `opencode`, an explicitly free model ID, `succeeded`, and the exact marker;
9. verifies no OpenCode `auth.json` exists;
10. stops managed process groups and writes ignored local evidence.

`PASEO_SMOKE_MODEL` may select a different catalog model for rate-limit diagnosis, but its identifier must be explicitly free. With no override, the adapter uses the ordinary automatic free-model policy.

External free models, network, and rate limits are not stable enough for a mandatory PR gate. A failure must distinguish installation, daemon health, model discovery, Agent creation, generation, contract, and cleanup.

## Future durability and security tests

- State-machine model/property tests for broader Task, Run, Team graph, approval, cancel, and retry behavior.
- Multi-process and real-PostgreSQL fault tests for lease expiry, competing workers, restart recovery, and migration-on-upgrade behavior beyond the current deterministic PGlite coverage.
- Kill/restart and network-partition fault injection at claim, tool side effect, Artifact registration, completion, and delivery.
- Duplicate/out-of-order child completion and event replay.
- Cross-tenant and private-credential adversarial tests.
- Receipt-driven safe retry versus immutable unknown-side-effect outcomes.

## Deterministic memory policy evaluation

The minimum Phase G evaluation is the versioned dataset at
`docs/evaluations/managed-single-agent-v1-memory-dataset.json`. The exact gate
is `make eval-smoke`; it prints aggregate JSON only, including `cases` and the
zero-tolerance counters `unsafe_auto_accepts`, `rejected_memory_leaks`,
`cross_workspace_leaks`, and `secret_exposures`. The gate exits nonzero unless
all four counters are zero. It does not print candidate content, prompts,
secrets, paths, or provider data. Auto-safe remains disabled by default.

Broader evaluations should eventually measure task completion, citation
validity, source coverage, structured-output validity, Artifact acceptance,
latency/cost, and Team value relative to a single-Agent baseline, but are not
part of this deterministic policy gate.

`make eval-smoke` intentionally reports skipped until that real boundary exists; a placeholder must never report a false pass.

## Draft managed single-agent release evidence

The Phase H draft packet records fresh Node24 deterministic, PostgreSQL16,
real-socket, Paseo/OpenCode, evaluation, fault, transcript, and dry-run
inspection evidence. It remains `PENDING` until blocker-only Oracle review and
archive; passing evidence is not a production readiness claim.

Real-PG tests may skip only in the ordinary local deterministic suite when
`DATABASE_URL` is absent. They are not an acceptable skip in required
PostgreSQL 16 CI.
