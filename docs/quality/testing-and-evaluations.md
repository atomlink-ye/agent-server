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

### Deterministic E2E

`make e2e-smoke` binds Hono to a real ephemeral TCP port and follows `POST → poll → succeeded` through the real route, durable admission/dispatch path, and fake Runtime Port.

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

## Future evaluations

Evals begin when there is a stable Agent definition and Artifact contract. Versioned datasets should measure task completion, citation validity, source coverage, structured-output validity, Artifact acceptance, latency/cost, safety-policy compliance, and Team value relative to a single-Agent baseline. Record model/runtime/version/prompt/tool/source snapshots so results are comparable.

`make eval-smoke` intentionally reports skipped until that real boundary exists; a placeholder must never report a false pass.
