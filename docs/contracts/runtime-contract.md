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

## Observation and safety

Runtime observations are normalized before Application persists them as RunEvent data. Provider-native identifiers, credentials, raw payloads, and unsafe host paths remain outside product responses and ordinary logs. Memory policy and product persistence remain outside the provider boundary.

## Composition

Composition constructs provider lifecycle, session readiness, tool catalog, and runtime endpoints before execution begins. Runtime behavior must not rely on late mutable registration or a second composition shell.
