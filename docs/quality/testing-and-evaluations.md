# Testing and evaluations

## Test philosophy

The repository separates deterministic checks from externally variable model/runtime evidence. During Prove, automated tests are an optional protection tool, not a default feature deliverable: use an existing focused check when it cheaply protects the claim, and use the representative real path as primary evidence. New tests, full deterministic suites, and CI become required only when the user names that gate, a Human Gate needs them, or the work has explicitly moved to Protect/Harden. A separate smoke can observe the pinned SDK/process/provider path when that boundary is in scope.

## Current suites

### Unit

`make test-unit` covers Task and Run invariants, idempotency conflict handling, dispatcher readiness/lifecycle behavior, config defaults and validation, structured logging, free-model priority/fallback, explicit operator override, refusal to auto-select unmarked paid models, and Paseo terminal-state mapping.

### HTTP contract

`make test-contract` covers liveness/readiness, request IDs, `202` creation, `Idempotency-Key` replay and conflict semantics, missing/unknown fields, caller model rejection, 64 KiB body limit, runtime-unavailable `503` for new work, unknown Run `404`, terminal response schema, and prompt absence.

### Component integration

`make test-integration` covers both durable-kernel and runtime-adapter seams. It verifies PostgreSQL migration replay, durable admission, idempotency, enqueue, atomic claim, fenced completion, stale-writer rejection, dispatcher execution, plus the existing fake-`PaseoClientPort` adapter checks for initialization, Workspace reuse, usage/result translation, timeout, and provider error.

For the managed registry, PGlite is the deterministic role: it proves parser,
application, migration replay, and ordinary repository transitions quickly. The
real `pg.Pool` role is separate evidence for Protect/Harden, release, or a Human Gate on PostgreSQL 16; it is not a default Prove-stage gate. It proves
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

### Real smoke debugging order

For a new real smoke path, debug in one reusable environment with short
timeouts before running the full smoke. Reuse the same project, Project Lock,
database, and root-task queries throughout the loop:

1. manually or stepwise verify setup/apply;
2. verify Lead kickoff;
3. verify member creation and completion;
4. verify Lead finalization and root completion;
5. run a short `watch` to verify observation and convergence.

Only after every stage passes should the overall smoke run once as the phase
acceptance check. Do not repeatedly pay for an opaque long-running end-to-end
script while debugging a single stage. Query existing state and reuse the
existing root task rather than causing duplicate model calls.

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

## Managed single-agent release evidence

The Phase H packet records fresh Node24 deterministic, PostgreSQL16,
separate real-ephemeral-socket E2E, Paseo/OpenCode, evaluation, fault,
in-process transcript-contract, and dry-run inspection evidence. It is approved
for the minimum scenario; passing evidence is not a production readiness claim.

Real-PG tests may skip only in the ordinary local deterministic suite when
`DATABASE_URL` is absent. They are not an acceptable skip in required
PostgreSQL 16 CI.
