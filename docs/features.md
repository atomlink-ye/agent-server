# Features

This is the authoritative capability ledger. Status values are `implemented`, `baseline`, `planned`, and `reserved`. `baseline` is a proven seam with known temporary limitations; it is not production completion.

| Feature area                     | Current status | Baseline evidence                                                                                                                                                                                                | V1 destination                                                           |
| -------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Identity and Access              | Baseline       | Service-account bearer auth and server-derived owner scope                                                                                                                                                       | Tenant, canonical user, OIDC/Lark, ACL, richer service accounts          |
| Agents and Teams                 | Baseline       | **Phase B implemented baseline:** managed Agent YAML package validation, durable registry/API, immutable published versions, and published-only Task admission; Team remains the sequential compatibility subset | Immutable Agent/Team versions and bounded graphs                         |
| Workspace and Memory             | Baseline       | One isolated Paseo Workspace is reused; owner-scoped memory proposals can be reviewed into accepted entries                                                                                                      | Product Workspace, snapshots, retrieval, context assembly, memory policy |
| Sessions, Tasks and Runs         | Baseline       | PostgreSQL-backed Task admission, Task tree reads, Run polling, dispatcher                                                                                                                                       | Product Session, cancel/retry, reconcile, recovery                       |
| Runtime, Tools and Credentials   | Baseline       | Paseo/OpenCode adapter and zero-key model selection                                                                                                                                                              | Execution cells, tool gateway, credential broker, approvals              |
| Artifacts and Evidence           | Planned        | Result text only                                                                                                                                                                                                 | Immutable Artifact versions, evidence, source and child lineage          |
| Channels, API and Console        | Baseline       | Authenticated Run + Task HTTP routes                                                                                                                                                                             | SSE, Web console, Lark adapter                                           |
| Schedules, Triggers and Delivery | Planned        | None                                                                                                                                                                                                             | Idempotent admission, controlled schedules/events, durable delivery      |

## Identity and Access

**Outcome:** one internal user and tenant authorization model across Web, API, Lark, OIDC, and service accounts.

**Baseline:** `POST /api/v1/runs` and `GET /api/v1/runs/{id}` require a configured service-account bearer token. The server resolves tenant/workspace/principal scope from that binding, persists those snapshot facts on admission, scopes idempotency replay by that owner scope, and returns `404 run_not_found` for authenticated non-owner reads.

**V1 acceptance:** external identities map to canonical users; membership and Workspace authorization are checked at admission and use; tenant storage isolation is tested; deprovisioning revokes future access; no caller may supply an effective principal. SAML/SCIM contracts may be reserved without claiming production support.

## Agents and Teams

**Outcome:** users publish reusable, immutable definitions instead of depending on an ad hoc runtime conversation.

**Implemented baseline (Phase B):** the managed Agent package contract validates one safe YAML 1.2 document, canonicalizes it, and records a SHA-256 fingerprint. PostgreSQL stores durable managed `AgentDefinition`/`AgentVersion` records, and the six authenticated validation/import/read/list/publish routes are documented in [Contracts](contracts.md). Import and publish are idempotent; publication is immutable. Canonical Task admission accepts an explicit published managed Agent version ID only, in the authenticated owner scope. Draft and foreign versions are hidden. This is owner-scoped service-account authorization, not private Workspace resource authorization or a shared-ACL implementation.

Team compatibility remains implemented only as the existing sequential subset: `invoke` nodes, one linear success chain, one final-output node, and leaf-agent runtime execution one step at a time. The managed Agent package contract does not claim arbitrary model execution or that referenced tools and skills are available merely because their references parse.

**V1 acceptance:** Agent and Team share one Invokable contract; published versions are immutable; graph compilation validates references, schemas, reachability, bounds, completion, failure and capability attenuation; Team coordination never requires a shared Paseo session.

## Workspace and Memory

**Baseline:** the adapter opens one dedicated filesystem directory, assigns an explicit title, and reuses its Paseo Workspace ID. The smoke workspace is isolated and ignored by Git. This phase also adds workspace-memory governance routes for authenticated service-account owner scopes: callers can create proposals with optional Task/session provenance, list proposals, review pending proposals as `accept`, `edit_and_accept`, or `reject`, and list accepted entries. A private Workspace resource and multi-workspace database authorization model are not implemented.

This baseline intentionally stops at governance and provenance. It does not add agent memory, retrieval, embeddings, vector search, ranking, runtime context injection, or automatic prompt mutation. Accepted entries are durable records, not content that leaf agents read automatically.

**V1 acceptance:** Product Workspace owns members, source snapshots, context, files, artifacts, accepted memory, retrieval policy, and memory proposals. Leaf runs write only to their scoped scratch/candidate paths. Memory changes are proposals with source and authority, not silent prompt mutation.

## Sessions, Tasks and Runs

**Baseline:** authenticated `POST /api/v1/tasks:invoke` is the canonical public ingress and persists a root Task plus its first Run for a published managed `agent` version or the compatible published `team` subset. Authenticated `GET /api/v1/tasks/{id}` and `GET /api/v1/tasks/{id}/tree` expose owner-scoped Task state, latest Run summaries, and sequential Team child genealogy. Authenticated `POST /api/v1/runs` remains a compatibility admission route over the same canonical Task/Run model, uses a reserved UUID compatibility invokable-version sentinel for its admitted root Tasks, and `GET /api/v1/runs/{id}` never returns the prompt and collapses cross-owner reads to `404 run_not_found`. Admission reloads through the transaction-scoped repository; the PostgreSQL 16 pool lane proves visibility, replay, owner isolation, and a same-key race. One in-process dispatcher claims queued Runs and completes them through the Runtime Port or the sequential Team coordinator. Product Session, durable Messages/queue, cancel, SSE, and a production release are not implemented.

**V1 acceptance:** Task is the only node invocation identity at both public and internal boundaries. Root/child admission and idempotency are durable. Run attempts use atomic claim, lease, activation, fence, typed completion, waiting/resume, cancel, retry, reconciliation, and immutable terminal history.

## Runtime, Tools and Credentials

**Baseline:** Paseo SDK calls are behind `AgentRuntimePort`; OpenCode models are discovered at startup; automatic selection is free-only; provider errors are normalized; caller model selection is forbidden. Reconnect reuses cached Workspace/model state, and tested attempt-generation/connection ownership protects stale initialize/reconnect attempts from replacing newer state. Pending `close()` ownership is not proven and remains deferred. These reconnect limitations are preserved from Phase A. The authenticated external smoke uses an ephemeral service-account token, exact marker, free-only selection, zero OpenCode credentials, and sanitized evidence. Managed package references do not claim runtime availability checks, arbitrary model execution, or tool/reference execution. Runtime Session V2 APIs, normalized runtime events, durable receipt reconciliation, and cancel are not implemented.

**V1 acceptance:** dedicated execution placement, compatibility suite, normalized events, audience-bound capability tokens, credential-aware tool operations, approval policy, receipt-based side-effect recovery, and no raw business credential in a runtime-readable surface.

## Artifacts and Evidence

**V1 acceptance:** candidate, partial, and final outputs are immutable Artifact versions. Finalization creates a version rather than mutating a manifest. Evidence identifies source capture time and data-as-of. Root Team output retains child lineage across retries.

## Channels, API and Console

**Baseline:** health plus authenticated Run, Task, and managed Agent routes use common request IDs and error envelopes. `/api/v1/tasks:invoke` is the canonical public invocation route; `/api/v1/runs` remains the compatibility route; the managed Agent package/registry routes are the Phase B API surface. A deterministic real-socket E2E covers the current compatibility HTTP path, including bearer auth and owner-scoped reads. SSE is not implemented in this phase and no production release is claimed.

**V1 acceptance:** Web/API/Lark normalize into one Task proposal and authorization path; Task trees and Run events are inspectable; no UI subscribes directly to Paseo; delivery is retryable and idempotent.

## Schedules, Triggers and Delivery

**V1 SHOULD:** a schedule fire or external event is persisted and deduplicated before Task materialization. A model may propose but cannot directly create a permanent schedule. When the feature is disabled, manual Task submission is the explicit fallback.

## Explicitly deferred from this baseline

The following are not implemented and must not be inferred from the Phase B managed Agent registry work:

- private Workspace resources or multi-workspace database authorization;
- Product Session resources;
- durable Messages or a durable message queue;
- Runtime Session V2 APIs, runtime events, SSE delivery, and cancellation;
- memory snapshots, runtime context assembly, retrieval injection, or automatic safe-memory behavior.
