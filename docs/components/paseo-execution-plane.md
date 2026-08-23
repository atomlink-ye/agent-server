# Runtime execution

## Status

The execution-plane implementation is being removed. This page records its replacement ownership while the tracked implementation files remain in the tree; it does not define new contracts for that implementation.

## Replacement ownership

| Concern | Owner |
| --- | --- |
| Provider session lifecycle | `RuntimeExecutionProvider` |
| Durable session readiness | `EnsureRuntimeSession` |
| Durable provider identity | `RuntimeSessionGeneration` |
| Immutable runtime tool definitions | `RuntimeToolCatalog` |
| Runtime capability assembly | Composition-owned construction in `src/composition/` |

`RuntimeSession` owns durable Agent Server identity. `RuntimeSessionGeneration` owns the provider binding for one applied runtime specification. Provider session IDs and host paths remain outside the product model.

## Removal boundary

The files under the execution-plane boundary, including Paseo, scripted, unavailable, and process-local run-registry implementations, are scheduled for removal. Do not add new behavior or documentation to those abstractions. New runtime behavior belongs to the owners above.

## Provider boundary

`RuntimeExecutionProvider` creates, inspects, reconfigures, opens, and closes provider sessions. `EnsureRuntimeSession` resolves one durable RuntimeSession to a ready generation and process-local execution handle. Provider failures remain explicit; provider identity, credentials, raw payloads, and host paths do not enter product responses or ordinary logs.

## Tool boundary

`RuntimeToolCatalog` is immutable after composition. Runtime grants authorize access to catalogued tools without making registration mutable during execution.
