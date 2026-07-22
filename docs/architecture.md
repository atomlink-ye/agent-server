# Architecture

Agent Server follows a ports-and-adapters modular monolith around a separately managed Paseo daemon. The design keeps product truth independent from runtime process state.

```mermaid
flowchart TD
    C["Web / API / Lark"] --> A["Admission and Control Plane"]
    A --> K["Task / Run Kernel"]
    K --> T["Team Coordinator"]
    K --> R["AgentRuntimePort"]
    R --> P["Paseo execution cell"]
    K --> G["Tool Gateway"]
    K --> S["Workspace / Artifact services"]
    A --> D["PostgreSQL + outbox"]
    K --> D
```

In the baseline, admission and durable services are reduced to a small HTTP route and in-memory repository; the Runtime Port and separate process boundary are real.

## Dependency rule

`domain ← application ← adapters/infrastructure/entrypoints`. Domain types never import Hono, Zod, Paseo, filesystem, or storage SDKs. Application code names capabilities through ports. Adapters normalize unstable provider details at the edge.

## Source of truth

- Product and feature scope: [Product](product.md) and [Features](features.md).
- Object invariants: [Domain model](architecture/domain-model.md).
- Runtime ownership and failure semantics: [Execution and recovery](architecture/execution-and-recovery.md).
- Isolation and credentials: [Tenancy and security](architecture/tenancy-and-security.md).
- Concrete public/port shapes: [Contracts](contracts.md).

Architecture changes that alter these boundaries require an ADR and Human Gate.
