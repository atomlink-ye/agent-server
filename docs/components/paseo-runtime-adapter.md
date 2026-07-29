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

The adapter connects once, opens a configured filesystem directory, assigns an explicit Workspace title, reads the live OpenCode model catalog, and caches one selected model. Reconnect reuses the cached Workspace and model. Concurrent calls share initialization state; attempt generation and connection ownership prevent stale initialize/reconnect work from replacing a newer connection. The tests do not establish that a pending `close()` is safe against a newer initialization; close ownership remains a follow-up. A failed initialization can be retried; readiness exposes only safe WebSocket, Workspace, and model checks.

Automatic selection prefers known free model IDs and may fall back only to another catalog entry explicitly marked free in its ID, label, or description. `PASEO_MODEL` is an operator override and must exist in the catalog. HTTP callers cannot set it.

## Execution

For the first Run in a Product Session the adapter creates a Paseo Agent with
provider `opencode`, mode `build`, selected model, explicit Workspace, native
`systemPrompt`, initial turn, and non-secret labels. Later Runs in that Product
Session resume the same bound idle Agent with `sendAgentMessage`, sending only
the current turn; failures do not silently create a replacement. Paseo persists
and reapplies the native system prompt, while User entries in the Paseo
Timeline contain only the turns, not System/Role text. `idle` maps to success,
`timeout` to a stable timeout error, and `error|permission` to a stable
execution failure. The API stores a safe error envelope rather than the
provider exception.

For a published managed Agent referencing `agent-server/memory-api`, server-owned
Skill text is resolved before create-time Bootstrap and included with the
platform contract and published instructions. It is not resent on continuation.
The verified MVE proves the Skill marker and exact API guidance in one real free
model run. This is guidance-only: the adapter does not expose an HTTP Memory
client, MCP/native tool, Runtime credential, or capability to the Agent.

For a pinned Managed Environment, the application supplies a RuntimeSession
Cell CWD. Paseo `openProject` deduplicates an existing Workspace, while the
managed Cell path uses `createWorkspace`; this yields Workspace reuse for
Session A continuation and a distinct Workspace for Session B. This observed
MVE behavior is not a production placement or isolation guarantee.

Direct Doc Accept uses the exact source Run+Session provider binding and fails
closed when it is missing or belongs to the wrong Session. Paseo `0.1.110`
already provides this continuation seam; no dependency upgrade is required.
The implementation does not claim full Runtime Session V2 or restart/rebind
hardening.

## Process boundary

The API does not spawn Paseo. Local scripts own daemon start, health wait, signal forwarding, and cleanup. The runner disables relay, web UI, MCP injection, dictation, and voice; it prepends the platform-specific pinned OpenCode binary to `PATH` and uses isolated runtime homes.

## Capability characterization and baseline gaps

The pinned SDK `0.1.110` capability characterization confirms the underlying seam can support resume, cancel, update/stream events, connection state, and timeline/snapshot operations. The current adapter exposes only create-and-wait execution plus health; Runtime Session V2 APIs are not yet public or application-facing.

- No stream cursor, cancel, resume, timeline fetch, runtime receipt, or compatibility version negotiation.
- No execution cell, tenant placement, workload identity, fence, or capability token.
- No production Cell placement, Host lifecycle, GC, or second adapter; the MVE
  Cell is a local derived directory only.
- A Paseo Agent is not archived automatically after success.
- Provider availability and free-model catalog are external and unstable.

V1 expands the port only through [Runtime contract](../contracts/runtime-contract.md) and a compatibility suite; product code must not bypass it.
