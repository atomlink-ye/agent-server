# Features

This is the authoritative capability ledger. Status values are `implemented`, `baseline`, `planned`, and `reserved`. `baseline` is a proven seam with known temporary limitations; it is not production completion.

## Capability snapshot

- **Identity and Access — Baseline.** Service-account bearer auth and server-derived owner scope. V1 destination: tenant, canonical user, OIDC/Lark, ACL, and richer service accounts.
- **Agents and Teams — Baseline.** Cumora-style Coworker Agent identity is separated from formal Worker execution. Active Product Work uses `WorkerDefinition` / `WorkerVersion`, `single_worker`, Worker-only Team composition, exact owner scope, and a frozen WorkRun resource manifest. Agent Work Catalog bindings expose exact published WorkDefinition versions without making the Coworker an execution authority. V1 destination: dynamic rosters, nested Teams, and generalized graphs.
- **Workspace and Memory — Baseline.** Authenticated PostgreSQL Memory Store → stable Memory → immutable Version API with SHA-256 CAS, no-op/revert semantics, exact owner scope, plus retained proposal/snapshot/Lark compatibility paths. V1 destination: retrieval, context assembly, memory policy, and broader Memory lifecycle.
- **Coworker Work Organization — Baseline.** Workspace-scoped durable WorkItems (UI: Tasks), comments and Boards/columns/placements; persisted Conversation message → WorkItem; assignment; idempotent WorkItem → formal Work promotion; canonical Work completion → backend `in_review` projection; human `done`. V1 destination: notifications, richer review policy, Calendar/trigger integration, and multi-board projections when justified.
- **Sessions, Tasks and Runs — Baseline.** Product `Definition → Work → WorkRun` lifecycle with typed WorkRun input, immutable resolved manifest, Product state/Trace projection, runtime binding, durable lifecycle events, final assistant Message, replayable SSE, owner-scoped cancellation, and the retained technical Task/Run execution tree. V1 destination: Runtime Session V2 create/resume/status, incremental deltas, retry, receipts, and recovery.
- **Runtime, Tools and Credentials — Baseline.** Paseo/OpenCode Execution Plane with native Bootstrap/per-turn separation, reusable/fresh RuntimeSession policies, external Workspace binding, platform MCP capability admission, same-Agent continuation, zero-key model selection, sanitized runtime projections, and typed Tool activity. V1 destination: production isolation, placement, tool gateway, credential broker, approvals, and Agent Memory HTTP client.
- **Artifacts and Evidence — Planned.** Result text only; Work-first Web deliberately renders Artifacts as unavailable rather than inferring deliverables. V1 destination: immutable Artifact versions, evidence, source lineage, and child lineage.
- **Channels, API and Console — Baseline.** Product WorkDefinition `validate/plan/apply`, DefinitionVersion reads, Work/WorkRun and WorkItem/Board Product APIs, Run Trace, fixed Lark compatibility, Developer CLI/client, and the single Vite Work/Coworker shell with server-side BFF routes. V1 destination: Web console, canonical identities, and broader Lark adapter.
- **Schedules, Triggers and Delivery — Planned.** No current Product surface. V1 destination: idempotent admission, controlled schedules/events, and durable delivery.

## Identity and Access

**Outcome:** one internal user and tenant authorization model across Web, API, Lark, OIDC, and service accounts.

**Baseline:** Product Work, Work Definition, WorkItem/Board, Task, Run, and Memory APIs require a configured service-account bearer token. The server resolves tenant/workspace/principal scope from that binding, persists scope/snapshot facts where admission requires them, scopes idempotency by owner, and hides foreign resources with owner-safe not-found behavior. This is still service-account MVE identity, not production user/membership authorization.

**V1 acceptance:** external identities map to canonical users; membership and Workspace authorization are checked at admission and use; tenant storage isolation is tested; deprovisioning revokes future access; no caller may supply an effective principal. SAML/SCIM contracts may be reserved without claiming production support.

## Agents and Teams

**Outcome:** users interact with long-lived Coworkers while formal Work executes through reusable immutable Workers.

**Coworker baseline:** PostgreSQL stores durable managed `AgentDefinition`/`AgentVersion` records for user-visible Coworkers. Import and publish are idempotent; publication is immutable. Agent publication can provision the Coworker Chat relationship and active Chat runtime. The Agents roster is explicit Coworker identity and is not inferred from Team membership.

**Worker baseline:** formal execution has an independent `WorkerDefinition`/`WorkerVersion` registry. Worker import/publish is idempotent and immutable, uses exact tenant/workspace/principal owner scope, and has no Chat publication side effect. The current Worker package grammar reuses hardened executable parsing introduced for managed Agents; this is parser reuse only and does not merge product identity or lifecycle.

**Agent Teams v2 baseline:** a bounded Team has one Lead and a non-empty declared roster of WorkerVersion pins. `TeamDriver`, Workboard/Mailbox collaboration, participant activation, revision-fenced commands, bounded attempts, completion decisions, and addressed continuations live in the control plane. Platform Collaboration MCP is mounted as a platform capability and authorized at call time; it is not represented as a user/domain tool ref. Team coordination remains independent of a shared Paseo session. The execution-time Workboard is separate from the product Coworker Board that organizes WorkItems.

**Composition-first Product baseline:** Product `WorkDefinition` authoring is canonically `single_worker` / `worker_version_id` or bounded collaboration over Worker versions. `validate` and `plan` are side-effect free; `apply` publishes an immutable Product DefinitionVersion, resolves exact Worker/Environment/Memory/Skill/Tool identities, and records a stable resolved fingerprint. Collaboration authors declare Lead/members rather than a Team ID; the internal Team binding remains an execution detail. Active Work materialization does not import or publish Agents.

**Coworker Work Catalog baseline:** an enabled binding identifies one Coworker AgentDefinition, one WorkDefinition, and one exact published WorkDefinitionVersion from the same owner/lineage. The catalog tells Chat what formal work the Coworker can start; WorkerVersion remains the execution authority.

Historical Agent-shaped Work composition survives only in migration/audit data and explicitly named compatibility fixtures. The technical Task ingress may retain an explicit legacy direct-Agent invokable for old non-Product clients; it is not an active WorkDefinition participant model.

**V1 acceptance:** formal Work composition has one WorkerVersion authority and Team composition validates Worker refs, schemas, reachability, bounds, completion, failure, and capability attenuation. Published versions are immutable, and Team coordination never requires a shared Paseo session.

The MVE does not claim crash recovery, restart/resume, generalized retry, dynamic roster mutation, generalized graph execution, or production readiness.

## Workspace and Memory

**Implemented minimum:** the adapter opens one dedicated filesystem directory, assigns an explicit title, and reuses its Paseo Workspace ID. Phase C adds private database-owned Product Workspaces and multiple-workspace principal ownership. The API-first MVE adds PostgreSQL Memory Stores, stable Memories, immutable Versions, strict path/content validation, atomic SHA-256 CAS, no-op/revert behavior, and exact owner isolation. Phase E adds Product-Workspace-owned accepted entries, immutable monotonic snapshots, verified local `MEMORY.md`/`manifest.json` projections, and authenticated read/rebuild routes. Responses expose no local filesystem paths.

Legacy principal-private proposals and accepted entries remain separate and are not merged into Product Workspace snapshots. The self-learning MVE adds an owner-scoped LearningProposal review path whose accept/edit-and-accept operation uses canonical Memory content-SHA CAS to create the Memory Version; the runtime has no Memory-write grant. Phase F adds the minimum Fresh ProductSession recall path: explicit published AgentVersion, admission-pinned ready snapshot ID/hash, verified local read, separated Session Bootstrap/per-turn input, and final assistant Message persistence. It does not add old history or Workspace scans. This minimum intentionally stops before retrieval, embeddings, vector search, ranking, or provider-native mounting.

Phase G adds a deterministic default-off memory policy with `disabled`, `proposal`, and `auto_safe` modes. Auto-safe is limited to the exact allowlist (`terminology`, `output_preference`, `project_constraint`, `confirmed_workflow_procedure`) and trusted current-user/structured-system sources. Decisions expose only safe reason-code traces. The gardener is proposal-only; the existing manual proposal/review HTTP path is unchanged.

Phase H minimum release evidence is approved: the managed single-agent transcript, fault lane, recovery inspection, and operations packet are recorded. Production hardening and rollout readiness remain deferred.

**V1 acceptance:** Product Workspace owns members, source snapshots, context, files, artifacts, accepted memory, retrieval policy, memory proposals, Conversations, and product coordination surfaces. Leaf runs write only to their scoped scratch/candidate paths. Memory changes are proposals with source and authority, not silent prompt mutation.

## Coworker Work Organization

**Outcome:** work can become durable and assignable before it is formal enough to become a Work, while preserving the existing execution vocabulary.

The implemented object boundary is:

```text
WorkItem = coordination commitment (UI label: Task)
Work     = durable product objective
Task     = technical execution-node invocation
Run      = one Task attempt
Board    = Workspace-scoped projection over WorkItems
```

**WorkItem baseline:** authenticated owner-scoped CRUD stores title, description, closed coordination status, assignee, creator, optional source Conversation/message, optional linked Work, and timestamps. Source IDs must be supplied together. When they are present, creation verifies that the requester can read the Conversation and that the Message is already durable. Comments persist as a separate ordered record. Assignment uses the current participant/Agent identity string surface and does not introduce a second identity registry.

**Board baseline:** Boards have ordered columns and one explicit placement per WorkItem in the MVE. A WorkItem may exist without a Board. Board/column deletion removes the projection while retaining the WorkItem. Browser cards move through the canonical placement API; the Board does not create technical Tasks/Runs.

**Conversation and Work bridge:** every persisted Conversation message exposes an editable `Create task` action. The resulting WorkItem retains source references and can navigate back to the Conversation. Promotion requires an explicit published Definition identity/version and calls canonical `WorkIdentityApi` rather than writing Work rows directly. Promotion is idempotent for the WorkItem and persists exactly one linked Work identity.

**Review projection:** a linked Work's canonical Product projection is the authority. Owner-scoped WorkItem reads/lists project a successful formal Work to `in_review` unless the WorkItem is already in review/done. The browser does not infer completion from transcript/runtime output. Human action is required for `done`.

**Web baseline:** the single Coworker Workspace Rail exposes Tasks and Boards alongside Conversations, Agents, Work, and Files. `/tasks/:workItemId` and `/boards/:boardId` are deep-link selections in the same Vite shell. Work opened from a Task can navigate back using route context, while durable linkage remains backend state.

The MVE deliberately does not implement Calendar/cadence/proactive wake, Whisper/Convene, email identity, a general workflow DAG, a new runtime, or a second Workspace/Task state machine.

## Sessions, Tasks and Runs

**Product Work baseline:** the canonical MVE product journey is `WorkDefinition -> Work -> WorkRun -> Product state / Run Trace`. Work creation pins an immutable DefinitionVersion. Starting a Product-authored WorkRun validates the bounded input contract before provider admission, durably records the input fingerprint/snapshot, resolves runtime capability requirements, freezes the exact resource manifest, and only then admits the technical root Task. Single-Worker and bounded-collaboration Work share this admission pipeline while retaining their appropriate execution policies.

A Coworker `WorkItem` is not part of the execution-node identity tree. It may promote to one Work, but `Task` remains the only node invocation identity at the execution boundary.

Work and WorkRun list APIs preserve their original compatibility ordering when no order is supplied and expose bounded latest-first product ordering for Work-first consumers (`updated_desc` for Work, `created_desc` for WorkRun). Cursor traversal is seek-based rather than offset-based.

**Managed Environment baseline:** the authenticated Managed Environment API is implemented with fixed Paseo/OpenCode/free-only package values. ProductSession creation pins a published EnvironmentVersion, and first use creates one internal RuntimeSession, launch snapshot, and derived Runtime Cell per ProductSession. Composition-first Work also pins the EnvironmentVersion in the Definition/WorkRun resource manifest. This does not claim production isolation or full Runtime Session V2.

**Technical execution baseline:** authenticated `POST /api/v1/tasks:invoke` remains a compatibility/execution ingress. Durable Task/Run lifecycle state, normalized events, final assistant Message persistence, replayable SSE, cancellation, participant activation, and Team child execution remain technical control-plane machinery behind the Product Work surface. Cross-owner resources remain hidden. Worker Task admission resolves WorkerVersion through exact owner scope. This is an MVE slice and does not claim full Runtime Session V2 or production recovery.

**V1 acceptance:** Task is the only node invocation identity at the execution boundary. Root/child admission and idempotency are durable. Run attempts use atomic claim, lease, activation, fence, typed completion, waiting/resume, cancel, retry, reconciliation, and immutable terminal history.

Agent Teams v2 materializes child Tasks/Runs only for bounded Lead turns, Work attempts, and addressed direct-message continuations. It does not claim generalized graph execution or recovery.

## Runtime, Tools and Credentials

**Baseline:** Paseo is behind the Execution Plane/runtime ports; domain/application code does not depend on the Paseo package. OpenCode models are discovered at startup; automatic selection is free-only; provider errors are normalized; caller model selection is forbidden. Native Bootstrap/per-turn execution sends stable system/context setup at Agent creation and continues later turns according to the resolved RuntimeSession policy.

Platform MCP capabilities are registered separately from managed Agent domain tool refs. Composition admission checks the required runtime capabilities before technical Task/provider admission, and the WorkRun resource manifest pins the exact resolved Definition/Worker/Environment/Memory/Skill/Tool/platform-capability facts used for formal execution. Chat Agent identity is not replaced by this Worker snapshot.

Local development is host-native: Agent Server, Web, and optional Paseo runtime processes run on the developer host. A reachable native PostgreSQL instance is used when real PostgreSQL semantics are required; ordinary development can use PGlite. This is not production sandboxing, tenant isolation, or a placement guarantee.

**V1 acceptance:** dedicated execution placement, compatibility suite, normalized events, audience-bound capability tokens, credential-aware tool operations, approval policy, receipt-based side-effect recovery, and no raw business credential in a runtime-readable surface.

## Artifacts and Evidence

**Current status:** planned. Result text and Trace exist, but there is no formal immutable delivered Artifact object yet. The Work-first UI intentionally leaves its Artifacts tab unavailable rather than promoting arbitrary assistant text/files/tool output into a deliverable.

WorkItem `in_review` in the coworker MVE means the linked formal Work has reached canonical Product completion and is ready for human coordination review. It is not a formal Artifact/Evidence approval object and does not upgrade this feature area's status.

**V1 acceptance:** candidate, partial, and final outputs are immutable Artifact versions. Finalization creates a version rather than mutating a manifest. Evidence identifies source capture time and data-as-of. Root Team output retains child lineage across retries.

## Channels, API and Console

**Developer/Product API baseline:** one `work.yaml` plus a service-account token can drive `validate -> plan -> apply -> immutable DefinitionVersion -> Work -> typed WorkRun -> Product state / Run Trace`. `ProductDeveloperClient` and `agentctl definition|work` are thin helpers over those resource APIs rather than a second orchestration truth. Exact Product DefinitionVersion reads are available by version ID; the original Team-shaped Work Definition read remains compatibility-only.

**Work-first Web baseline:** the Vite Coworker/Work shell is the canonical browser product. Work renders inside the same shell as Conversations and Agents, opens Work Detail with Overview / Runs / Artifacts / Definition, supports explicit Start Run and Work Definition authoring, and reads the exact Product DefinitionVersion used by the selected current or historical Run. The same-origin Hono BFF keeps the Agent Server bearer server-side. Work/WorkRun latest ordering is requested from the Product API rather than reconstructed by downloading every historical page. Canonical browser tests run in deterministic CI.

Chat and Work are linked through durable Work references/cards rather than by sharing Agent and Worker identity. A Coworker Chat can list/describe its bound WorkDefinitions, start formal Work, receive completion wakes, and continue a Work from feedback.

Native EventSource consumes BFF SSE for Conversations/runtime activity and the runtime projects complete `assistant_text` snapshots plus sanitized reasoning disclosures, typed Tool previews, direct-child activity, usage, and permission projections. Provider payloads, credentials, provider IDs, unsafe paths, and unbounded detail remain excluded.

The Agent Teams v2 project view remains a fixed local/single-operator compatibility observation surface. Its same-origin strict BFF projects safe Team execution state and replay without exposing RuntimeSession prompts/raw provider events. Product/Coworker UI is canonical rather than this compatibility Team project identity.

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
- formal Artifact/Evidence delivery and its dedicated approval inbox, schedules/triggers, Calendar/cadence/proactive wake, Whisper/Convene, email identity, generalized DAG/nested Teams/dynamic rosters, billing/quotas, and multi-region operation;
- Multi-App or multi-user channel administration, preview successor lease fences, post-canonical retry/fencing, manual rebuild races, rolling allocator races, generalized synthesis retry/audit, crash recovery, multi-node leadership, extra redrive/fault injection, performance hardening, and production identity/rollout.
