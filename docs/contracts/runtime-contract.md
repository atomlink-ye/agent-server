# Runtime Contract

## Scope

This contract defines the durable runtime boundary between Agent Server and an external provider. `RuntimeExecutionProvider` owns provider lifecycle; `EnsureRuntimeSession` resolves durable runtime identity to a ready provider generation. Paseo is one provider implementation.

The execution-plane port and its session, adapter, and run-registry implementations remain tracked only while their removal completes. They are not extension points for new behavior.

## Source of truth

- Task and Run state are durable control truth.
- RuntimeSession owns durable Agent Server execution identity.
- RuntimeSessionGeneration owns one provider binding and the applied runtime specification.
- Provider lifecycle is observed through RuntimeExecutionProvider, not represented as a second Agent Server state machine.
- RuntimeToolCatalog is the immutable composition-owned set of runtime tool definitions.

## Provider lifecycle

RuntimeExecutionProvider creates, inspects, reconfigures, opens, and closes a provider session. Its provider binding is a short-lived handle over the durable RuntimeSessionGeneration identity. Application code does not use provider database-column names, raw provider identifiers, credentials, host paths, or raw provider payloads.

Provider inspection reports whether a binding is available, missing, stale, or unavailable. Transport and protocol failures remain explicit errors; an unavailable binding is not silently replaced as a side effect of inspection.

## Durable session readiness

EnsureRuntimeSession resolves a RuntimeSession to one ready RuntimeSessionGeneration and its process-local execution handle. A provider generation records the applied specification that established its binding. Session readiness does not change Task or Run durability ownership.

## Tool authorization

RuntimeToolCatalog is frozen during composition. Durable RuntimeToolGrant authorization controls which catalogued tools a runtime turn may use; it does not mutate the catalog during execution.

### Coworker workspace tools

New Coworkers created through the product authoring form include these managed tools:

| Tool ref                       | MCP name          | Input                                                             |
| ------------------------------ | ----------------- | ----------------------------------------------------------------- |
| `agent-server/workspace-list`  | `workspace_list`  | `{}`                                                              |
| `agent-server/workspace-read`  | `workspace_read`  | `{ "path": "notes/conclusion.md" }`                               |
| `agent-server/workspace-write` | `workspace_write` | `{ "path": "notes/conclusion.md", "content": "Conclusion text" }` |

Every call reauthorizes the current Chat turn and resolves the Coworker from its Conversation. Missing or ambiguous identity fails closed, including multi-Agent conversations. Inputs cannot select an Agent, tenant, namespace, or scope. Paths are normalized relative POSIX paths of at most 512 characters; traversal and absolute paths are rejected. Content must be non-empty UTF-8 text of at most 64 KiB, without NUL or unpaired surrogates. The MCP HTTP limit also applies to the entire encoded request, including JSON overhead, so the usable content size is smaller than 64 KiB.

The tools access only that Coworker's canonical ContextFS `agent` scope through the Agent Home `agent-shared` namespace. Writes use the existing logical file store and append immutable snapshots; writing an existing path replaces its current content. Files persist across conversations and are visible in Files under the Coworker's Agent scope. These are logical files, not a mounted provider filesystem. Published identity instructions remain the read-only AgentVersion projection.

Existing published Coworker versions do not acquire new tool declarations automatically. General UI file editing and access to conversation, Work, or other Agents' scopes are outside these tools.

### Reaching a granted tool

A grant is not exposure. The provider reads MCP tool names from the Runtime MCP endpoint, and Codex 0.153 keeps MCP tools out of the model's directly-visible tool list; a model that reads only that list reports its granted platform tools as unavailable, or does the work outside the Runtime. Chat turns and Work runs therefore name their granted tools in the system prompt, rendered from the same catalog `src/entrypoints/mcp` registers, alongside the MCP server the provider connects to. The names are derived from the granted refs, so the prompt can never advertise a tool the Runtime would refuse.

## Observation and safety

Runtime observations are normalized before Application persists them as RunEvent data. Provider-native identifiers, credentials, raw payloads, and unsafe host paths remain outside product responses and ordinary logs. Memory policy and product persistence remain outside the provider boundary.

## Composition

Composition constructs provider lifecycle, session readiness, tool catalog, and runtime endpoints before execution begins. Runtime behavior must not rely on late mutable registration or a second composition shell.
