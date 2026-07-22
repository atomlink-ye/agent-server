# Paseo Runtime Adapter component

## Purpose

The adapter is the only place where control-plane code knows Paseo SDK and OpenCode provider details. It translates a leaf execution request into one Paseo Agent, waits for a normalized terminal outcome, and returns provider/model/text/usage without leaking raw wire events.

## Baseline implementation map

| Concern                 | Code                                                                       |
| ----------------------- | -------------------------------------------------------------------------- |
| Application boundary    | [`AgentRuntimePort`](../../src/application/ports/agent-runtime.ts)         |
| Paseo SDK seam          | [`PaseoClientPort`](../../src/adapters/paseo/paseo-client-port.ts)         |
| Lifecycle and execution | [`PaseoRuntimeAdapter`](../../src/adapters/paseo/paseo-runtime-adapter.ts) |
| Free-model policy       | [`model-selector.ts`](../../src/adapters/paseo/model-selector.ts)          |
| Terminal mapping        | [`status-mapper.ts`](../../src/adapters/paseo/status-mapper.ts)            |
| Process isolation       | [`paseo-process.mjs`](../../scripts/dev/paseo-process.mjs)                 |
| Live verification       | [`paseo-opencode.mjs`](../../scripts/smoke/paseo-opencode.mjs)             |

## Initialization

The adapter connects once, opens a configured filesystem directory, assigns an explicit Workspace title, reads the live OpenCode model catalog, and caches one selected model. Concurrent calls share the same initialization promise and Workspace. A failed initialization can be retried; readiness exposes WebSocket, Workspace, and model checks.

Automatic selection prefers known free model IDs and may fall back only to another catalog entry explicitly marked free in its ID, label, or description. `PASEO_MODEL` is an operator override and must exist in the catalog. HTTP callers cannot set it.

## Execution

For each baseline Run the adapter creates a Paseo Agent with provider `opencode`, mode `build`, selected model, explicit Workspace, prompt, and non-secret labels. `idle` maps to success, `timeout` to a stable timeout error, and `error|permission` to a stable execution failure. The API stores a safe error envelope rather than the provider exception.

## Process boundary

The API does not spawn Paseo. Local scripts own daemon start, health wait, signal forwarding, and cleanup. The runner disables relay, web UI, MCP injection, dictation, and voice; it prepends the platform-specific pinned OpenCode binary to `PATH` and uses isolated runtime homes.

## Known baseline gaps

- No stream cursor, cancel, resume, timeline fetch, runtime receipt, or compatibility version negotiation.
- No execution cell, tenant placement, workload identity, fence, or capability token.
- A Paseo Agent is not archived automatically after success.
- Provider availability and free-model catalog are external and unstable.

V1 expands the port only through [Runtime contract](../contracts/runtime-contract.md) and a compatibility suite; product code must not bypass it.
