# Baseline operations runbook

This runbook covers the current Prove/MVE local and verification boundaries. It is not a production SLO, deployment, or incident-response contract.

## API is not live

1. Start host-native core development with `pnpm setup && pnpm dev`.
2. Run `pnpm doctor` and check `HOST`/`PORT` conflicts.
3. Call `/health/live`; liveness does not depend on Paseo.
4. Use `pnpm test:contract` when the question is public request/response behavior rather than local process state.
5. Stop the owned host processes.

For a one-off diagnostic command that needs the execution runtime, use its
bounded host-native smoke command rather than creating a setup script.

## Runtime readiness returns 503

Inspect the named readiness checks and separate control-plane health from execution-plane/provider health.

- `paseo_websocket`: verify daemon reachability, configured URL, and process lifetime.
- `paseo_workspace`: verify the configured runtime directory is usable.
- `opencode_model`: verify provider/toolchain availability, selected provider/model, network/proxy state, and current external catalog availability.

Use the canonical external runtime smoke only when real provider behavior is the boundary under investigation:

```bash
pnpm smoke:runtime
```

Real provider/model availability is external state. Never weaken the deterministic gate or silently choose a paid model because a free provider is temporarily unavailable.

## Provider and model selection

`PASEO_PROVIDER` is an operator/runtime setting. Host-native runtime setup may
provide a default; HTTP callers do not choose arbitrary models. Preserve safe
error normalization and never copy raw provider errors or credentials into
retained diagnostics.

## Run fails or times out

Correlate the durable `run_id` and normalized Run events. Distinguish control-plane persistence, execution-plane connectivity, provider catalog/startup, and generation timeout before increasing timeouts. Raw provider output remains local diagnostic material under ignored `.local/test-runs/` when needed.

## Task cancellation

Use `POST /api/v1/tasks/{task_id}:cancel`. Queued work may terminalize locally; active work records the durable cancellation intent and forwards cancellation through the runtime boundary when supported. Terminal work is idempotent. Foreign or missing resources remain owner-safe `404`.

## Session reset and lane drain

`POST /api/v1/sessions/{session_id}:reset` advances generation and requests cancellation for the active old-generation Task. It does not imply distributed recovery. Non-active queued old-generation work may be terminalized according to the current lane rules; new-generation work remains governed by the durable lane.

## Run event replay and SSE

Use `GET /api/v1/runs/{run_id}/events?after=0` for persisted timeline replay and the authenticated stream route for live observation. Resume from the returned cursor/`Last-Event-ID`; do not infer production pub/sub, retention, or long-disconnect guarantees from the current single-node polling path.

## Local Web

The Web service is part of the host-native development path:

```bash
pnpm web:bootstrap
pnpm dev
```

Use a fresh ProductSession for product-flow verification. Keep the service bearer server-side and never capture tokens in screenshots, logs, recordings, or committed files. Generated browser diagnostics belong under ignored `.local/test-runs/<run-id>/` or a CI artifact.

## Real PostgreSQL behavior

PGlite remains the default for integration behavior that does not require PostgreSQL-specific semantics. Transaction/lock/concurrency/migration/PostgreSQL-specific behavior uses:

```bash
pnpm test:real-pg
```

The test lane starts a disposable PostgreSQL topology automatically when no external database URL is supplied. A focused real-Postgres test can also self-start when invoked directly. Do not replace a required real-Postgres boundary with PGlite merely to obtain a pass.

## Agent Team runtime verification

The canonical real Team verification is semantically named and intentionally small:

```bash
pnpm smoke:agent-team
```

It proves only the bounded current collaboration flow exercised by that smoke. It does not imply generalized dynamic rosters, restart recovery, retries, reconciliation, or production readiness.

The public Team registry and Work lineage can be checked with an external HTTP
actor (without invoking Tasks or TeamRun projections):

```bash
SMOKE_OUTPUT_FILE=.local/team-registry-work.ndjson pnpm smoke:team-registry-work
```

The actor creates and publishes its own two Agents and Environment, creates
distinct published Teams A and B, verifies their public version specs differ,
creates a Work and WorkRun from Team A, reads its successful trace projection,
and verifies a Work using unpublished Team C is rejected with
`invalid_work_definition`. Authorization is redacted in the local record;
request and response bodies, headers, and statuses are retained.

## Memory policy evaluation

Probabilistic/policy evaluation is separate from deterministic tests:

```bash
pnpm eval:memory
```

Eval results are generated output. Do not commit them as evidence packets.

## Migration and recovery utilities

Operator utilities live under `scripts/ops/` rather than CI/test harness directories. Apply additive migrations through the supported migration utility; do not manually rewrite published/durable data to repair a local test. Recovery inspection remains bounded and should avoid automatic retries when runtime-side effects are uncertain.

## Suspected credential exposure

Stop the isolated owned processes, revoke any real credential, and inspect local runtime/provider homes without copying secret-bearing files into Git, issues, or logs. Preserve only sanitized correlation and timing information.

## CI and external verification

`pnpm run verify` is the main deterministic aggregate. `pnpm test:real-pg` is the PostgreSQL-specific lane. Real provider smokes are opt-in/scheduled external checks. Report only commands that actually ran and their actual outcomes.

## Generated diagnostics and cleanup

Temporary test/runtime diagnostics belong in `.local/test-runs/<run-id>/`. Successful runs may clean them; `TEST_KEEP_FAILED=1` may retain failed diagnostics locally. Stop only resources owned by the current environment run and avoid broad kill/delete patterns.
