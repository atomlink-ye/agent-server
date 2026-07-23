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

## Session reset and lane drain

`POST /api/v1/sessions/{session_id}:reset` advances the generation and records a
cancellation request for the active old-generation Task. It does not discard
that active Task or bulk-cancel it; only non-active queued old-generation Tasks
are terminalized with `cancelled_by_reset`. New-generation Messages remain queued
until the active old-generation Run reaches a normal terminal state, after which
the lane promotes the oldest eligible root. Provider cancellation forwarding and
production recovery guarantees are not part of this minimum behavior.

## Run event replay and SSE

Use `GET /api/v1/runs/{run_id}/events?after=0` to inspect the persisted timeline. Resume with `next_cursor`; do not reuse an event sequence already consumed. For live observation, use the authenticated `/events/stream` route with `after` or `Last-Event-ID`. The stream replays committed events, polls the database, and closes after `succeeded`, `failed`, or `cancelled`. This is a single-node MVP polling path, not a production pub/sub or long-disconnect recovery guarantee.

## Task cancellation

Use `POST /api/v1/tasks/{task_id}:cancel`. A queued Task returns `cancelled` after local terminalization; active work returns `cancellation_requested` after the durable request is recorded and one runtime cancel is forwarded. A terminal Task returns `terminal` idempotently. Foreign or missing Tasks intentionally return `404`. Correlate only opaque Task/Run IDs and stable status codes; never copy prompts, provider errors, credentials, or local paths into tickets.

## No free model

This is an expected external dependency failure, not permission to select a paid model. Check the live catalog and OpenCode status. Operators may deliberately configure a known model through `PASEO_MODEL`, but automatic fallback remains free-only. Keep deterministic CI green while external availability is investigated.

## Smoke leaves a process

The script treats a managed PID that survives cleanup as failure. Inspect the printed runtime directory and process tree, stop only the verified child PIDs, then fix signal forwarding/daemon shutdown. Never use a broad kill pattern.

## Suspected credential creation or exposure

Stop the isolated processes, preserve a sanitized path/timestamp, revoke any real credential, and inspect HOME/XDG/Paseo paths. A discovered OpenCode `auth.json` fails the zero-credential claim. Do not commit or share the file.

## CI and external verification

`make ci` is the deterministic Node 24 gate and does not require an external model or database service. The explicit PostgreSQL 16 required lane runs separately with a real `pg.Pool`; a missing database URL is a failure in that lane, not a substitute with an embedded database. Production assembles one default `pg.Pool` with its configured max of 10. The real-PG tests lease separate clients to prove connection visibility and concurrency; that test arrangement does not describe production pool partitioning. External free-model/provider availability is non-deterministic and is verified only by the authenticated smoke.

The smoke uses an ephemeral service-account token only for create/poll, retains zero OpenCode credentials, selects only an explicitly free model, checks the exact marker `PASEO_OPENCODE_BASELINE_OK`, and excludes the token from logs and evidence. The initial authentication failure was resolved by commit `baf8be5`; it is not an open follow-up.

## Managed Agent registry operations

## Product Workspace memory projection

After an accepted proposal, the minimum local projection renders all accepted
Product Workspace entries in stable `accepted_at ASC, entry_id ASC` order. The
FileStore writes `MEMORY.md` and `manifest.json` to a temporary directory,
verifies the SHA-256 rendered-content hash, atomically renames the snapshot
directory, and publishes `latest-ready` only after verification succeeds.

Use the authenticated workspace memory entries/snapshots routes to inspect the
projection and `POST .../memory/snapshots:rebuild` to create the next immutable
version. A hash or write failure marks the projection failed and must not
publish a ready/latest pointer. Public responses contain identifiers, hashes,
versions, and status only; never a local path. This is an MVP local projection:
fsync, KMS, object storage, backup/restore, multi-node locking, crash fallback,
and production durability guarantees are deferred.

For Fresh Session recall, inspect the admitted Task's pinned snapshot ID/hash,
not the current latest pointer. The local FileStore must verify the exact
tenant/workspace/snapshot directory, manifest hash, rendered content hash, and
expected Task hash. Missing or mismatched content fails the Run safely; never
fall back to latest, scan the Workspace, reveal a path, or include hash/path
details in the public error.

## Memory policy evaluation

`auto_safe` remains disabled by default. `make eval-smoke` runs the versioned
deterministic memory-policy dataset and prints only aggregate JSON. The gate
requires zero `unsafe_auto_accepts`, `rejected_memory_leaks`,
`cross_workspace_leaks`, and `secret_exposures`. This is an evaluation and
policy-safety boundary, not a production rollout claim; there is no model-based
gardener or automatic enablement.

Migration `0005_managed_agent_registry_b` is forward-only. Apply the complete
migration set in order; reruns must not rewrite published versions or reset
idempotency state. If a migration stops part-way, preserve only the sanitized
migration error and database identifier, verify the schema version, and rerun
the normal migration command after the database issue is fixed. Do not manually
delete rows or edit published data. Rollback means deploying the prior
application revision while retaining the additive `0005` schema and data for
forward recovery. There is no runtime route/resolver feature flag and no
destructive down migration.

The deterministic lane uses PGlite for fast single-process behavior. Independent
required PostgreSQL 16 jobs use real `pg.Pool` connections for concurrency,
locks, and database-enforced immutability. Run the exact real database lane:

```bash
make test-real-pg
```

When `DATABASE_URL` is absent, ordinary deterministic integration may skip the
real-PG tests, but the required PostgreSQL CI job must fail rather than
substitute PGlite. Keep those jobs independent.

For ownership failures, correlate only with redacted or one-way hashed
owner-scope tokens: managed lookup uses tenant plus principal, while the
authenticated workspace is only a legacy import snapshot. Use a safe request
correlation and a one-way hashed version correlation when needed; an existing
request ID is safe only when it is already opaque or redacted. Never record raw
tenant, principal, workspace, request body, idempotency key, or version
identifier in logs or evidence. For idempotency failures, compare a one-way
hash of the request key and canonical fingerprint without printing request
bodies. For cursor failures, verify opaque cursor handling, ascending
`(created_at, id)` ordering, strict advancement, and page bounds. Never put raw
YAML, prompts, secrets, credentials, filesystem paths, or raw provider errors
in logs or evidence. A future `re2js` compiler upgrade requires a new package
version and compiler snapshot.

## Recovery boundary

The current admission and Run state is PostgreSQL-backed, but durable runtime receipt storage and reconciliation are not implemented. If runtime succeeds and terminal persistence fails, the typed `RunCompletionPersistenceError` produces only an ephemeral receipt and sanitized structured log; the Run may remain `running` until later recovery. Stop automated retry for the affected work, preserve only sanitized logs and relevant IDs, and escalate to the owning orchestration operator. Do not claim receipt retrieval, reconciliation, or `runtime_execution_failed`. Durable receipt storage and broader recovery remain deferred. Multi-node workers/reconcilers are not part of the minimum runtime event lane.
