# Features

This is the authoritative capability ledger. Status values are `implemented`, `baseline`, `planned`, and `reserved`. `baseline` is a proven seam with known temporary limitations; it is not production completion.

| Feature area                     | Current status | Baseline evidence                                                                                                                                                                                                                                                                                          | V1 destination                                                                                        |
| -------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Identity and Access              | Baseline       | Service-account bearer auth and server-derived owner scope                                                                                                                                                                                                                                                 | Tenant, canonical user, OIDC/Lark, ACL, richer service accounts                                       |
| Agents and Teams                 | Baseline       | Managed Agent/Team registries plus **Composition-first Work**: immutable Product WorkDefinition versions resolve single-Agent or bounded-collaboration participants, Environment, Memory, Skills, domain Tools, and platform capabilities into one frozen WorkRun resource manifest                        | Dynamic rosters, nested Teams, and generalized graphs                                                 |
| Workspace and Memory             | Baseline       | **API-first MVE implemented:** authenticated PostgreSQL Memory Store → stable Memory → immutable Version API with SHA-256 CAS, no-op/revert semantics, exact owner scope, plus retained proposal/snapshot/Lark compatibility paths                                                                         | Retrieval, context assembly, memory policy, broader Memory lifecycle                                  |
| Sessions, Tasks and Runs         | Baseline       | Product **Definition → Work → WorkRun** lifecycle with typed WorkRun input, immutable resolved manifest, Product state/Trace projection, runtime binding, durable lifecycle events, final assistant Message, replayable SSE, owner-scoped cancellation, and the retained technical Task/Run execution tree | Runtime Session V2 create/resume/status, incremental deltas, retry, receipts, recovery                |
| Runtime, Tools and Credentials   | Baseline       | Paseo/OpenCode Execution Plane with native Bootstrap/per-turn separation, reusable/fresh RuntimeSession policies, external Workspace binding, platform MCP capability admission, same-Agent continuation, zero-key model selection, sanitized runtime projections, and typed Tool activity                 | Production isolation, placement, tool gateway, credential broker, approvals, Agent Memory HTTP client |
| Artifacts and Evidence           | Planned        | Result text only; Work-first Web deliberately renders Artifacts as unavailable rather than inferring deliverables                                                                                                                                                                                          | Immutable Artifact versions, evidence, source and child lineage                                       |
| Channels, API and Console        | Baseline       | Product WorkDefinition `validate/plan/apply`, DefinitionVersion reads, Work/WorkRun Product APIs, Run Trace, fixed Lark compatibility, Developer CLI/client, and canonical Work-first Next.js BFF/UI with explicit Start Run                                                                               | Web console, canonical identities, broader Lark adapter                                               |
| Schedules, Triggers and Delivery | Planned        | None                                                                                                                                                                                                                                                                                                       | Idempotent admission, controlled schedules/events, durable delivery                                   |

## Identity and Access

**Outcome:** one internal user and tenant authorization model across Web, API, Lark, OIDC, and service accounts.

**Baseline:** Product Work, Work Definition, Task, Run, and Memory APIs require a configured service-account bearer token. The server resolves tenant/workspace/principal scope from that binding, persists scope/snapshot facts where admission requires them, scopes idempotency by owner, and hides foreign resources with owner-safe not-found behavior. This is still service-account MVE identity, not production user/membership authorization.

**V1 acceptance:** external identities map to canonical users; membership and Workspace authorization are checked at admission and use; tenant storage isolation is tested; deprovisioning revokes future access; no caller may supply an effective principal. SAML/SCIM contracts may be reserved without claiming production support.

## Agents and Teams

**Outcome:** users publish reusable, immutable definitions instead of depending on an ad hoc runtime conversation.

**Managed registry baseline:** the managed Agent package contract validates one safe YAML 1.2 document, canonicalizes it, and records a SHA-256 fingerprint. PostgreSQL stores durable managed `AgentDefinition`/`AgentVersion` records. Import and publish are idempotent; publication is immutable. Owner-scoped drafts remain readable/listable/publishable through the registry API, while technical Task admission resolves only explicit published versions. Foreign and missing resources remain hidden. The managed Agent package contract does not claim arbitrary model execution or that referenced tools and skills are available merely because their references parse.

**Agent Teams v2 baseline:** a bounded Team has one Lead and a non-empty declared roster. `TeamDriver`, Workboard/Mailbox collaboration, participant activation, revision-fenced commands, bounded attempts, completion decisions, and addressed continuations live in the control plane. Platform Collaboration MCP is mounted as a platform capability and authorized at call time; it is not represented as a user/domain tool ref. Team coordination remains independent of a shared Paseo session.

**Composition-first Product baseline:** Product `WorkDefinition` authoring supports `single_agent` and bounded `collaboration`. A Definition may reference exact immutable Agent/Environment/Memory versions or inline Agent/Environment authoring source. `validate` and `plan` are side-effect free; `apply` materializes inline resources through existing registry semantics, publishes an immutable Product DefinitionVersion, resolves exact resource identities, and records a stable resolved fingerprint. For collaboration the author declares Lead/members rather than a Team ID; the internal Team binding remains an execution detail.

**V1 acceptance:** Agent and Team share one Invokable contract; published versions are immutable; graph compilation validates references, schemas, reachability, bounds, completion, failure and capability attenuation; Team coordination never requires a shared Paseo session.

The MVE does not claim crash recovery, restart/resume, generalized retry, dynamic roster mutation, generalized graph execution, or production readiness.

## Workspace and Memory

**Implemented minimum:** the adapter opens one dedicated filesystem directory, assigns an explicit title, and reuses its Paseo Workspace ID. Phase C adds private database-owned Product Workspaces and multiple-workspace principal ownership. The API-first MVE adds PostgreSQL Memory Stores, stable Memories, immutable Versions, strict path/content validation, atomic SHA-256 CAS, no-op/revert behavior, and exact owner isolation. Phase E adds Product-Workspace-owned accepted entries, immutable monotonic snapshots, verified local `MEMORY.md`/`manifest.json` projections, and authenticated read/rebuild routes. Responses expose no local filesystem paths.

Legacy principal-private proposals and accepted entries remain separate and are not merged into Product Workspace snapshots. The self-learning MVE adds an owner-scoped LearningProposal review path whose accept/edit-and-accept operation uses canonical Memory content-SHA CAS to create the Memory Version; the runtime has no Memory-write grant. Phase F adds the minimum Fresh ProductSession recall path: explicit published AgentVersion, admission-pinned ready snapshot ID/hash, verified local read, separated Session Bootstrap/per-turn input, and final assistant Message persistence. It does not add old history or Workspace scans. This minimum intentionally stops before retrieval, embeddings, vector search, ranking, or provider-native mounting.

Phase G adds a deterministic default-off memory policy with `disabled`, `proposal`, and `auto_safe` modes. Auto-safe is limited to the exact allowlist (`terminology`, `output_preference`, `project_constraint`, `confirmed_workflow_procedure`) and trusted current-user/structured-system sources. Decisions expose only safe reason-code traces. The gardener is proposal-only; the existing manual proposal/review HTTP path is unchanged.

Phase H minimum release evidence is approved: the managed single-agent transcript, fault lane, recovery inspection, and operations packet are recorded. Production hardening and rollout readiness remain deferred.

**V1 acceptance:** Product Workspace owns members, source snapshots, context, files, artifacts, accepted memory, retrieval policy, and memory proposals. Leaf runs write only to their scoped scratch/candidate paths. Memory changes are proposals with source and authority, not silent prompt mutation.

## Sessions, Tasks and Runs

**Product Work baseline:** the canonical MVE product journey is `WorkDefinition -> Work -> WorkRun -> Product state / Run Trace`. Work creation pins an immutable DefinitionVersion. Starting a Product-authored WorkRun validates the bounded input contract before provider admission, durably records the input fingerprint/snapshot, resolves runtime capability requirements, freezes the exact resource manifest, and only then admits the technical root Task. Single-Agent and bounded-collaboration Work share this admission pipeline while retaining their appropriate execution policies.

Work and WorkRun list APIs preserve their original compatibility ordering when no order is supplied and expose bounded latest-first product ordering for Work-first consumers (`updated_desc` for Work, `created_desc` for WorkRun). Cursor traversal is seek-based rather than offset-based.

**Managed Environment baseline:** the authenticated Managed Environment API is implemented with fixed Paseo/OpenCode/free-only package values. ProductSession creation pins a published EnvironmentVersion, and first use creates one internal RuntimeSession, launch snapshot, and derived Runtime Cell per ProductSession. Composition-first Work also pins the EnvironmentVersion in the Definition/WorkRun resource manifest. This does not claim production isolation or full Runtime Session V2.

**Technical execution baseline:** authenticated `POST /api/v1/tasks:invoke` remains a compatibility/execution ingress. Durable Task/Run lifecycle state, normalized events, final assistant Message persistence, replayable SSE, cancellation, participant activation, and Team child execution remain technical control-plane machinery behind the Product Work surface. Cross-owner resources remain hidden. This is an MVE slice and does not claim full Runtime Session V2 or production recovery.

**V1 acceptance:** Task is the only node invocation identity at the execution boundary. Root/child admission and idempotency are durable. Run attempts use atomic claim, lease, activation, fence, typed completion, waiting/resume, cancel, retry, reconciliation, and immutable terminal history.

Agent Teams v2 materializes child Tasks/Runs only for bounded Lead turns, Work attempts, and addressed direct-message continuations. It does not claim generalized graph execution or recovery.

## Runtime, Tools and Credentials

**Baseline:** Paseo is behind the Execution Plane/runtime ports; domain/application code does not depend on the Paseo package. OpenCode models are discovered at startup; automatic selection is free-only; provider errors are normalized; caller model selection is forbidden. Native Bootstrap/per-turn execution sends stable system/context setup at Agent creation and continues later turns according to the resolved RuntimeSession policy.

Platform MCP capabilities are registered separately from managed Agent domain tool refs. Composition admission checks the required runtime capabilities before technical Task/provider admission, and the WorkRun resource manifest pins the exact resolved Definition/Agent/Environment/Memory/Skill/Tool/platform-capability facts used for execution.

Local development is host-native: Agent Server, Web, and optional Paseo runtime
processes run on the developer host. A reachable native PostgreSQL instance is
used when real PostgreSQL semantics are required; ordinary development can use
PGlite. This is not production sandboxing, tenant isolation, or a placement
guarantee.

**V1 acceptance:** dedicated execution placement, compatibility suite, normalized events, audience-bound capability tokens, credential-aware tool operations, approval policy, receipt-based side-effect recovery, and no raw business credential in a runtime-readable surface.

## Artifacts and Evidence

**Current status:** planned. Result text and Trace exist, but there is no formal immutable delivered Artifact object yet. The Work-first UI intentionally leaves its Artifacts tab unavailable rather than promoting arbitrary assistant text/files/tool output into a deliverable.

**V1 acceptance:** candidate, partial, and final outputs are immutable Artifact versions. Finalization creates a version rather than mutating a manifest. Evidence identifies source capture time and data-as-of. Root Team output retains child lineage across retries.

## Channels, API and Console

**Developer/Product API baseline:** one `work.yaml` plus a service-account token can drive `validate -> plan -> apply -> immutable DefinitionVersion -> Work -> typed WorkRun -> Product state / Run Trace`. `ProductDeveloperClient` and `agentctl definition|work` are thin helpers over those resource APIs rather than a second orchestration truth. Exact Product DefinitionVersion reads are available by version ID; the original Team-shaped Work Definition read remains compatibility-only.

**Work-first Web baseline:** `/` is the canonical My Work entry. It renders server-projected Product state and latest Run summary, opens Work Detail with Overview / Runs / Artifacts / Definition, supports an explicit Start Run control, and reads the exact Product DefinitionVersion used by the selected current or historical Run. The same-origin BFF keeps the Agent Server bearer server-side. Work/WorkRun latest ordering is requested from the Product API rather than reconstructed by downloading every historical page. Canonical Work-first browser tests run in deterministic CI.

The Web Chat + Paseo rich-events path remains at `/chat` as a compatibility/runtime-debugging surface. Native EventSource consumes BFF SSE and the runtime projects complete `assistant_text` snapshots plus sanitized reasoning disclosures, typed Tool previews, direct-child activity, usage, and permission projections. Provider payloads, credentials, provider IDs, unsafe paths, and unbounded detail remain excluded.

The Agent Teams v2 project view remains a fixed local/single-operator compatibility observation surface. Its same-origin strict BFF projects safe Team execution state and replay without exposing RuntimeSession prompts/raw provider events. Product Work-first UI is the canonical product entry rather than this compatibility Team project identity.

The fixed Lark compatibility baseline adds one explicitly enabled `agent-test` App, one configured group, one allowlisted external user, and one service-account Tenant/Workspace/AgentVersion tuple. Verified bot-mention replies in one thread resolve its root binding and Product Session; unrelated roots retain separate Sessions. Successive Agent Runs in one Product Session reuse one bound provider Agent when continuation is available. Every Card-eligible Memory proposal immediately creates a Bot-owned editable Doc before `card_with_doc` publication. New Cards render only Open Doc, Accept, and Reject; legacy edit/Preview actions remain inbound-only. It does not create canonical Users or Memberships or claim production identity. Provider delivery is retryable and bounded; it is not physical exactly-once or production readiness.

**V1 acceptance:** Web/API/Lark normalize into one authorization/admission model; Task trees and Run events are inspectable; no UI subscribes directly to Paseo; delivery is retryable and idempotent.

## Schedules, Triggers and Delivery

**V1 SHOULD:** a schedule fire or external event is persisted and deduplicated before Task materialization. A model may propose but cannot directly create a permanent schedule. When the feature is disabled, manual Work/Task submission is the explicit fallback.

## Explicitly deferred from this baseline

The following remain deferred and must not be inferred from the current MVE:

- Full Runtime Session V2 create/resume/status APIs, incremental provider deltas, generalized retries/receipts, and production recovery;
- broader Work console behavior such as pagination controls, cancel/retry/approval UX, old-session restart recovery, multi-user production Web identity/security hardening, and large-scale browsing/performance work;
- transaction-concurrency hardening beyond proven invariants, crash recovery, legacy nullable Session cleanup, grant renewal/header persistence, Host placement/GC, a second adapter, and production isolation;
- retrieval injection or broader automatic memory behavior; no production rollout is claimed;
- formal Artifact/Evidence delivery, Inbox/Review product flows, schedules/triggers, generalized DAG/nested Teams/dynamic rosters, billing/quotas, and multi-region operation;
- Multi-App or multi-user channel administration, preview successor lease fences, post-canonical retry/fencing, manual rebuild races, rolling allocator races, generalized synthesis retry/audit, crash recovery, multi-node leadership, extra redrive/fault injection, performance hardening, and production identity/rollout.
