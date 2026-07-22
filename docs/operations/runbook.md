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

## Recovery boundary

Baseline Runs are in memory and cannot be recovered after API restart. Do not relabel a lost Run as succeeded. Durable recovery begins only after the Task/Run kernel phase in the [roadmap](../roadmap.md).
