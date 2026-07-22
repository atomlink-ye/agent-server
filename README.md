# Agent Server

Agent Server is an enterprise control-plane project for long-lived agents and bounded agent teams. Paseo remains the leaf-agent runtime; this repository owns stable product identities, task/run semantics, policy, evidence, channels, and eventually durable orchestration around it.

The current repository is a **walking-skeleton baseline**, not the V1 platform. It proves one replaceable path end to end:

```mermaid
flowchart TD
    A["POST /api/v1/runs"] --> B["Run application service"]
    B --> C["In-memory run repository"]
    B --> D["AgentRuntimePort"]
    D --> E["Paseo adapter"]
    E --> F["OpenCode free model"]
    F --> C
    G["GET /api/v1/runs/:id"] --> C
```

## Baseline status

| Capability                                 | Current state                          |
| ------------------------------------------ | -------------------------------------- |
| HTTP liveness/readiness                    | Implemented                            |
| Asynchronous Run API                       | Implemented                            |
| Paseo WebSocket adapter                    | Implemented                            |
| OpenCode free-model discovery              | Implemented                            |
| Explicit reusable Paseo Workspace          | Implemented                            |
| In-memory Run storage                      | Baseline-only                          |
| Deterministic CI                           | Implemented; no model network calls    |
| Zero-model-credential external smoke       | Implemented; optional/manual/scheduled |
| Durable Task/Run, queue, lease, fence      | Planned V1                             |
| Tenant, identity, credentials, approval    | Planned V1                             |
| Agent/Team definitions and graph execution | Planned V1                             |
| Artifacts, evidence, Lark, Web console     | Planned V1                             |

## Quick start

Requirements: Node.js 22–24, Corepack, Linux or macOS on x64/arm64, and network access for the real OpenCode smoke.

```bash
make setup
make ci
make paseo-smoke
```

`make ci` is deterministic and does not call an external model. `make paseo-smoke` starts isolated Paseo and Agent Server processes, allowlists only non-secret runtime/network environment variables, dynamically selects an explicitly free OpenCode model, and expects the exact marker `PASEO_OPENCODE_BASELINE_OK`.

Start the local stack:

```bash
make dev
```

Submit and poll a run:

```bash
curl -sS http://127.0.0.1:3000/api/v1/runs \
  -H 'content-type: application/json' \
  -d '{"prompt":"Reply with exactly: HELLO"}'

curl -sS http://127.0.0.1:3000/api/v1/runs/<run_id>
```

The API does not accept a caller-selected model. Operators may set `PASEO_MODEL`; otherwise the adapter chooses from the live catalog and never automatically falls back to an unmarked paid model.

## Canonical commands

| Command            | Purpose                                                             |
| ------------------ | ------------------------------------------------------------------- |
| `make setup`       | Install locked dependencies and verify the platform OpenCode binary |
| `make dev`         | Start isolated Paseo plus the API                                   |
| `make dev-api`     | Start only the API; Paseo must already be available                 |
| `make check`       | Types, formatting, documentation, and Exec Plan checks              |
| `make test`        | Unit, contract, and component-integration tests                     |
| `make e2e-smoke`   | Real HTTP socket with a deterministic fake runtime                  |
| `make paseo-smoke` | Real Paseo/OpenCode/free-model external smoke                       |
| `make ci`          | All deterministic pull-request gates                                |
| `make clean`       | Remove generated and isolated local output                          |

## Documentation map

- [Product](docs/product.md): users, value, scope, and release boundary.
- [Features](docs/features.md): authoritative capability ledger and status.
- [Components](docs/components.md): ownership and implementation boundaries.
- [Architecture](docs/architecture.md): domain, execution, recovery, and security direction.
- [Contracts](docs/contracts.md): Run, health, and runtime interfaces.
- [Quality](docs/quality.md): test taxonomy, release gates, and evidence.
- [Operations](docs/operations.md): local development and incident runbook.
- [Decisions](docs/decisions.md): accepted architectural decisions.
- [Agent handbook](docs/agents.md): mandatory workflow for coding agents.
- [Exec Plans](docs/exec-plans.md): active-to-completed work protocol.
- [Roadmap](docs/roadmap.md): sequence from this baseline to V1.

The repository documentation is self-contained. The legacy `backup` branch and external research may be consulted as evidence, but neither is an implementation dependency or a source to copy wholesale.

## Baseline limitations

- Runs disappear when the process restarts.
- There is no authentication, tenant boundary, idempotency key, cancel, retry, streaming, or artifact service yet.
- Runtime execution is one in-process asynchronous callback, not a durable queue.
- Free OpenCode models and their availability can change; therefore the external smoke is not a required pull-request gate.
- The adapter exposes only the minimum contract required to prove the seam. V1 runtime compatibility work is tracked in the roadmap.

See [Security](SECURITY.md) before deploying or connecting real credentials. This baseline is for local development and architecture validation only.
