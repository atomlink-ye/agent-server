---
status: active
owner: platform-engineering
created_at: 2026-07-23
updated_at: 2026-07-23
authority: approved-design-spec
document_type: repo-native-design-spec
approval_status: approved
source_revision: 3e5e61d4af9798e83bee2160725f40ac9d39cb96
---

# Managed Single-Agent Scenario V1

This document is the approved repository-native design specification for the
Managed Single-Agent Scenario V1. It is a design reference, not the Active Exec
Plan and does not claim that the described capability is implemented.

## 1. Outcome and release boundary

V1 delivers one complete, API-driven managed-agent journey:

```text
Managed Agent YAML
  -> validate/import draft
  -> publish immutable Agent Version
  -> create private Workspace
  -> create Fresh Product Session
  -> persist a User Message
  -> admit Task + Run + dispatch intent
  -> execute through Paseo
  -> persist normalized status, events, and Final Message
  -> create Memory Proposal
  -> review or policy-gated auto-safe promotion
  -> render immutable MEMORY.md snapshot
  -> create another Fresh Session that uses that snapshot
```

The release is **API + SSE + deterministic automated E2E/API transcripts**.
It has no Web Console or other UI deliverable. The canary scenario is a
Competitor Researcher whose accepted project constraint is recalled by a later
Fresh Session, without inheriting the earlier hidden conversation.

The delivery is one autonomous umbrella task completing PR gates A through H,
Slices 0 through 6, all slice acceptance criteria, and this roadmap/spec's
Definition of Done. This does not claim completion of a repository-wide
Single-Agent Core milestone, credential broker, Artifact product, Web/Lark, or
backup/restore work. A through H remain distinct staged commit and review gates
even though they are delivered under that one umbrella task.

## 2. Authority, baseline, and conflict policy

### 2.1 Sources

The design was derived from the repository at baseline revision
`3e5e61d4af9798e83bee2160725f40ac9d39cb96`, including its README, product and
feature ledger, component boundaries, contracts, and agent handbook. The
roadmap source is the 2026-07-23 Managed Single-Agent Scenario V1 execution
plan supplied during design review. This specification incorporates the
approved decisions and acceptance boundary needed for repository work, so the
external roadmap mirror and its private Drive links are not repository
dependencies.

### 2.2 Conflict policy

Conflicts are resolved in this order:

1. Explicit approved decisions in the task that requested this specification.
2. This approved repo-native design specification.
3. Repository Product, Feature, Component, Contract, Architecture, Quality,
   Operations, and Agent documents.
4. The local roadmap mirror and historical review evidence.
5. Existing code and passing tests as implementation evidence, never as an
   implicit change to the product boundary.

Any change to a public API, tenant/security boundary, durable state model,
model-selection authority, or core dependency is a Human Gate. A change is
recorded in the relevant staged gate and affected contract before
implementation proceeds.

### 2.3 Fixed approved decisions

- One autonomous umbrella task completes roadmap PR A-H / Slice 0-6, every
  slice acceptance criterion, and this roadmap/spec DoD only; it does not claim
  a repository-wide Single-Agent Core milestone, credential broker, Artifact
  product, Web/Lark, or backup/restore.
- Delivery is API + SSE + automated E2E/API transcripts; no UI.
- Paseo is the only V1 runtime provider.
- YAML contains `modelPolicyRef`, but V1 accepts only built-in allowlisted
  policy references. The platform resolves models through policy; automatic
  resolution is free-only, and callers cannot provide model names or choose an
  arbitrary model. Automatic selection never silently selects a paid model.
- Existing service-account bearer authentication remains the public auth
  mechanism. A principal may own multiple private Workspaces. Authentication
  binds tenant, principal, and policy; each requested Workspace ID is
  authorized by database ownership, not by equality with one configured
  Workspace. Existing compatibility binding behavior is preserved for old
  routes during migration. Shared ACLs, OIDC, SAML, and SCIM are out of scope.
- Follow-ups are durable queued turns. There is no mid-run input protocol.
- Memory uses proposal/review governance. `auto_safe` is implemented but
  default-off until its evaluation gates pass and an explicit policy enables
  it.
- Artifact and projection writes use a `FileStore` port with a local atomic
  filesystem implementation in this release.
- PR A-H are separate staged commit/review gates. D and E may implement in
  parallel after C; F depends on both D and E.
- Historical PR review P1 findings are not separate scope unless required by
  a roadmap acceptance criterion or the release DoD.
- A roadmap Should Have item is included only when required by A-H acceptance
  or the DoD. The required items are cursor-based event reads/reconnect,
  simple retry where needed for recovery evidence, usage aggregation where
  needed for the runtime contract, and snapshot rebuild where needed for
  projection recovery.
- The task's DoD includes cleaning or archiving its own plan/spec state. It does
  not opportunistically rewrite old active plans; inconsistencies in those
  plans are recorded in the Follow-up Ledger.

## 3. Architecture and component boundaries

The repository remains a modular monolith with a separate Paseo process.
Dependencies point inward: entrypoints and adapters depend on application
ports; application depends on domain; domain imports neither frameworks nor
Paseo.

### Control Plane

Owns tenant-derived authorization, Agent package validation and publication,
Workspace and Session admission, policy snapshots, and review decisions. It
never accepts caller-supplied effective ownership or arbitrary model names.

### Orchestration Kernel

Owns canonical Task and Run lifecycle, one-active-root Session lane, durable
follow-up ordering, claims, leases, activation/fencing, cancellation, retry
attempts, recovery, terminal persistence, and event sequencing. Team
coordination is not expanded in this release; a V1 task is a single Agent
root with no Team children.

### Paseo Runtime Adapter

Implements `AgentRuntimePort` and translates the normalized V1 runtime contract
to Paseo. Paseo packages do not cross into domain or application code. The
adapter owns provider session creation/resume, normalized provider events,
disconnect/reconnect, cancel, health, and safe provider-error mapping.

### Credential and Tool Gateway boundary

The boundary remains explicit even where full credential CRUD is out of scope.
Runtime-readable capabilities are policy-bound and secret-safe. Raw credentials,
tokens, and provider secrets never enter prompts, ordinary tool results,
responses, or logs.

### Workspace and Artifact Store

Owns private Workspace data, context files, memory entries, immutable snapshots,
manifest files, and scoped scratch/proposal paths. Application code uses the
`FileStore` port. The V1 implementation is a local filesystem store that writes
temporary files, fsyncs, atomically renames, and verifies hashes before marking
content ready.

### Channel, API, and SSE

Normalizes HTTP requests into one authorization and admission path. It exposes
the public API and replayable SSE event stream. SSE is an observation adapter,
not the source of truth; clients hydrate durable snapshots after subscribing.

### Data and Operations

Owns PostgreSQL migrations, durable dispatch intents, audit facts, request and
correlation IDs, redaction, health, metrics, evidence export, and operational
recovery. Real PostgreSQL is required for multi-connection transaction and
locking evidence; PGlite remains useful for fast repository tests.

## 4. Managed Agent YAML and versioning

The supported package is `apiVersion: agent-server/v1alpha1`,
`kind: ManagedAgent`. The package contains metadata and a `spec` with:

- description and non-empty instructions;
- `runtime.provider: paseo`, `runtime.modelPolicyRef`, and controlled mode;
- published tool and skill references;
- a constrained JSON Schema input definition and prompt template;
- session policy (`fresh_per_invocation`, queued follow-ups, reusable binding);
- workspace snapshot memory policy and proposal limits;
- permission policy and executable completion contract.

Import creates or updates a Draft. Validation is strict: unknown fields,
unsupported schema, missing template fields, unavailable references, excessive
budgets, and secret-like values are rejected without echoing sensitive input.
The implementation adds the small standard `yaml` library as a planned
dependency, uses YAML 1.2 safe parsing with aliases/anchors disabled, and
enforces a strict schema. The supported JSON Schema subset is
`object`/`string`/`number`/`integer`/`boolean`/`array` with
`required`/`properties`/`items`/`enum`/`min`/`max`/`pattern` and
`additionalProperties: false`; `$ref` and combinators are unsupported. The
only template syntax is `{{ input.<declaredField> }}`. Secret scanning is
bounded, safe, and non-echoing. This is not a major framework or core
dependency change. Normalization uses canonical JSON and SHA-256 fingerprinting.
`metadata.name` identifies the owner-scoped `AgentDefinition`. An import with
a changed canonical fingerprint creates a new draft version; the same
idempotency key and body returns the original result, while the same key with a
different body conflicts. Publish creates an immutable `AgentVersion`; a
published version is never mutated. A Session pins its explicit Agent Version
and never drifts to `latest`.

The V1 model folds the task template into Agent Version. It does not add a
separate ScenarioVersion or a second Invokable hierarchy.

## 5. Phase design: PR A-H / Slice 0-6

### A — Stabilization and real PostgreSQL lane (Slice 0)

Stabilize the existing canonical Task invoke and runtime seam before adding
the product journey. Fix the transaction-visibility defect, terminal
persistence classification, Paseo reconnect fast path, and confirmed
external-smoke/auth/dev-environment residuals. Add a real `pg.Pool`
multi-connection integration lane and a Follow-up Ledger for explicitly
deferred historical findings. Prove the pinned Paseo client capabilities,
including resume, cancellation, and update/stream events; this proof gates D
and F.

Acceptance: first real PostgreSQL Task invoke returns committed `202`; the
same idempotency key replays; a terminal-write failure is not reported as
runtime execution failure; a disconnected Paseo socket can reconnect; and CI
contains the real PostgreSQL lane.

### B — Managed Agent YAML and registry API (Slice 1)

Add validation, canonicalization, fingerprinting, draft/import/read/version
listing, publish, owner-scoping, immutability enforcement, secret scanning,
reference checks, input-schema validation, and prompt-template compilation.
The import identity and idempotency rules are those in Section 4; no undefined
clone endpoint is required.

Public routes:

```text
POST /api/v1/agent-packages:validate
POST /api/v1/agents:import
GET  /api/v1/agents/{agent_id}
GET  /api/v1/agents/{agent_id}/versions
GET  /api/v1/agent-versions/{version_id}
POST /api/v1/agent-versions/{version_id}:publish
```

Acceptance: equal YAML has equal canonical spec and fingerprint; invalid
unknown or secret-like fields are safely rejected; published versions cannot
be mutated; same-key same-body imports replay and same-key different-body
imports conflict; changed fingerprints create new draft versions under the
owner-scoped `metadata.name`; cross-owner reads are hidden; and Task invoke
accepts only published versions.

### C — Workspace, Product Session, durable Message, and Session Lane (Slice 2)

Add the minimum private Workspace resource, Product Session, durable ordered
Message, and one-active-root queue. Every user turn is admitted transactionally
as Message, root Task, Run attempt 1, idempotency record, dispatch intent, and
Session queue metadata. Messages arriving while a Task runs are persisted as
queued follow-up Tasks and never injected into the active runtime turn.

Public routes:

```text
POST /api/v1/workspaces
GET  /api/v1/workspaces/{workspace_id}
POST /api/v1/sessions
GET  /api/v1/sessions/{session_id}
GET  /api/v1/sessions/{session_id}/messages
POST /api/v1/sessions/{session_id}/messages
POST /api/v1/sessions/{session_id}:reset
```

Acceptance: three concurrent follow-ups are all durable and execute in order;
only one root executes at once; cancel leaves later work queued; reset
preserves Workspace and Memory while advancing generation, requests
cancellation for an active old-generation Task, terminalizes queued
old-generation Tasks with explicit `cancelled_by_reset`, and gives the new
generation none of them; and non-owners cannot read any Session, Message, or
Task.

### D — Runtime Session V2, normalized events, SSE, and cancel (Slice 3)

Extend the runtime port from one-shot execution to explicit provider-session
binding and normalized observation:

```text
capabilities()
createOrResumeSession()
submit()
readEvents()
status()
cancel()
close()
health()
```

The pinned `@getpaseo/client` version is `0.1.110`; its `resumeAgent`,
`cancelAgent`, and update/stream events are exposed through the normalized
adapter. No dependency upgrade is planned. Add boundary event persistence,
monotonic database event sequences, cursor-query and `Last-Event-ID` resume,
subscribe-before-hydrate, Final Message persistence, cancellation requests,
stale-fence rejection, reconnect, redaction, and bounded usage aggregation.
Phase A's capability proof gates D and F.

Public routes:

```text
GET  /api/v1/runs/{run_id}/events
GET  /api/v1/runs/{run_id}/events/stream
POST /api/v1/tasks/{task_id}:cancel
```

Acceptance: a late subscriber receives later deltas and a complete final
message; cursor query and `Last-Event-ID` reconnect use monotonic database
event sequences and do not duplicate an idempotent terminal event; hydration
recovers from lost deltas; cancel is durable and forwarded to Paseo; stale
activation writes are rejected; disconnects recover or become an explicit
failure; and no event contains secrets.

### E — Memory ownership hardening and file snapshots (Slice 4 data/projection)

Make memory logically owned by `tenant + workspace`, while preserving legacy
principal-private records without merging across principals. Import agent-origin
proposals from a run-scoped candidate file,
attach message/task/run/version provenance, support accept, edit-and-accept,
and reject, and render accepted entries deterministically to immutable Snapshot
versions. Create `MEMORY.md` and `manifest.json` through `FileStore`; verify
content hashes and publish a latest-ready pointer only after an atomic commit.

Public memory routes include the existing proposal/review surface plus:

```text
GET  /api/v1/workspace-memory/proposals/{proposal_id}
GET  /api/v1/workspaces/{workspace_id}/memory/entries
GET  /api/v1/workspaces/{workspace_id}/memory/snapshots
GET  /api/v1/workspaces/{workspace_id}/memory/snapshots/{snapshot_id}
POST /api/v1/workspaces/{workspace_id}/memory/snapshots:rebuild
```

Acceptance: accepted entries produce immutable Snapshot vN; edits render the
reviewed text; rejection produces no entry; old Tasks retain their admission
snapshot; failed projections never expose partial files; other Workspaces
cannot read the data; and rebuilding yields the same content hash.

### F — Context Assembly and Fresh Session memory projection (Slice 4 runtime loop)

After D and E, assemble deterministic runtime input from a verified local
read-only file projection and deterministic context assembly; this is not a
provider-native mount claim. The order is: runtime contract, published instructions,
current Task input, Workspace context files, recent Final Messages or summary
from the current Product Session, admission-pinned Memory Snapshot, tool/skill
summary, and runtime-specific resume data. No embedding or full Workspace
scan is performed.

Fresh means a new Product Session, new Runtime Session Binding, selected Agent
Version, same Workspace, latest ready or explicitly selected Snapshot at
admission, and no old Product Session Message History. A Task never changes
memory snapshot during execution.

Acceptance: a new Fresh Session recalls accepted memory; rejected, late, and
other-Workspace content is absent; old Tasks remain pinned; reset archives the
old binding; and a ready local projection is assembled read-only with verified
hash.

### G — Auto-safe Memory and Gardener suggest mode (Slice 5)

Implement policy evaluation for `disabled`, `proposal`, and `auto_safe` write
modes and the initial allowlist (`terminology`, `output_preference`,
`project_constraint`, `confirmed_workflow_procedure`). Auto-safe requires a
trusted current User Message or structured source, rejects secrets, PII,
conflicts, permissions, legal/financial/security actions, and untrusted web or
tool instructions, and records a policy decision trace. Gardening may propose
deduplication, supersession, expiry, or compaction; it cannot invent facts,
alter instructions or permissions, or mutate history.

Model resolution remains limited to built-in allowlisted policy references;
automatic resolution is free-only and accepts no caller model names.

All auto-safe decisions are `system_policy` facts. The feature is implemented
but disabled by default. It may be enabled only after evaluation thresholds
are met: zero unsafe auto-accepts, zero rejected-memory leakage, zero
cross-Workspace leakage, and zero secret exposure. Manual proposal review
remains the default release path.

### H — Fault injection, operations, and release evidence (Slice 6)

Add deterministic fault-injection tests and the release Evidence Packet. Cover
admission crash, post-claim worker crash, runtime success followed by terminal
write failure, runtime and SSE reconnect, temporary snapshot crash,
manifest/hash mismatch, reset/run races, concurrent follow-ups, duplicate
reviews, idempotency replay, cross-Workspace access, stale activation,
cancellation, and service restart.

Deliver runbook and forward-recovery procedures, rollback controls, known
limitations, follow-up ledger, migration list, test transcript, real
PostgreSQL evidence, Paseo smoke evidence, fault evidence, memory evaluation,
and reviewer decision. H is complete only when this roadmap/spec DoD is
evidenced; it does not claim unrelated repository-wide milestones or products.

## 6. Core object and data model

### Agent and Workspace

- `AgentDefinition`: stable owner-scoped identity and name.
- `AgentVersion`: immutable normalized spec, fingerprint, policy snapshots,
  references, completion contract, validation report, and compiler version.
- `Workspace`: `tenant_id`, name, status, creator actor snapshot, timestamps;
  it owns Sessions, Tasks, Runs, Entries, Snapshots, and files.
- `ProductSession`: Workspace + Agent Version + effective principal snapshot,
  status, reset generation, latest ready Memory Snapshot, and active root Task.

### Message, Task, Run, and runtime binding

- `Message`: immutable role/content fact with Workspace/Session identity,
  optional Task/Run links, database sequence, source, actor snapshot, and
  `final | partial | error` status. Final Messages are durable; deltas are
  not the sole history.
- `Task`: the only invocation identity. Each user turn is a root Task with
  input Message, Agent Version, Session generation, policy and memory input
  snapshots, and completion contract.
- `Run`: an attempt for a Task. Retry creates a new Run and never revives a
  terminal attempt. Claim, lease, activation, fence, usage, cancellation,
  receipt, and terminal outcome are durable.
- `RuntimeSessionBinding`: provider session tied to Product Session and reset
  generation, with Agent Version, policy fingerprint, creation-time memory
  snapshot, and `active | archived | invalid` state. At most one active
  binding exists per Session generation.
- `RunEvent`: tenant/Workspace/Session/Task/Run scoped monotonic database
  sequence, normalized type, redacted payload, visibility, and timestamp.

### Memory and files

- `MemoryProposal`: pending/accepted/rejected proposal with category, content,
  proposer and reviewer snapshots, authority/sensitivity/confidence, and
  source Message/Task/Run/Agent Version references. It remains as audit history.
- `MemoryEntry`: append-only accepted content. A change creates a new Entry and
  supersedes the old one; content is never overwritten.
- `MemorySnapshot`: immutable Workspace version with ordered Entry IDs,
  manifest, renderer/policy versions, content hash, and FileStore URI.
- `MemoryProjection`: pending/ready/failed projection record. A failed
  projection does not revoke accepted Entries and cannot become mountable.
- `FileStore`: application port for scoped put/read/verify/atomic commit. The
  local implementation uses a private filesystem root; absolute local paths
  never appear in public responses or normal logs.

## 7. Public API and runtime target

All write routes accept `Idempotency-Key`; all routes use the standard request
ID and safe error envelope, reject unknown fields and oversized bodies, derive
owner scope from the authenticated service account, and hide cross-owner reads
as not found. Responses expose stable resource links and aggregate version or
ETag information without credentials, secrets, prompts, raw provider errors,
or local paths.

The public surface is:

```text
POST /api/v1/agent-packages:validate
POST /api/v1/agents:import
GET  /api/v1/agents/{id}
GET  /api/v1/agents/{id}/versions
GET  /api/v1/agent-versions/{id}
POST /api/v1/agent-versions/{id}:publish
POST /api/v1/workspaces
GET  /api/v1/workspaces/{id}
POST /api/v1/sessions
GET  /api/v1/sessions/{id}
GET  /api/v1/sessions/{id}/messages
POST /api/v1/sessions/{id}/messages
POST /api/v1/sessions/{id}:reset
GET  /api/v1/tasks/{id}
GET  /api/v1/tasks/{id}/tree
GET  /api/v1/runs/{id}
GET  /api/v1/runs/{id}/events
GET  /api/v1/runs/{id}/events/stream
POST /api/v1/tasks/{id}:cancel
POST /api/v1/workspace-memory/proposals
GET  /api/v1/workspace-memory/proposals
GET  /api/v1/workspace-memory/proposals/{id}
POST /api/v1/workspace-memory/proposals/{id}/review
GET  /api/v1/workspaces/{id}/memory/entries
GET  /api/v1/workspaces/{id}/memory/snapshots
GET  /api/v1/workspaces/{id}/memory/snapshots/{snapshot_id}
POST /api/v1/workspaces/{id}/memory/snapshots:rebuild
```

The existing `/api/v1/runs` compatibility admission remains over the
canonical Task/Run model and does not permit arbitrary model selection.

### Runtime port target

`AgentRuntimePort` accepts a complete immutable execution envelope containing
tenant, Workspace, Product Session, Task, Run, attempt, activation and fence,
Agent Version, Runtime Binding, input Message, Task input, memory snapshot,
context hash, effective principal/policy snapshots, timeout, and budget.
It exposes capabilities, create/resume, submit, event read, status, cancel,
close, and health. The port returns normalized lifecycle/events/results and
typed safe errors. Provider session IDs and raw provider details remain inside
the adapter boundary.

## 8. Data flows and invariants

### Message and Task admission

One database transaction inserts the User Message, root Task, first Run,
idempotency record, dispatch intent, and Session queue metadata. The transaction
commits before `202` is returned. The Session lane atomically claims at most one
queued root; later messages remain durable queued turns and drain by database
sequence after the active Task reaches terminal state.

### Execution and events

The dispatcher claims a Run with lease and fence, activates it, obtains or
resumes the Session binding, and submits the frozen input. Boundary events and
Final Message are persisted independently of transient SSE deltas; terminal
events are idempotent. The client
subscribes before hydration, using a cursor query or `Last-Event-ID`; it merges
monotonic database events with the Task/Run/Session/Message snapshot. Missing deltas never imply missing final
history.

### Memory flow

The runtime writes only a candidate proposal file under its run-scoped scratch
area. The control plane validates and persists a pending Proposal with
provenance. Review or a passing auto-safe policy creates an Entry. The renderer
orders entries deterministically, writes `MEMORY.md` and `manifest.json` via
atomic FileStore commit, verifies hashes, and marks the Snapshot ready. A Task
pins its Snapshot at admission; a Fresh Session chooses the latest ready
Snapshot or an explicitly selected ready Snapshot.

### Invariants

1. Task is the sole invocation identity; Run is an attempt.
2. Every accepted execution intent is durable before runtime dispatch.
3. One Product Session generation has at most one executing root Task and one
   active Runtime Binding.
4. Follow-ups are ordered durable Tasks, never mid-run input.
5. Only the current activation and fence may write Run terminal state/events.
6. Terminal Run history is immutable; retries create new attempts.
7. Agent Versions and Memory Snapshots are immutable after publication/ready.
8. Runtime input includes fixed policy, identity, Agent Version, and memory
   snapshots; context cannot drift silently.
9. Workspace ownership is server-derived and every read/projection assembly is
   owner-scoped.
10. Runtime and SSE are replaceable; durable facts remain the source of truth.
11. A verified local projection is usable only after atomic commit and hash
    verification; no provider-native mount is assumed.
12. No secret, token, raw credential, private path, or raw provider error is
    exposed in normal API/event/log output.

## 9. State, errors, and recovery

Session states are `active -> resetting -> active` with incremented generation,
or `archived`. Reset requests cancellation for an active old-generation Task,
terminalizes queued old-generation Tasks as `cancelled_by_reset`, and new
generation work never inherits them. A lane has no active Task, then queued, active, and
drains the next queued Task. Bindings move from absent/creating to active and
then archived or invalid. Proposals are pending to accepted or rejected;
accepted Entries can become superseded or expired. Projections are pending,
ready, failed, or rebuild-pending.

Admission errors are safe and typed: invalid JSON/schema and unknown fields are
client errors; unavailable or unpublished versions are not found or blocked;
cross-owner resources are not found; duplicate idempotency keys replay the
original result or reject a conflicting body; non-pending Proposal review is a
conflict; stale activation/fence writes are rejected without changing state;
and cancellation is idempotent.

Runtime unavailability does not discard an admitted Message/Task/Run. The Run
stays queued or blocked until health returns, subject to bounded policy. A
provider disconnect reconnects/resumes when the binding and fence are valid;
otherwise the Run receives a normalized terminal runtime error. If runtime
success is followed by terminal database failure, the Run is not relabeled
`runtime_execution_failed`: a receipt/result remains for reconciliation.

After a worker crash, lease and fence evidence prevent the old worker from
writing terminal state. The release must either perform bounded reconciliation
or expose an operator-recovery state with a documented command; it must never
silently duplicate work. Snapshot projection crashes leave the Snapshot not
ready and preserve the previous ready Snapshot. Hash mismatch fails closed or
falls back to that previous ready Snapshot and raises an observable alert.

## 10. Security and privacy

The existing service-account bearer token is the only V1 public auth. Each
authenticated request binds tenant, principal, and policy; a principal may own
multiple private Workspaces, and requested Workspace IDs are authorized by
database ownership rather than equality with one configured Workspace. Tenant,
Workspace, principal, and policy facts come from the server-side access binding
and are snapshotted at admission. Existing compatibility binding behavior is
preserved for old routes during migration. There are no shared ACLs.
Cross-owner responses do not disclose titles, counts, paths, hashes, or
existence.

YAML validation rejects secret patterns and never echoes matched values. Agent
instructions explicitly distrust webpage/tool instructions for memory. Runtime
capabilities are attenuated by policy; business credentials are not prompt,
workspace, shell, log, event, or ordinary response data. Event payloads,
memory proposals, manifests, traces, and evidence exports use the same
redaction policy. FileStore roots are private; verified local projections are
supplied read-only to the leaf runtime. High-risk external writes, arbitrary computer use, and credential
management are not V1 capabilities.

## 11. Migrations and forward recovery

Migrations add or extend Agent Version snapshots, Workspaces, Product Sessions,
Messages, Runtime Bindings, Run Events, memory provenance, immutable Snapshot
metadata, projections, dispatch/recovery facts, and required owner-scoped
constraints/indexes. Existing baseline Task/Run and governance-memory records
remain readable. Legacy principal-private memory records are preserved without
merging across principals. New Workspace ownership applies prospectively;
unresolved mixed-owner data fails closed and is surfaced in migration evidence.
Compatibility projections preserve the existing Run routes.

Each migration is additive or forward-repairable, idempotent, and deployable
before the code that consumes the new columns. No destructive down migration is
required for rollback. Backfills are resumable and checkpointed. A failed
projection can be rebuilt from accepted Entries; an interrupted atomic write
is ignored until verification succeeds. Rollback disables new API/session,
event, projection, or auto-safe behavior while preserving historical Tasks,
Messages, Proposals, Entries, Snapshots, and bindings.

## 12. Test, evaluation, and evidence design

Unit coverage includes YAML normalization/fingerprint, schema and secret
scanning, template compilation, version immutability, lane transitions, event
ordering, cancellation, renderer determinism, manifest/hash, policy decisions,
supersession, context assembly, and error mapping.

Contract coverage includes all Agent, Workspace, Session, Message, Task/Run,
SSE, cancel, review, Snapshot, owner-hiding, idempotency, unknown-field,
body-size, and safe-error rules.

Real PostgreSQL integration coverage includes transaction visibility, concurrent
same-key admission, follow-up ordering, lane claims, concurrent review,
Snapshot version allocation, owner constraints, stale fences, migrations, and
dual-connection locks. PGlite is not the sole evidence for these semantics.

Runtime adapter coverage includes create/resume, submit, normalized events,
disconnect/reconnect, timeout, permission error, cancel, cursor replay,
duplicate/out-of-order events, stale fences, secret absence, and capability
negotiation. Deterministic E2E/API transcripts cover YAML to final message,
follow-up queue, SSE reconnect, cancel plus next Task, proposal acceptance to
Fresh Session recall, rejection, reset, isolation, and runtime recovery.

The real Paseo/free-model smoke is required for runtime-boundary release
evidence but is not a deterministic pull-request gate. Deterministic CI must
not require model network access or free-model availability.

Memory evaluation uses explicit constraints, terminology, preferences,
temporary instructions, injection, secret-like text, stale facts,
contradictions, duplicates, irrelevant tool output, and permission-changing
requests. It measures precision, unsafe auto-accepts, duplicates,
contradictions, Fresh Session recall, rejected-memory leakage, preservation,
and context budget. Auto-safe release gates are zero unsafe auto-accept,
rejected-memory leakage, cross-Workspace leakage, and secret exposure.

The Evidence Packet records baseline and staged commits, migrations, exact test
commands and results, PostgreSQL and Paseo evidence, fault injection, memory
evaluation, API transcripts, limitations, rollback, and reviewer decision.

## 13. Non-goals

V1 does not implement Team parallelism or joins, dynamic delegation, vector
search, embeddings, semantic RAG, global Agent Memory, schedules, triggers,
proactive work, OIDC/SAML/SCIM, shared collaboration, arbitrary desktop
computer use, Agent mutation of published versions, direct MEMORY.md writes,
high-risk automatic external writes, full Artifact/Evidence productization,
multi-node worker fleets, exactly-once external side effects, or a general
mid-run human question/resume protocol. UI is also a non-goal.

## 14. Phase acceptance gates and autonomous decision rules

Each gate must have its own staged commit, focused regression evidence, affected
contract/doc updates, and review checkpoint. The umbrella task may proceed
without waiting for a separate product task, but must not merge gates or conceal
an unmet gate. D and E can run concurrently only after C is accepted; F cannot
start its integration claim until both D and E pass.

An implementation agent may choose the safest compatible detail when the choice
does not alter the fixed decisions, public contract, security boundary, or
durable model. The default choices are: fail closed on ambiguity, preserve
durable facts over transient output, use the prior ready snapshot on projection
failure, use policy rather than caller model input, queue rather than inject
follow-ups, and return owner-hiding not-found responses.

An agent must stop at a Human Gate when a proposed change affects public fields
or status meaning, ownership/ACL/authentication, durable state or migration
semantics, runtime responsibility, model-selection authority, or a core
dependency. It must record the conflict and proposed resolution rather than
silently expanding scope.

The umbrella task is accepted only when all A-H gates, all required slice
acceptance criteria, security checks, deterministic CI, real PostgreSQL
evidence, critical E2E/API transcripts, runtime smoke evidence, fault evidence,
documentation impact, rollback path, and this roadmap/spec DoD are present.
This acceptance does not claim unrelated repository-wide milestones or
products. `auto_safe` remains disabled by default even after implementation
unless its evaluation gates and explicit policy enablement are recorded.
