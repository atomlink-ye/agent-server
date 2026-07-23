# Baseline operations runbook

## API is not live

1. Run `make dev-api` and inspect structured `service.started` or configuration failure.
2. Check `HOST`/`PORT` and local port conflicts.
3. Call `/health/live`; liveness does not depend on Paseo.
4. Run `make test-contract` to separate code regression from environment state.

## Readiness returns 503

Inspect the named checks:

- `paseo_websocket`: verify daemon health/log, URL, port, and process lifetime.
- `paseo_workspace`: verify the configured directory is writable and Paseo can open it.
- `opencode_model`: verify the platform binary, model catalog, operator override, network/proxy, and current free-model availability.

Run `node scripts/dev/resolve-opencode.mjs --check`, then `make paseo-smoke`. Read the ignored daemon/API logs under the evidence path printed by the smoke. Do not paste raw logs into an issue before checking them for prompts or environment data.

If one free model is externally rate-limited, an operator may diagnose another catalog entry with `PASEO_SMOKE_MODEL=opencode/<explicit-free-id> make paseo-smoke`. The smoke rejects an override whose identifier is not explicitly free; this is a diagnostic override, not an automatic paid fallback.

## Run fails or times out

Baseline GET returns a stable code only. Correlate `run_id` in structured logs. A timeout may be catalog/model cold start, network latency, or provider capacity. Do not increase the timeout until daemon health, model discovery, and generation phases are distinguished. Raw provider errors remain local diagnostics.

## No free model

This is an expected external dependency failure, not permission to select a paid model. Check the live catalog and OpenCode status. Operators may deliberately configure a known model through `PASEO_MODEL`, but automatic fallback remains free-only. Keep deterministic CI green while external availability is investigated.

## Smoke leaves a process

The script treats a managed PID that survives cleanup as failure. Inspect the printed runtime directory and process tree, stop only the verified child PIDs, then fix signal forwarding/daemon shutdown. Never use a broad kill pattern.

## Suspected credential creation or exposure

Stop the isolated processes, preserve a sanitized path/timestamp, revoke any real credential, and inspect HOME/XDG/Paseo paths. A discovered OpenCode `auth.json` fails the zero-credential claim. Do not commit or share the file.

## CI and external verification

`make ci` is the deterministic Node 24 gate and does not require an external model or database service. The explicit PostgreSQL 16 required lane runs separately with a real `pg.Pool`; a missing database URL is a failure in that lane, not a substitute with an embedded database. The admission pool is max 2 and the separate reader pool is max 2. External free-model/provider availability is non-deterministic and is verified only by the authenticated smoke.

The smoke uses an ephemeral service-account token only for create/poll, retains zero OpenCode credentials, selects only an explicitly free model, checks the exact marker `PASEO_OPENCODE_BASELINE_OK`, and excludes the token from logs and evidence. The initial authentication failure was resolved by commit `baf8be5`; it is not an open follow-up.

## Managed Agent registry operations

Migration `0005_managed_agent_registry_b` is forward-only. Apply the complete
migration set in order; reruns must not rewrite published versions or reset
idempotency state. If a migration stops part-way, preserve only the sanitized
migration error and database identifier, verify the schema version, and rerun
the normal migration command after the database issue is fixed. Do not manually
delete rows or edit published data. Rollback means disabling managed routes and
the managed-first resolver while retaining schema and data for forward recovery;
there is no destructive down migration.

The deterministic lane uses PGlite for fast single-process behavior. Independent
required PostgreSQL 16 jobs use real `pg.Pool` connections for concurrency,
locks, and database-enforced immutability. Run the exact real database lane:

```bash
make test-real-pg
```

When `DATABASE_URL` is absent, ordinary deterministic integration may skip the
real-PG tests, but the required PostgreSQL CI job must fail rather than
substitute PGlite. Keep those jobs independent.

For ownership failures, verify only tenant, principal, workspace snapshot, and
version identifier from sanitized metadata. Managed lookup uses tenant plus
principal; legacy fallback additionally uses the authenticated workspace. A
managed draft intentionally blocks fallback. For idempotency failures, compare
the request key and canonical fingerprint without printing request bodies. For
cursor failures, verify opaque cursor handling, ascending `(created_at, id)`
ordering, strict advancement, and page bounds. Never put raw YAML, prompts,
secrets, credentials, filesystem paths, or raw provider errors in logs or
evidence. A future `re2js` compiler upgrade requires a new package version and
compiler snapshot.

## Recovery boundary

The current admission and Run state is PostgreSQL-backed, but durable runtime receipt storage and reconciliation are not implemented. If runtime succeeds and terminal persistence fails, the typed `RunCompletionPersistenceError` produces only an ephemeral receipt and sanitized structured log; the Run may remain `running` until later recovery. Stop automated retry for the affected work, preserve only sanitized logs and relevant IDs, and escalate to the owning orchestration operator. Do not claim receipt retrieval, reconciliation, or `runtime_execution_failed`. Durable receipt storage belongs to Phase D migration 0007, with broader recovery in Phase H. Multi-node workers/reconcilers are not a Phase A goal.
