# Lark Managed Memory Canary Design

**Date:** 2026-07-24
**Status:** verified fixed compatibility normal path; deferred hardening remains
in the active Task 14 follow-up plan
**Risk tier:** R3 — external channel, durable state, identity compatibility,
core dependency, and external writes

## Outcome

Deliver one complete, real Lark/Feishu canary for the existing Managed Agent
Workspace Memory flow:

1. an allowlisted user sends a new group root message that mentions the
   `agent-test` bot;
2. Agent Server admits exactly one durable Message, Task, Run, and dispatch;
3. a real Agent produces one Workspace Memory proposal;
4. the user reviews, edits, and accepts the proposal through a Card-first Lark
   interaction, with a Bot Doc for long content and a Thread command fallback;
5. Agent Server publishes and verifies a ready immutable `MEMORY.md` snapshot;
6. the user sends a second new Lark root message;
7. a second Fresh Product Session pins that exact snapshot ID and hash; and
8. a second real Agent recalls the edited accepted constraint without relying
   on the first Thread transcript.

The canary is explicitly non-production service-account compatibility mode. It
does not claim canonical Lark user identity, enterprise multitenancy, physical
exactly-once provider delivery, multi-node leadership, or full crash recovery.

## Authority and fixed decisions

This design reconciles:

- explicit user decisions in the 2026-07-24 planning session;
- current repository code, tests, Product/Feature/Component/Contract docs, and
  completed Managed Single-Agent plans;
- the working draft `Channel Foundation & Lark Integration V1` roadmap;
- the local real-Lark evidence in
  `RESEARCH-2026-07-24-lark-agent-test-e2e.md`;
- current official Node SDK and installed `lark-cli` behavior; and
- Hermes Agent `a61183b56fdb45b9d2a0f2f6b8482e665ccf702f` as
  non-authoritative adapter evidence.

Fixed decisions:

- use the existing `agent-test` Feishu App and proven test group;
- support one allowlisted external user, one group, one Tenant, one Workspace,
  one service account, and one published AgentVersion;
- require `@Bot` for new group root messages;
- use a meaningful-content Card for short proposals, a Bot-owned Doc plus
  control Card for long proposals, and Thread commands as fallback and
  automation;
- preserve Proposal, Memory Entry, and Memory Snapshot as the only canonical
  review facts;
- keep the current load-bearing PostgreSQL Session turn transaction intact;
- use three sequential local implementation phases on one branch, followed by one
  final PR under one approved delivery objective;
  and
- plan and execute from `origin/master` commit
  `61478c5aacb299c58ae35cafca7e410ff16439e0`, which contains merged
  documentation-lifecycle PR #8.

## Acceptance boundary

The delivery is complete only when all three interaction surfaces work as one
state machine and the final real-Lark recall succeeds:

- a short proposal is reviewed through an interactive Card;
- a long proposal uses Card summary plus an editable Bot Doc and explicit
  acceptance of an immutable previewed content hash;
- Thread commands can complete the same review as an automated and recovery
  fallback;
- cross-modality retries cannot create conflicting Memory decisions;
- duplicate/replayed inbound messages cannot create duplicate Tasks;
- review is not reported complete until a ready snapshot exists; and
- the second-root Task stores the exact ready snapshot ID/hash used by the
  second real Agent.

## Architecture

```text
Lark WS dispatcher
  → minimal envelope validation and normalization
  → durable channel_ingress_events insert
  → provider acknowledgement

Ingress worker
  → fixed connection configuration
  → chat/user/@Bot validation
  → root binding resolution
  → SubmitSessionTurn
  → existing Message/Task/Run/Admission/Dispatch transaction

Terminal Task notifier
  → find successful source-run Memory proposals
  → create one logical review-surface outbox intent per proposal

Delivery worker
  → Card, Card + Bot Doc, or command-only fallback
  → persist provider IDs and review-surface projection

Card action / Thread command / Doc preview confirmation
  → durable control ingress
  → revalidate actor/chat/root/surface/proposal
  → ReviewMemoryProposal
  → ManagedMemory.acceptEntry
  → verify ready snapshot
  → update the selected Lark surface

Second new @Bot root
  → new binding and Fresh Product Session
  → SubmitSessionTurn
  → exact ready snapshot pin
  → real Agent recall
```

Lark is an adapter. It does not own a second Session, Task queue, Runtime,
Memory store, authorization model, or approval truth.

Proposal → accepted Entry → ready snapshot remains the only canonical Memory
authority. Cards and Docs are projection/control surfaces only: they may display,
collect, preview, or resolve a decision, but they never become Memory truth.

## Shared Session turn admission

Add a narrow `SubmitSessionTurn` application use case used by both HTTP and
Lark. It accepts only a server-created trusted origin:

```ts
type SessionTurnOrigin =
  | { channel: 'api'; requestId: string }
  | { channel: 'lark'; ingressEventId: string };
```

The use case performs authorization and invokes one repository operation. The
existing PostgreSQL transaction continues to own lane locking, idempotency,
snapshot pinning, Message/Task/Run/Admission/Dispatch writes, and lane sequence
updates. This delivery does not replace that transaction with primitive CRUD or
a generic Unit of Work.

The public HTTP request/response contract remains unchanged. Database and
internal contracts add controlled `api | lark` origin values and an optional
origin reference.

## Lark ingress and conversation binding

### Message identity

- Business deduplication key: Lark `message_id`.
- Trace-only value: Lark `event_id`.
- Conversation root key: `root_id ?? message_id`.
- Reply target: current inbound `message_id`.

### Concurrency-safe first root

The unique binding key is:

```text
(connection_key, chat_id, root_message_id)
```

The first-root transaction or retry-safe create-if-absent protocol must ensure
that concurrent duplicate delivery creates one binding, one Product Session,
one Session turn, and one Task. It must not create a Product Session first and
leave it orphaned after losing the binding race.

Thread replies reuse the root binding. A different root message creates a new
Fresh Product Session while retaining the same configured Workspace and
AgentVersion.

## Fixed compatibility identity

Startup configuration supplies:

- stable connection key and App/domain/transport;
- allowed chat ID;
- allowed external user `open_id`;
- Tenant, Workspace, service-account, and published AgentVersion IDs;
- configuration/policy version; and
- secret environment references.

No inbound message, Card action, command, or Doc may select an internal
principal, Workspace, or AgentVersion.

For every control action, revalidate:

1. configured App/connection;
2. exact chat;
3. exact allowlisted operator;
4. root binding;
5. proposal ownership tuple;
6. current unresolved surface version; and
7. proposal pending state or exact idempotent replay.

The canonical reviewer remains the fixed service account because the current
Memory contract has no canonical User. The durable channel record separately
stores the external Lark actor and source ingress ID. This is audit provenance,
not a claim that the Lark actor is a Workspace member.

## Proposal-to-review notification

Proposal creation alone does not prove user-visible review readiness. A
deterministic terminal Task notifier runs only after a successful source
Task/Run:

1. query proposals by source Task/Run;
2. verify the source Run succeeded;
3. create one unique review intent per proposal;
4. select the primary interaction surface; and
5. enqueue the corresponding Channel Outbox delivery.

The logical uniqueness key includes proposal ID, surface kind, and surface
version. Failed or non-terminal source Runs do not publish review surfaces.

## Card-first interaction policy

Card and Doc are projection/control surfaces, and command is the fallback input
surface, all converging on one canonical review command rather than independent
workflows.

### Selection rules

- Short means **both** no more than 1,500 characters and no more than 20 lines.
  Short content uses a meaningful-content Card titled as pending Workspace
  Memory.
- Any proposal over either threshold uses one Bot-owned Doc immediately and a
  control Card. The full text and edit area live in the Doc.
- Card delivery or Doc creation failure: one bounded Thread fallback message
  with command syntax.
- Automated E2E and operator recovery: Thread command.
- Do not proactively emit three duplicate review messages.

### Card

The short Card is titled as pending Workspace Memory and contains the category,
full proposal text, and a safe source explanation. It has exactly the meaningful
actions Accept, Edit in Doc, and Reject. It does not use the proposal UUID as
user-facing primary text. `Edit in Doc` creates or opens the Bot-owned Doc and
changes the Card to control mode.

The long-proposal control Card contains a readable excerpt, Doc URL/status, and
the controls Open Doc, Read Changes and Generate Preview, Accept Preview, and
Reject. Full proposal text and the collaborative editing area remain in the
Doc; the Card is not an inline text-input surface.

`card.action.trigger` is consumed by the same local WebSocket dispatcher. The
handler:

1. validates bounded envelope fields;
2. commits one control ingress record;
3. returns quickly; and
4. lets a worker perform canonical review and update the Card.

Card JSON uses version 2.0. Each active surface has one opaque random surface
token; only its SHA-256 hash is persisted. Every button callback value is the
bounded JSON shape `{ action: <enum>, token: <opaque random token> }`. The enum
is client-visible and untrusted, and must be valid for the current surface mode
and status. The token is client-visible and tamperable and is never an
authority-bearing credential. The server uses token-hash lookup plus Card
message ID, chat, operator, action, surface version, source Session, and exact
owner-tuple checks before acting. No proposal ID, accepted content, owner
identifier, or provider callback update token enters the action value.
Correctness never depends on process-memory Card state.

The bot replies in the source Thread with a stable provider UUID. Delayed Card
changes use the provider `message.patch`/`update_multi` operations by message
ID. If a Card update fails after the canonical decision commits, the decision is
not rolled back; the worker records the safe failure and preserves command
fallback.

### Bot Doc

For a long proposal, the Bot immediately creates one Bot-owned review document
and grants edit access only to the configured allowlisted user. Its body is the
proposal itself as one normal collaborative draft that the user may edit
directly. Source explanation, review instructions, and Card/command fallback
remain on the control Card rather than being mixed into the draft. The Card
explains that unresolved comments and replies are revision requests, not literal
Memory content. Therefore the latest bounded Doc body is the complete draft;
there is no magic section or fragile metadata-block parser.

The Doc is bounded at 200 blocks. Accepted content is limited to 4,096 UTF-8
bytes. No magic heading or specially delimited `Final Accepted Content` section
is required. The Bot-owned Doc is a collaboration surface, not canonical Memory.

Doc edits and comments never directly mutate Memory. The explicit Card action
`Read Changes and Generate Preview` is the synchronization boundary; document
change events are not a correctness dependency. On that action, Agent Server:

1. revalidates the Card actor, chat, proposal, source Session, owner tuple, and
   active surface version;
2. fetches the latest bounded document blocks/body and provider revision when
   available;
3. completely paginates unresolved document comments and their replies. Body
   text is the draft; comments/replies are instructions for revising it, not
   text to append mechanically;
4. asks the managed Agent to synthesize one bounded candidate Memory from that
   body and feedback;
5. stores the candidate content, SHA-256 hash, and source document revision when
   available on a new immutable review surface version, then updates the Card
   with a safe excerpt/hash; and
6. `Accept Preview` accepts exactly the persisted content/hash after
   revalidating actor, chat, proposal, source Session, owner tuple, Card action,
   and surface version.

Later Doc edits do not change the previewed content or accepted Memory Entry.
The user must invoke `Read Changes and Generate Preview` again to include later
changes. Provider revision metadata is supporting evidence, not the race
control; the persisted candidate and hash define what can be accepted. Raw
comments and replies are not retained.

Comment retrieval uses the Drive file-comment APIs for the Docx file token and
must paginate both comments and replies. The implementation does not silently
ignore comments. If the body is readable but comment authorization, pagination,
or reply retrieval is incomplete, it may show a diagnostic body-only excerpt
but must mark comments unavailable and must not create an accept-enabled
preview. Resolved comments are not active revision instructions. Event
subscriptions may later provide hints, but the Card action always performs a
fresh authoritative pull.

### Thread commands

Fallback commands are control-plane actions and are never sent to the Agent as
prompts:

```text
/memory accept <proposal-id>
/memory edit-and-accept <proposal-id> <content>
/memory reject <proposal-id>
/memory preview-doc <proposal-id>
/memory accept-preview <proposal-id> <surface-version>
```

Commands remain the fallback and automation surface. They revalidate the same
identity and surface rules as Card actions and converge on the same
`ReviewMemoryProposal`/`ManagedMemory` canonical operations. The proposal UUID
is a bounded command argument, not the primary Card/Doc UX text. Already-resolved
or cross-modality replay returns a stable safe result.

## Review-to-ready orchestration

The current canonical review and snapshot publication are separate operations.
The Lark review worker preserves that boundary:

```text
review proposal
→ materialize accepted Memory Entry
→ ManagedMemory.acceptEntry
→ rebuild and publish MEMORY.md
→ verify ready snapshot and hash
→ update Lark review surface
```

An accepted proposal is not reported as complete until the snapshot reaches
`ready`. Publication retries resume from the accepted Entry without changing
the canonical review decision. The final surface records safe references to the
proposal, entry, snapshot ID, and snapshot hash prefix.

## Minimal durable data model

Use five additive tables.

### `channel_ingress_events`

Stores normalized message and control facts:

- configured connection key;
- kind: `message | card_action | command`;
- provider event/message/dedup IDs;
- chat/root/thread/reply target IDs;
- external actor `open_id`;
- bounded normalized text or action;
- normalization schema version;
- related proposal/surface when applicable;
- status, attempt count, safe error code;
- admitted Session/Task or applied review result; and
- timestamps.

Unique keys:

- message/command: connection + external message ID, regardless of normalized
  kind, so replay or reclassification cannot create a second ingress;
- Card action: connection + kind + provider event ID.

Raw provider payload and provider callback update token are not retained. The
opaque surface action token is represented only by its persisted SHA-256 hash.

### `channel_conversation_bindings`

Stores configured connection key, chat ID, root message ID, Product Session ID,
creating ingress ID, status, and timestamps. It does not introduce generalized
personal/shared/generation semantics.

### `channel_outbox`

Stores target binding/reply target, delivery kind, aggregate ID/version,
bounded rendered payload, deterministic provider UUID, status/lease/retry time,
last safe error, and ambiguity state.

### `channel_delivery_attempts`

Stores attempt number, provider request/message ID when available, result
(`delivered | retryable_failure | permanent_failure | unknown`), safe error
code, and timestamps. It is also the receipt evidence; no separate receipt
table is added.

### `lark_memory_review_surfaces`

Stores proposal and binding IDs, mode (`card | card_with_doc | command_only`),
Card message ID, Doc token, optional provider revision, immutable preview
content/hash, surface version/status, creating/resolving ingress IDs, and
timestamps. It permits exactly one active surface version per proposal/binding
review and uses compare-and-set transitions plus idempotency keys for creation,
preview, resolution, and replay. A stale or duplicate transition cannot replace
the active version or reopen canonical Memory.

Not added in this canary:

- mutable `channel_connections` resource;
- separate control-command or receipt tables;
- ExternalIdentity/Membership tables;
- dynamic channel registry; or
- generic capability framework.

## State models

Keep three orthogonal state models.

Canonical Memory proposal:

```text
pending → accepted
pending → rejected
```

Review surface projection:

```text
planned → publishing → active_card | active_card_with_doc | command_only
active_* → processing → resolved
active_* → stale | delivery_unknown | command_only
```

Delivery:

```text
pending → sending → delivered
sending → retry_wait → sending
sending → permanent_failed | delivery_unknown
```

Canonical Memory state always wins. A stale Card, Doc, or command cannot reopen
or alter a resolved proposal.

## SDK and process topology

Use `@larksuiteoapi/node-sdk@1.71.1` only after a focused compatibility gate
proves:

- access to event, message, chat, root/thread/reply, mention, and sender IDs;
- group `@Bot` delivery with required Channel signaling;
- committed durable insert before message acknowledgement;
- committed control ingress plus Card callback response behavior;
- shutdown, reconnect, and single-consumer behavior;
- deterministic fixture normalization;
- send/reply/update UUID, `message.patch`/`update_multi`, and safe
  error/rate-limit shapes; and
- Bot Doc creation, permission grant, content fetch, and block parsing.

Prefer low-level `WSClient`/`EventDispatcher` for inbound correctness because
the higher-level Channel queue does not yet prove durable insert before
acknowledgement. `lark-cli` drives tests and inspects evidence; it is not a
production runtime dependency.

Run Lark as a separate entrypoint sharing Application and Infrastructure
services with the API. One process-level App lock prevents concurrent local
consumers. This is adequate for the one-host canary and is not a distributed
singleton claim.

## Bounds and data handling

- normalized inbound text: 8,192 characters maximum;
- command payload: 8,192 characters maximum;
- accepted Memory content from Card, command, or Doc: 4,096 characters maximum;
- short-card full proposal body: 1,500 characters maximum and 20 lines maximum;
- long-card readable excerpt: bounded and never the editable full content;
- parsed Bot Doc: 200 blocks maximum;
- fetched unresolved Doc comments: 100 maximum; replies: 200 total maximum;
  combined comment/reply text: 32,768 UTF-8 bytes maximum. Complete pagination
  within those bounds is required before an accept-enabled preview;
- accepted content: 4,096 UTF-8 bytes maximum;
- stored safe error text: 512 characters maximum;
- raw event retention: none; and
- provider callback update tokens: memory-only for immediate response and never
  evidence; surface action tokens are persisted only as SHA-256 hashes.

Unknown fields are ignored after preserving the safe normalized schema version.
Secrets, access tokens, raw provider errors, raw events, local paths, and full
configuration files cannot enter database content, Agent prompts, ordinary
logs, user messages, or evidence packets.

Oversized Doc content or feedback, Doc create/grant/read/update/permission
failures, incomplete comment/reply pagination, stale or duplicate Card actions,
cross-user actions, and mismatched Card message/chat/operator/surface/source-
session/owner checks fail safely. An unpreviewed or comments-incomplete Doc is
never accepted. If a canonical decision has committed, a later Card or Doc
update failure cannot roll it back.

## Outbound retry and unknown results

Use a stable logical outbox key and deterministic provider UUID. Retry only
while the provider idempotency window and local policy make replay safe.

For the crash window:

```text
provider send succeeds → process exits → attempt receipt is not committed
```

the result becomes `delivery_unknown` when provider lookup or safe UUID replay
cannot prove the outcome. Do not silently resend an interactive review surface
after the idempotency window expires. Surface recovery through the Thread
command path and record operator reconciliation evidence.

The delivery claim is bounded retry with explicit unknown outcome, not physical
exactly-once and not guaranteed logical convergence.

## Error handling and recovery

- Database unavailable before ingress commit: do not return successful provider
  acknowledgement; allow redelivery.
- Duplicate message/action/command: return the existing materialized result.
- Unknown user/chat/App or missing verified mention: fail closed without Task.
- Binding race: reuse the unique winning binding/session.
- Card callback expiry: update by message ID or send one command fallback.
- Card delivery failure: send one bounded command fallback.
- Doc creation/grant/body fetch failure: retain Card/command path and do not
  create a preview.
- Comment or reply authorization/pagination failure: expose
  `comments_unavailable`, retain Card/command recovery, and do not enable
  acceptance of a body-only preview.
- Agent synthesis failure: preserve the active Doc surface and allow a bounded
  retry; do not mutate canonical Memory or reuse a partial candidate.
- Snapshot publication failure: keep canonical accepted Entry, mark publication
  failure, retry publication, and do not claim ready.
- Outbound ambiguous result: mark `delivery_unknown`; do not blind-retry after
  safe provider idempotency expires.
- Worker restart: reclaim durable ingress/outbox work with leases and bounded
  attempts.

## Verification strategy

### Deterministic

- fixture normalization for messages, mentions, root/thread/reply IDs, and Card
  actions;
- short-card Accept, long-flow body-plus-unresolved-comment pull/synthesis,
  Accept Preview, command fallback, renderer/fetch bounds, complete pagination,
  comments-unavailable fail-closed behavior, and post-preview Doc-edit
  immutability;
- identity, ownership, surface-version, and stale-action authorization;
- shared HTTP/fake-Lark `SubmitSessionTurn` parity;
- real PostgreSQL duplicate, concurrent first-root, restart, lease, and crash
  windows;
- terminal Task proposal notifier uniqueness;
- canonical cross-modality Memory decision idempotency;
- ready snapshot publication and exact pinning;
- fake-adapter delivery success/retry/permanent/unknown behavior;
- existing Session, Task, Run, Memory, cancellation, and owner-isolation suites;
- fake-runtime real-socket Lark-style E2E; and
- `make ci` plus real PostgreSQL gates under Node 24.

### Real Lark and real Agent QA

Use the existing `agent-test` profile and test group. The Agent Server Lark
worker is the sole event/Card consumer; do not run a competing `lark-cli event
consume` process.

The orchestrator owns one consumer, the real Agent process, unique messages,
Doc API edits, database checks, and sanitized runtime-log checks. The already
captured real Card 2.0 click proves callback subscription, WebSocket delivery,
and provider envelope shape. Deterministic and business-handler tests may replay
that sanitized envelope with action-specific opaque values. The final provider
QA still sends, renders, reads, and patches actual business Cards and creates,
grants, edits, and reads actual Docs; canonical database, Memory, snapshot, and
Fresh Session recall evidence proves the business effects. No repeated user
click is required unless live provider behavior materially differs.

This is compositional real-boundary evidence: it combines the captured callback
transport proof, deterministic handler replay, and final real provider surface
checks. It does not claim that one later uninterrupted live click drove the
entire business workflow.

Evidence includes:

1. automated Thread-command source → review → ready snapshot → new-root recall;
2. the captured real callback transport shape and deterministic/business-handler
   replays for short-card Accept and long-flow Read Changes and Generate
   Preview/Accept Preview;
3. final real provider Card rendering/patching and Doc
   create/grant/edit/comment/read checks, including comment replies and
   comments-unavailable behavior, plus post-preview Doc edit immutability;
4. duplicate/replay and process-restart evidence;
5. sanitized ingress, binding, Session, Task, Run, proposal, review ingress,
   outbox/attempt, entry, snapshot ID/hash, and second recall Task correlation;
6. exact new-root Product Session difference and ownership tuple match; and
7. real Agent output containing the accepted marker but not rejected, late, or
   first-Thread-only content.

### Captured Card callback transport evidence

One real Card 2.0 button click has now been captured through the `agent-test`
profile. The callback subscription was explicitly enabled and published in the
developer console; the listener reported ready and connected. `lark-cli event
consume card.action.trigger` received exactly one event and exited at its event
limit after the bounded observation window.

The sanitized shape matched the configured operator, sent Card message, and test
chat: `operator_id`, `message_id`, and `chat_id` were present; `host` was
`im_message`; `action_tag` was `button`; and the action value was the JSON string
`{ "action": "probe_card_callback", "probe_id": "agent-server-20260725-0128" }`.
An event ID was present and globally unique. The callback update token is
intentionally excluded from documentation. The captured probe used an action
enum plus opaque probe value; business Card buttons use the same two-field
protocol with action-specific enum values and the active surface token.

The fetched `card_content` was present as Card 2.0 userDSL but did not contain
callback behavior or the action value. Authorization must therefore use the
validated callback envelope and server-side surface state, never `card_content`.
The observed provider timestamp was a 16-digit opaque scalar despite the CLI
schema name `timestamp_ms`; normalization must be deliberate rather than
assuming its unit. This transport capture is enough for deterministic fixtures
to replay the sanitized shape; repeated manual probe clicks are not required.
It does not prove business Card/Doc review, snapshot publication, or the full
real Card/Doc E2E.

External Lark/model availability is QA evidence, not a deterministic pull
request gate.

## Sequential local phases and final PR

Execute all three phases sequentially on one branch. Each phase retains its
focused tests and acceptance gate; phase completion does not require an
intermediate commit, merge, or PR. Open one final PR only after Phase 3 and the
full canary evidence are complete.

### Phase 1 — Shared turn admission seam

- add `SubmitSessionTurn` and trusted origin/reference;
- route HTTP through it;
- preserve the existing PostgreSQL transaction;
- add fake-Lark parity, concurrency, real-PG, and Memory pinning regression
  evidence; and
- do not add the Lark SDK or Channel tables.

### Phase 2 — Durable fixed-Lark text path

- complete and approve the SDK compatibility gate;
- add four core tables: ingress, binding, outbox, and attempts;
- implement fixed startup configuration, App lock, WebSocket message receiver,
  group gates, binding, text/command fallback, proposal notifier, and delivery;
- prove one root → one Session/Task and different root → Fresh Session; and
- keep Feature status internal/canary-incomplete.

### Phase 3 — Card/Doc Memory review and final canary

- add the review-surface table;
- implement Card render/update/callback;
- implement Bot Doc creation/grant, latest body plus unresolved comment/reply
  reading, Agent synthesis, immutable preview hash, and acceptance;
- route Card/Doc/command through canonical review and ready publication;
- complete deterministic, real-Lark, and real-Agent evidence; and
- update Product/Feature/Component/Contract/ADR/Runbook/Evidence authority.

Each phase must satisfy its independent acceptance boundary before the next
phase starts. Phase 3 normal-path command/Card/Doc implementation and evidence
are verified; deferred hardening is not falsely marked complete.

## Documentation impact

Execution must update:

- `docs/features.md` with accurate incremental status;
- `docs/components/channel-api-console.md`;
- channel/runtime contracts and ingress origin semantics;
- architecture/data/tenancy documents affected by the fixed compatibility
  boundary;
- an ADR for Channel ownership, low-level Lark transport, and compatibility
  identity;
- a Lark setup/operations/recovery runbook;
- a sanitized Lark Managed Memory evidence packet; and
- the active Exec Plan throughout all three phases and before the final PR.

## Human Gates before implementation

The 2026-07-24 user execution approval resolves and accepts all gates:

1. official Node SDK version/addition;
2. additive migration and uniqueness/retention design;
3. `api | lark` trusted origin contract;
4. fixed service-account compatibility identity and external actor audit;
5. persistence of safe Lark identifiers with no raw-event retention;
6. Bot Doc creation and grant to the allowlisted test user;
7. bounded retry plus `delivery_unknown` external-write policy;
8. real App/group/user external QA execution; and
9. Card/Doc/manual evidence as release QA rather than deterministic CI.

The approval authorizes dependency addition, migrations, safe identifiers,
fixed service-account compatibility, the Bot Doc grant, bounded retry and
`delivery_unknown`, real Lark writes, and manual Card/Doc QA.

On 2026-07-25 the user additionally approved the collaborative Doc semantics:
the Bot creates the Doc in Bot-owned space, shares an editable link, the user
edits the body and/or leaves comments, and a Card button explicitly triggers a
fresh read and Memory preview. Accept Preview remains a separate explicit action.

The user also approved one narrow orchestration exception for this flow. Doc
revision synthesis is an intermediate operation of the proposal's existing
Product Task, so it may invoke the managed Agent again through a dedicated
application service backed by `AgentRuntimePort`; it does not create a second
Product Task or canonical Run. The call uses the controlling ingress ID as its
runtime request ID, disables Memory candidate generation, returns one bounded
plain-text candidate, and never imports Paseo outside the runtime adapter. This
exception does not authorize arbitrary direct model calls elsewhere. Durable
preview content/hash and the controlling ingress provide the MVP replay and
acceptance boundary; generalized synthesis retry/audit state remains post-E2E
hardening.

Task 13 real-provider normal-path evidence was verified on 2026-07-25. Sanitized
source/Run/Card/proposal/Entry/snapshot/fresh-recall identifiers and markers are
recorded in `docs/evidence/lark-managed-memory-card-doc-canary-evidence-packet.md`.
The source marker first appearing in ready snapshot version 5 proves fresh-root
pin/recall; production `readDraft` verified edited body plus unresolved comment
and reply before Preview. This is normal-path compatibility evidence only.

The user explicitly cancelled Task 14 implementation for this PR. The deferred
follow-up owns exact Preview successor lease/attempt fencing, post-canonical
retry/fencing, manual rebuild versus concurrent Accept, rolling allocator races,
generalized synthesis retry/audit, crash/restart/fault injection, multi-node
leadership, and performance hardening.

## Non-goals

- Lark P2P;
- multiple users, groups, Apps, Workspaces, Agents, or Tenants;
- Canonical User/Membership/Link Code;
- production multi-tenant or distributed leadership claims;
- mutable ChannelConnection administration;
- a general Channel plugin registry or second channel;
- attachments, arbitrary post/media parsing, streaming tokens, milestones, or
  proactive messages;
- complete `/help`, `/status`, `/cancel`, or `/new` commands;
- automatic Doc edit subscriptions;
- Card/Doc state as canonical Memory truth;
- generalized dead-letter/redrive UI;
- physical exactly-once Lark delivery; and
- re-proving every existing Memory isolation case through external Lark.

## Recovery and rollback

- Phase 1 can be reverted while retaining API semantics because trusted origin is
  additive.
- Phase 2 can disable the Lark worker and connection configuration without deleting
  received durable records.
- Phase 3 can disable Card/Doc surfaces and retain Thread command recovery while
  preserving canonical Memory decisions.
- Additive migration rollback must not delete received ingress, delivery, review
  surface, or external actor audit evidence.
- PR #8 is merged at `61478c5`; cleanup of its prior worktree is a separate
  verified maintenance action and is not required to begin this planning lane.
