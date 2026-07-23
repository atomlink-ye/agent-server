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

## Managed Agent registry boundary

The managed Agent registry augments the existing `agent_definitions` and
`agent_versions` tables with migration `0005_managed_agent_registry_b`. It does
not create a parallel version store. Managed ownership is `(tenant_id,
principal_type, principal_id)`; the `workspace_id` carried by a managed row is a
compatibility workspace snapshot, not part of managed identity or lookup.
Legacy invokables retain their existing full tenant/workspace/principal scope.

The package parser and compiler validate the restricted YAML package and persist
immutable parser/compiler snapshots, canonical JSON, and a SHA-256 fingerprint
on each version. Runtime execution receives only the published instructions
selected by the application seam.

`PostgresAgentRegistry` owns atomic import, idempotency convergence and
conflict handling, publication, owner-hidden reads, and cursor pagination
ordered by `(created_at, id)`. Database constraints enforce published-version
immutability. `ResolveAgentVersion` checks managed by tenant and principal
first, refuses legacy fallback when that managed row is a draft, and consults
the legacy published Agent query only when no managed row exists. Team lookup,
compilation, child Agent resolution, and Team execution remain unchanged.

This boundary does not provide latest-version lookup, shared ACLs, arbitrary
caller-selected models, package/policy/template/schema/completion data to the
runtime, workspace resources, sessions, or Phase C behavior.
