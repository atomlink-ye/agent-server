# Components

Components are ownership and contract boundaries, not deployment promises. The baseline is a modular monolith with a separate Paseo process; future services may be extracted only when durability, security, or scaling evidence requires it.

| Component                                                                  | Responsibility                                  | Current status           |
| -------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------ |
| [Control Plane](components/control-plane.md)                               | Definitions, policy, admission, review          | Planned                  |
| [Orchestration Kernel](components/orchestration-kernel.md)                 | Task/Run lifecycle, Team coordination, recovery | Run seam baseline        |
| [Paseo Runtime Adapter](components/paseo-runtime-adapter.md)               | Leaf-agent provider translation                 | Implemented baseline     |
| [Credential and Tool Gateway](components/credential-and-tool-gateway.md)   | Secret-safe tool authorization and receipts     | Planned                  |
| [Workspace and Artifact Store](components/workspace-and-artifact-store.md) | Sources, scoped files, artifacts, evidence      | Paseo workspace baseline |
| [Channel, API, and Console](components/channel-api-console.md)             | Ingress, delivery, inspection                   | HTTP baseline            |
| [Data and Operations](components/data-and-operations.md)                   | Durable storage, queue, audit, observability    | Logging baseline         |

Dependencies point inward: entrypoints and adapters depend on application ports; application depends on domain; domain imports neither frameworks nor Paseo.
