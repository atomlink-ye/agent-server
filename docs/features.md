# Features

This is the authoritative capability ledger. Status values are `implemented`, `baseline`, `planned`, and `reserved`. `baseline` is a proven seam with known temporary limitations; it is not production completion.

| Feature area                     | Current status | Baseline evidence                                                                                                                                                                                                | V1 destination                                                                                     |
| -------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Identity and Access              | Baseline       | Service-account bearer auth and server-derived owner scope                                                                                                                                                       | Tenant, canonical user, OIDC/Lark, ACL, richer service accounts                                    |
| Agents and Teams                 | Baseline       | **Phase B implemented baseline:** managed Agent YAML package validation, durable registry/API, immutable published versions, and published-only Task admission; Team remains the sequential compatibility subset | Immutable Agent/Team versions and bounded graphs                                                   |
| Workspace and Memory             | Baseline       | **Phase C implemented minimum:** private database-owned Product Workspaces with multiple-workspace principal ownership; memory proposals remain the prior governance baseline                                    | Memory snapshots, retrieval, context assembly, memory policy                                       |
| Sessions, Tasks and Runs         | Baseline       | **Phase D minimum implemented:** runtime binding, durable normalized lifecycle events, final assistant Message, replayable SSE, owner-scoped cancellation, plus the Phase C ordered lane                         | Runtime Session V2 create/resume/status, incremental deltas, rich usage, retry, receipts, recovery |
| Runtime, Tools and Credentials   | Baseline       | Paseo/OpenCode adapter and zero-key model selection                                                                                                                                                              | Execution cells, tool gateway, credential broker, approvals                                        |
| Artifacts and Evidence           | Planned        | Result text only                                                                                                                                                                                                 | Immutable Artifact versions, evidence, source and child lineage                                    |
| Channels, API and Console        | Baseline       | Authenticated Run + Task HTTP routes, cursor event replay, terminal-closing SSE, and Task cancellation                                                                                                           | Web console, Lark adapter                                                                          |
| Schedules, Triggers and Delivery | Planned        | None                                                                                                                                                                                                             | Idempotent admission, controlled schedules/events, durable delivery                                |

## Identity and Access

**Outcome:** one internal user and tenant authorization model across Web, API, Lark, OIDC, and service accounts.

**Baseline:** `POST /api/v1/runs` and `GET /api/v1/runs/{id}` require a configured service-account bearer token. The server resolves tenant/workspace/principal scope from that binding, persists those snapshot facts on admission, scopes idempotency replay by that owner scope, and returns `404 run_not_found` for authenticated non-owner reads.

**V1 acceptance:** external identities map to canonical users; membership and Workspace authorization are checked at admission and use; tenant storage isolation is tested; deprovisioning revokes future access; no caller may supply an effective principal. SAML/SCIM contracts may be reserved without claiming production support.

## Agents and Teams

**Outcome:** users publish reusable, immutable definitions instead of depending on an ad hoc runtime conversation.

**Implemented baseline (Phase B):** the managed Agent package contract validates one safe YAML 1.2 document, canonicalizes it, and records a SHA-256 fingerprint. PostgreSQL stores durable managed `AgentDefinition`/`AgentVersion` records, and the six authenticated validation/import/read/list/publish routes are documented in [Contracts](contracts.md). Import and publish are idempotent; publication is immutable. Canonical Task admission and execution resolution accept an explicit published managed Agent version ID only. Owner-scoped drafts remain readable, listable, and publishable through the managed registry API; only that canonical Task boundary rejects unpublished drafts as not found. Foreign and missing resources remain hidden. This is owner-scoped service-account authorization, not private Workspace resource authorization or a shared-ACL implementation.

Team compatibility remains implemented only as the existing sequential subset: `invoke` nodes, one linear success chain, one final-output node, and leaf-agent runtime execution one step at a time. The managed Agent package contract does not claim arbitrary model execution or that referenced tools and skills are available merely because their references parse.

**V1 acceptance:** Agent and Team share one Invokable contract; published versions are immutable; graph compilation validates references, schemas, reachability, bounds, completion, failure and capability attenuation; Team coordination never requires a shared Paseo session.

## Workspace and Memory

**Implemented minimum:** the adapter opens one dedicated filesystem directory, assigns an explicit title, and reuses its Paseo Workspace ID. Phase C adds private database-owned Product Workspaces and multiple-workspace principal ownership. Phase E adds Product-Workspace-owned accepted entries, immutable monotonic snapshots, verified local `MEMORY.md`/`manifest.json` projections, and authenticated read/rebuild routes. Responses expose no local filesystem paths.

Legacy principal-private proposals and accepted entries remain separate and are not merged into Product Workspace snapshots. This minimum intentionally stops before agent memory, retrieval, embeddings, vector search, ranking, runtime context injection, or automatic prompt mutation. Accepted entries are durable records and verified projections, not content that leaf agents read automatically.

**V1 acceptance:** Product Workspace owns members, source snapshots, context, files, artifacts, accepted memory, retrieval policy, and memory proposals. Leaf runs write only to their scoped scratch/candidate paths. Memory changes are proposals with source and authority, not silent prompt mutation.

## Sessions, Tasks and Runs

**Baseline:** authenticated `POST /api/v1/tasks:invoke` remains the compatibility ingress. Phase C provides private Workspace/ProductSession resources and ordered lanes; Phase D adds minimum runtime binding, durable normalized lifecycle events, final assistant Message persistence, replayable SSE, and owner-scoped cancellation. Cross-owner resources remain hidden. This is an MVP slice and does not claim full Runtime Session V2 or production recovery.

**V1 acceptance:** Task is the only node invocation identity at both public and internal boundaries. Root/child admission and idempotency are durable. Run attempts use atomic claim, lease, activation, fence, typed completion, waiting/resume, cancel, retry, reconciliation, and immutable terminal history.

## Runtime, Tools and Credentials

**Baseline:** Paseo SDK calls are behind `AgentRuntimePort`; OpenCode models are discovered at startup; automatic selection is free-only; provider errors are normalized; caller model selection is forbidden. Phase D adds the minimum runtime binding and cancel seam, without claiming full create/resume/status SDK exposure, incremental deltas, rich usage, or durable receipt reconciliation.

**V1 acceptance:** dedicated execution placement, compatibility suite, normalized events, audience-bound capability tokens, credential-aware tool operations, approval policy, receipt-based side-effect recovery, and no raw business credential in a runtime-readable surface.

## Artifacts and Evidence

**V1 acceptance:** candidate, partial, and final outputs are immutable Artifact versions. Finalization creates a version rather than mutating a manifest. Evidence identifies source capture time and data-as-of. Root Team output retains child lineage across retries.

## Channels, API and Console

**Baseline:** health plus authenticated Run, Task, managed Agent, event replay/SSE, and cancellation routes use common request IDs and error envelopes. `/api/v1/tasks:invoke` is canonical; `/api/v1/runs` remains compatibility. The Phase D SSE is a persisted-event replay/polling baseline; no production release is claimed.

**V1 acceptance:** Web/API/Lark normalize into one Task proposal and authorization path; Task trees and Run events are inspectable; no UI subscribes directly to Paseo; delivery is retryable and idempotent.

## Schedules, Triggers and Delivery

**V1 SHOULD:** a schedule fire or external event is persisted and deduplicated before Task materialization. A model may propose but cannot directly create a permanent schedule. When the feature is disabled, manual Task submission is the explicit fallback.

## Explicitly deferred from this baseline

The following remain deferred and must not be inferred from the Phase C minimum:

- Full Runtime Session V2 create/resume/status APIs, incremental provider deltas, rich usage, retries/receipts, and production recovery;
- runtime context assembly, retrieval injection, or automatic safe-memory behavior. Snapshot projection is local MVP behavior only; production durability is deferred.
