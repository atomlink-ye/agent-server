# Components

Components are ownership and contract boundaries, not deployment promises. The baseline is a modular monolith with a separate Paseo process; future services may be extracted only when durability, security, or scaling evidence requires it.

| Component                                                                  | Responsibility                                   | Current status              |
| -------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------- |
| [Control Plane](components/control-plane.md)                               | Definitions, policy, admission, review           | Planned                     |
| [Orchestration Kernel](components/orchestration-kernel.md)                 | Task/Run lifecycle, Team coordination, recovery  | Run seam baseline           |
| [Runtime execution](components/paseo-execution-plane.md)                   | Provider lifecycle and durable session readiness | Replacement in progress     |
| [Credential and Tool Gateway](components/credential-and-tool-gateway.md)   | Secret-safe tool authorization and receipts      | Planned                     |
| [Workspace and Artifact Store](components/workspace-and-artifact-store.md) | Sources, scoped files, artifacts, evidence       | Paseo workspace baseline    |
| [Channel, API, and Console](components/channel-api-console.md)             | Ingress, delivery, inspection                    | Agent Teams v2 project view |
| [Data and Operations](components/data-and-operations.md)                   | Durable storage, queue, audit, observability     | Logging baseline            |

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
runtime, or provider cancellation forwarding.

## Managed Environment and RuntimeSession boundary

The Environment registry owns strict fixed-package validation, authenticated
import/read/publish, and immutable published versions. ProductSession admission
pins one published EnvironmentVersion, while ExecuteRun creates one internal
RuntimeSession and immutable launch snapshot for that ProductSession. The
RuntimeSession ID deterministically selects a Runtime Cell; native Skill and
Grant receipts are materialized inside that Cell, and the Paseo adapter opens a
Workspace there. A later Run reuses the same provider binding; another
ProductSession receives a distinct Cell and provider Workspace. This is an
implemented baseline, not production isolation or Runtime Session V2.

Per-Run bindings/events remain durable evidence. Transaction concurrency, crash
recovery, legacy nullable Sessions, Grant renewal/header persistence, Host
placement/GC, a second adapter, and production lifecycle hardening are deferred.

## Phase C Session lane boundary

The Session lane owns one ProductSession generation and its durable user Message
roots. Admission locks the lane, allocates a monotonic sequence, and inserts the
Message, root Task, Run attempt 1, idempotency record, dispatch intent, and lane
metadata before returning `202`. Only `active_task_id` is eligible for dispatch;
later roots remain queued in `(generation, lane_sequence)` order.

Reset increments generation, marks only non-active queued old-generation Tasks
`cancelled` with failure detail `cancelled_by_reset`, and records a durable
cancellation request for the active old-generation Task. The active Task remains
the lane owner until normal terminal completion. Completion then promotes the
oldest eligible queued root, including a new-generation root, and clears the
cancellation request. Product Workspace ownership is tenant plus principal;
legacy Task/Run routes retain their compatibility workspace behavior.

## Web Chat and streaming boundary

The Web surface is a separate Next.js service. Its same-origin BFF owns the
server-side Agent Server client, ProductSession bootstrap/recovery, message
proxy, and owner-checked Run SSE proxy. The browser receives only an HttpOnly
`product_session_id`; the service bearer is never sent to browser code or
upstream browser requests. Persisted ProductSession Messages remain the
conversation truth.

The runtime-neutral event projection uses the existing `type=output` Run Event
path and flat scalar payloads. It supports complete-so-far `assistant_text`
snapshots; cumulative `reasoning_progress` text disclosures; allowlisted
`tool_status` detail/result/error previews; direct-child assistant/reasoning
timeline rows; one final normalized `usage` snapshot; and read-only
`permission` activity. Every preview is bounded and sanitized. Raw provider
payloads, credentials, provider IDs, unsafe paths, and unbounded detail remain
outside the boundary. The Paseo adapter filters by the active epoch/sequence
baseline, serializes sink writes, and reconciles root and direct-child Timeline
entries.

Run Events remain append-only evidence, and the Web reducer replaces transient
assistant text by sequence while rendering compact conversation-first activity
with keyboard-accessible disclosures. The same reducer handles live SSE and
paged replay; completed root disclosures default closed and direct-child rows
remain inline under their parent.
SSE closes only after the persisted terminal Run Event; a matching formal
Assistant Message remains transcript truth and is required for healthy UI
convergence. This is a local fresh-session MVE, not production identity, ACL,
cancel, old-session restart recovery, backpressure, or broader console
functionality.

## Agent Teams v2 Project and Agent Session boundary

AgentProject remains the authoritative versioned Team boundary. Its filesystem
loader accepts either file-backed or inline Agent, Environment, and Team specs,
applies the approved constant and safe defaults before canonicalization, and
materializes reserved `tool-profile://team-lead` and
`tool-profile://team-member` profiles only when an Agent explicitly declares
the corresponding ref. For Agent, Environment, Team, and tool-profile
resources, logical paths and canonical native package bytes—not inline/file
authoring form or source-file location—feed project fingerprints, apply
payloads, and lock convergence. Existing skill-directory and memory-seed
locator semantics are unchanged. Runtime invocation cannot define or expand
the roster, tools, skills, or environment.

The Agent Teams v2 Project is a thin observer/launcher over the fixed Team. Its
Next.js same-origin BFF owns the server-side Agent Server bearer and binds the
flow to `WEB_WORKSPACE_ID`, `WEB_AGENTIC_TEAM_VERSION_ID`, and
`WEB_ENVIRONMENT_VERSION_ID`. It exposes launch, one owner-checked Project
projection, three read-only Agent Sessions, historical session Run events, and
Project Run SSE. The browser is not a configuration authority and never calls
`/api/v1`.

The backend projection keeps TeamMemberRun linkage and bounded Lead/member turn
history while hiding bearer credentials, RuntimeSession IDs, prompts, raw event
payloads, raw upstream errors, and provider IDs. URL-backed selection restores
the Project and selected Agent Session on refresh. This is local/single-operator
only; production or multi-user deployment requires a new authentication Human
Gate. ProductSession Chat remains a separate unchanged path.

## Runtime execution boundary

Runtime execution is converging on `RuntimeExecutionProvider` for provider lifecycle, `EnsureRuntimeSession` for durable session readiness, and `RuntimeToolCatalog` for immutable tool definitions. `RuntimeSession` and `RuntimeSessionGeneration` remain the durable identity and provider-binding records; `Run` remains durable execution truth. The retiring execution-plane implementation is documented only as a transition in [Runtime execution](./components/paseo-execution-plane.md); the current boundary is defined by the [Runtime Contract](./contracts/runtime-contract.md).
