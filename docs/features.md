# Features

This is the authoritative capability ledger. Status values are `implemented`, `baseline`, `planned`, and `reserved`. `baseline` is a proven seam with known temporary limitations; it is not production completion.

| Feature area                     | Current status | Baseline evidence                                                                                                                                                                                                                                                                                                                                                                                           | V1 destination                                                                                        |
| -------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Identity and Access              | Baseline       | Service-account bearer auth and server-derived owner scope                                                                                                                                                                                                                                                                                                                                                  | Tenant, canonical user, OIDC/Lark, ACL, richer service accounts                                       |
| Agents and Teams                 | Baseline       | **Phase B plus observed DAG MVE:** managed Agent YAML package validation, durable registry/API, immutable published versions, published-only Task admission, preserved `sequential-mvp-v1`, and opt-in `dag-mve-v1` with two parallel leaves, durable join, and synthesizer                                                                                                                                 | Immutable Agent/Team versions and bounded graphs                                                      |
| Workspace and Memory             | Baseline       | **API-first MVE implemented:** authenticated PostgreSQL Memory Store → stable Memory → immutable Version API with SHA-256 CAS, no-op/revert semantics, exact owner scope, plus the retained proposal/snapshot/Lark compatibility paths                                                                                                                                                                      | Retrieval, context assembly, memory policy, broader Memory lifecycle                                  |
| Sessions, Tasks and Runs         | Baseline       | **Phase D minimum implemented:** runtime binding, durable normalized lifecycle events, final assistant Message, replayable SSE, owner-scoped cancellation, plus the Phase C ordered lane; ProductSession Environment pinning and internal RuntimeSession/Cell baseline are implemented; ExecuteRun separates stable Bootstrap from per-Run Turn and uses ProductSession binding for same-Agent continuation | Runtime Session V2 create/resume/status, incremental deltas, rich usage, retry, receipts, recovery    |
| Runtime, Tools and Credentials   | Baseline       | Paseo/OpenCode adapter with native Bootstrap/per-turn separation, per-ProductSession Runtime Cell baseline, same-Agent continuation, zero-key model selection, and built-in `agent-server/memory-api` Skill loading                                                                                                                                                                                         | Production isolation, placement, tool gateway, credential broker, approvals, Agent Memory HTTP client |
| Artifacts and Evidence           | Planned        | Result text only                                                                                                                                                                                                                                                                                                                                                                                            | Immutable Artifact versions, evidence, source and child lineage                                       |
| Channels, API and Console        | Baseline       | Authenticated Run + Task + Memory Store/Memory HTTP routes, cursor event replay, terminal-closing SSE, Task cancellation, fixed Lark thread binding, and built-in Skill evidence                                                                                                                                                                                                                            | Web console, canonical identities, broader Lark adapter                                               |
| Schedules, Triggers and Delivery | Planned        | None                                                                                                                                                                                                                                                                                                                                                                                                        | Idempotent admission, controlled schedules/events, durable delivery                                   |

## Identity and Access

**Outcome:** one internal user and tenant authorization model across Web, API, Lark, OIDC, and service accounts.

**Baseline:** `POST /api/v1/runs` and `GET /api/v1/runs/{id}` require a configured service-account bearer token. The server resolves tenant/workspace/principal scope from that binding, persists those snapshot facts on admission, scopes idempotency replay by that owner scope, and returns `404 run_not_found` for authenticated non-owner reads.

**V1 acceptance:** external identities map to canonical users; membership and Workspace authorization are checked at admission and use; tenant storage isolation is tested; deprovisioning revokes future access; no caller may supply an effective principal. SAML/SCIM contracts may be reserved without claiming production support.

## Agents and Teams

**Outcome:** users publish reusable, immutable definitions instead of depending on an ad hoc runtime conversation.

**Implemented baseline (Phase B):** the managed Agent package contract validates one safe YAML 1.2 document, canonicalizes it, and records a SHA-256 fingerprint. PostgreSQL stores durable managed `AgentDefinition`/`AgentVersion` records, and the six authenticated validation/import/read/list/publish routes are documented in [Contracts](contracts.md). Import and publish are idempotent; publication is immutable. Canonical Task admission and execution resolution accept an explicit published managed Agent version ID only. Owner-scoped drafts remain readable, listable, and publishable through the managed registry API; only that canonical Task boundary rejects unpublished drafts as not found. Foreign and missing resources remain hidden. This is owner-scoped service-account authorization, not private Workspace resource authorization or a shared-ACL implementation.

`sequential-mvp-v1` remains implemented as the existing compatibility subset: `invoke` nodes, one linear success chain, one final-output node, and leaf-agent runtime execution one step at a time. The opt-in `dag-mve-v1` path is observed to materialize two parallel leaf child Tasks/Runs, wait at a root Run in `waiting_children`, durably join both successes, then materialize a synthesizer child and complete the root. It uses task-scoped RuntimeSessions/RuntimeCells and one shared EnvironmentVersion. Public callers still use `/api/v1/tasks:invoke` and Task reads/tree; no public Team CRUD/API was added. The managed Agent package contract does not claim arbitrary model execution or that referenced tools and skills are available merely because their references parse.

**V1 acceptance:** Agent and Team share one Invokable contract; published versions are immutable; graph compilation validates references, schemas, reachability, bounds, completion, failure and capability attenuation; Team coordination never requires a shared Paseo session.

The MVE does not claim crash recovery, restart/resume, retries, cancellation propagation, or production readiness.

## Workspace and Memory

**Implemented minimum:** the adapter opens one dedicated filesystem directory, assigns an explicit title, and reuses its Paseo Workspace ID. Phase C adds private database-owned Product Workspaces and multiple-workspace principal ownership. The API-first MVE adds PostgreSQL Memory Stores, stable Memories, immutable Versions, strict path/content validation, atomic SHA-256 CAS, no-op/revert behavior, and exact owner isolation. Phase E adds Product-Workspace-owned accepted entries, immutable monotonic snapshots, verified local `MEMORY.md`/`manifest.json` projections, and authenticated read/rebuild routes. Responses expose no local filesystem paths.

Legacy principal-private proposals and accepted entries remain separate and are not merged into Product Workspace snapshots. Phase F adds the minimum Fresh ProductSession recall path: explicit published AgentVersion, admission-pinned ready snapshot ID/hash, verified local read, separated Session Bootstrap/per-turn input, and final assistant Message persistence. It does not add old history or Workspace scans. This minimum intentionally stops before retrieval, embeddings, vector search, ranking, or provider-native mounting.

Phase G adds a deterministic default-off memory policy with `disabled`,
`proposal`, and `auto_safe` modes. Auto-safe is limited to the exact
allowlist (`terminology`, `output_preference`, `project_constraint`,
`confirmed_workflow_procedure`) and trusted current-user/structured-system
sources. Decisions expose only safe reason-code traces. The gardener is
proposal-only; the existing manual proposal/review HTTP path is unchanged.

Phase H minimum release evidence is approved: the managed single-agent
transcript, fault lane, recovery inspection, and operations packet are recorded.
Production hardening and rollout readiness remain deferred.

**V1 acceptance:** Product Workspace owns members, source snapshots, context, files, artifacts, accepted memory, retrieval policy, and memory proposals. Leaf runs write only to their scoped scratch/candidate paths. Memory changes are proposals with source and authority, not silent prompt mutation.

## Sessions, Tasks and Runs

**Managed Environment baseline:** the authenticated four-route Managed
Environment API is implemented with fixed Paseo/OpenCode/free-only package
values. ProductSession creation pins a published EnvironmentVersion, and first
use creates one internal RuntimeSession, launch snapshot, and derived Runtime
Cell per ProductSession. This is proven by the retained three-turn real smoke;
it does not claim production isolation or full Runtime Session V2.

**Baseline:** authenticated `POST /api/v1/tasks:invoke` remains the compatibility ingress. Phase C provides private Workspace/ProductSession resources and ordered lanes; Phase D adds minimum runtime binding, durable normalized lifecycle events, final assistant Message persistence, replayable SSE, and owner-scoped cancellation; Phase F adds Fresh ProductSession admission pinning, verified minimum context handling, and native Bootstrap/per-turn separation. Cross-owner resources remain hidden. This is an MVP slice and does not claim full Runtime Session V2 or production recovery.

**V1 acceptance:** Task is the only node invocation identity at both public and internal boundaries. Root/child admission and idempotency are durable. Run attempts use atomic claim, lease, activation, fence, typed completion, waiting/resume, cancel, retry, reconciliation, and immutable terminal history.

The observed `dag-mve-v1` flow is an opt-in exception to the sequential compatibility path: two parallel leaf Tasks/Runs run with task-scoped RuntimeSessions/RuntimeCells, the root Run durably enters `waiting_children`, a join releases a synthesizer child only after both leaves succeed, and the root then completes. Failure is fail-fast/deferred rather than a claim of generalized recovery.

## Runtime, Tools and Credentials

**Baseline:** Paseo SDK calls are behind `AgentRuntimePort`; OpenCode models are discovered at startup; automatic selection is free-only; provider errors are normalized; caller model selection is forbidden. Native Bootstrap/per-turn execution sends the stable system prompt and resolved server-owned Memory API Skill only at Agent creation and continues later turns on the same Agent. The Skill teaches the API but does not provide Agent-side HTTP execution or credentials.

Local development is Docker-first and has an observed process-isolation baseline:
the long-lived PostgreSQL and co-process Agent Server services run in Compose,
while Paseo, OpenCode, and Runtime MCP remain inside the Agent Server container.
Only the loopback API port is host-published. This is not production sandboxing,
tenant isolation, or a placement guarantee.

**V1 acceptance:** dedicated execution placement, compatibility suite, normalized events, audience-bound capability tokens, credential-aware tool operations, approval policy, receipt-based side-effect recovery, and no raw business credential in a runtime-readable surface.

## Artifacts and Evidence

**V1 acceptance:** candidate, partial, and final outputs are immutable Artifact versions. Finalization creates a version rather than mutating a manifest. Evidence identifies source capture time and data-as-of. Root Team output retains child lineage across retries.

## Channels, API and Console

**Baseline:** health plus authenticated Run, Task, managed Agent, event replay/SSE, and cancellation routes use common request IDs and error envelopes. `/api/v1/tasks:invoke` is canonical; `/api/v1/runs` remains compatibility. The Phase D SSE is a persisted-event replay/polling baseline; no production release is claimed.

The fixed Lark compatibility baseline adds one explicitly enabled `agent-test`
App, one configured group, one allowlisted external user, and one service-account
Tenant/Workspace/AgentVersion tuple. Verified bot-mention replies in one thread
resolve its root binding and Product Session; unrelated roots retain separate
Sessions. Successive Agent Runs in one Product Session reuse one bound provider
Agent when continuation is available. Every Card-eligible Memory proposal
immediately creates a Bot-owned editable Doc before `card_with_doc` publication.
New Cards render only Open Doc, Accept, and Reject; legacy edit/Preview actions
remain inbound-only. It does not create canonical Users or Memberships or claim
production identity. Provider delivery is retryable and bounded; it is not
physical exactly-once or production readiness.

**V1 acceptance:** Web/API/Lark normalize into one Task proposal and authorization path; Task trees and Run events are inspectable; no UI subscribes directly to Paseo; delivery is retryable and idempotent.

## Schedules, Triggers and Delivery

**V1 SHOULD:** a schedule fire or external event is persisted and deduplicated before Task materialization. A model may propose but cannot directly create a permanent schedule. When the feature is disabled, manual Task submission is the explicit fallback.

## Explicitly deferred from this baseline

The following remain deferred and must not be inferred from the Phase C minimum:

- Full Runtime Session V2 create/resume/status APIs, incremental provider deltas, rich usage, retries/receipts, and production recovery;
- transaction-concurrency hardening, crash recovery, legacy nullable Session cleanup, grant renewal/header persistence, Host placement/GC, a second adapter, and production isolation;
- retrieval injection or automatic safe-memory behavior. Phase F context handling is only the documented Bootstrap/per-turn minimum; auto-safe remains disabled by default and no production rollout is claimed.
- Multi-App or multi-user channel administration, preview successor lease fences,
  post-canonical retry/fencing, manual rebuild races, rolling allocator races,
  generalized synthesis retry/audit, crash recovery, multi-node leadership,
  extra redrive/fault injection, performance hardening, and production
  identity/rollout remain deferred from the fixed compatibility canary.
