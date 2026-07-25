---
status: completed
owner: orchestrator
created_at: 2026-07-24
updated_at: 2026-07-25
authority: execution-plan
---

# Lark Managed Memory Canary

## Outcome

Reproduce the existing real Managed Agent Workspace Memory proposal, command
review, ready-snapshot, Fresh Session, and recall flow through one fixed Lark
group, then finish the approved Card/Doc review slice. Command-path evidence is
verified; Task 10 Card transport/publication/control and the Task 11 minimum
normal path are complete. Task 12/13 normal-path evidence is verified; deferred
hardening is transferred to Task 14.

## Context and authority

- Repository baseline: `origin/master` at
  `61478c5aacb299c58ae35cafca7e410ff16439e0`.
- Design:
  `docs/superpowers/specs/2026-07-24-lark-memory-canary-design.md`.
- Detailed implementation plan:
  `docs/superpowers/plans/2026-07-24-lark-memory-canary.md`.
- External roadmap is a working draft, not execution authority:
  `channel-foundation-lark-integration-v1-execution-plan-2026-07-24.md`.
- Local Lark evidence proves the `agent-test` App can receive group `@Bot`
  messages and preserve root/thread/reply identifiers.
- Hermes Agent at local reference commit `a61183b` is adapter evidence only.

Explicit user decisions:

- use the proven group `@Bot` Canary rather than require P2P;
- use one allowlisted user and fixed service-account compatibility identity;
- implement the Thread command as the first complete review surface; Task 10
  Card control and Task 11 collaborative Doc implementation are complete for
  the normal path;
- complete design and plan before requesting one execution approval; execution
  is now approved for the sequential phase delivery; and
- use fresh specialist sessions after a phase/topic change; and
- execute the smallest complete slice first; retain explicit evidence boundaries
  and do not claim production readiness.

## Scope

- [x] Phase 1 shares Session turn admission between API and trusted Lark origin
      without splitting the current PostgreSQL transaction.
- [x] Phase 2 adds durable ingress/binding/outbox/attempt state and the fixed-Lark
      group text path.
- [x] Phase 3 Card/Doc review is complete for the verified normal-path boundary under the
      approved Task 11 collaborative-Doc design. Task 10/11 implementation,
      Task 12 deterministic E2E, and Task 13 real-provider normal-path QA are
      complete; deferred hardening and final PR work remain outside this plan.
- [x] Product, Feature, Component, Contract, ADR, Runbook, and Evidence authority
      match the verified command/Card/Doc boundary; deferred hardening is linked
      to Task 14.

## Non-goals

- Lark P2P or multiple users/groups/Apps/Tenants.
- Canonical User, Membership, Link Code, or production identity claims.
- Mutable ChannelConnection administration or a general plugin registry.
- Attachments, streaming, proactive messages, or complete Channel commands.
- Automatic Doc edit subscriptions or Docs/Card as canonical Memory truth.
- Physical exactly-once provider delivery.

## Work breakdown

### Phase 1 — Shared Session turn admission

- [x] Add trusted `api | lark` origin and additive migration.
- [x] Add `SubmitSessionTurn` and route HTTP through it.
- [x] Preserve lane lock, idempotency, snapshot pin, Message/Task/Run/Admission,
      Dispatch, and lane updates in one repository transaction.
- [x] Prove HTTP/fake-Lark semantic parity and real-PG regressions.

### Phase 2 — Durable fixed-Lark text path

- [x] Pass the official SDK compatibility gate before production adapter code.
- [x] Add four-table durable Channel core with no raw-event retention.
- [x] Validate disabled-by-default fixed configuration and service-account ownership tuple.
- [x] Implement group mention gate, allowlist, concurrency-safe root binding,
      and shared turn submission.
- [x] Implement the WebSocket receiver/bootstrap and derive verified mentions
      from provider events.
- [x] Implement successful-source proposal notifier, command fallback, durable
      delivery, and explicit `delivery_unknown` handling.
- [x] Prove duplicate, concurrent, unauthorized, and different-root behavior;
      restart/receiver evidence remains with Task 7.

### Phase 2 Task 6 evidence — fixed Lark binding/session vertical path

- [x] Boundary is disabled-by-default fixed configuration with one allowlisted
      chat/open ID and one service-account Tenant/Workspace/principal tuple.
- [x] New roots require verified `botMentionVerified`; unknown chat/user and
      unmentioned roots fail closed. Existing bound threads reuse their Session;
      different roots create Fresh Sessions.
- [x] Binding election atomically creates exactly one Product Session and
      `session_lane` under a race. Existing bound Sessions revalidate exact owner
      scope and fixed published AgentVersion before reuse; losers create no
      orphan Session.
- [x] Verified mention evidence persists; `completeIngress` records
      processed/failed status, safe error/admission fields, and clears leases.
- [x] `SubmitSessionTurn` receives trusted Lark origin and message id, producing
      one Message/Task/Run with a ready memory snapshot pin.
- [x] Evidence: focused unit 23 passed; focused PGlite 24 passed; integration
      120 passed / 33 skipped; fresh PostgreSQL 6 files / 72 tests passed;
      typecheck, Prettier, and diff checks passed.

### Phase 2 Task 5 evidence — durable Channel core minimum vertical path

- [x] Four tables only: `channel_ingress_events`,
      `channel_conversation_bindings`, `channel_outbox`, and
      `channel_delivery_attempts`, with connection-scoped uniqueness, UUID
      Product Session/Task FKs, creating-ingress/binding/attempt FKs, and no raw
      payload or callback-token storage.
- [x] Strict bounded safe normalization: flat scalar Card action maps only;
      nested/array and token/secret/raw/callback-sensitive keys reject before
      persistence.
- [x] Lease/state consistency, atomic ingress/outbox claims, binding/outbox
      convergence, and cross-connection isolation are covered.
- [x] Delivery attempts use explicit transactions under PGlite and pool;
      exact replay is idempotent, conflicting replay rejects without mutating
      the previous result, and missing/non-claimable outboxes roll back cleanly.
- [x] Node `v24.18.0` / pnpm `11.7.0`: focused 19 passed; integration 115
      passed / 30 skipped; real-PG 69 passed; typecheck, Prettier, and diff
      checks passed.
- [x] Post-mutation transaction fault-injection tests for PGlite and real-PG
      remain deferred non-blocking hardening after the end-to-end canary; do not
      count them as complete.

### Phase 2 Task 4 evidence — official SDK compatibility boundary

- [x] Add the exact `@larksuiteoapi/node-sdk@1.71.1` dependency and sanitized
      message/card fixtures.
- [x] Prove strict bounded normalization, including exact
      `message_type: "text"` rejection before content parsing and bounded typed
      Card callback output.
- [x] Prove the installed pinned `lib/index.js` bundle's lifecycle and callback
      behavior: the handler promise is awaited, the exact callback return is
      encoded in the WS ack, and reconnect cleanup cancels pending work.
- [x] Prove independently created locks contend by fixed App/connection key;
      opaque ownership tokens make stale/double release safe and close graceful.
- [x] Node `v24.18.0` / pnpm `11.7.0`: focused compatibility 16/16 tests;
      full unit 41 files / 184 tests. Frozen install, typecheck, Prettier, and
      diff checks passed.
- [x] Real transport smoke and sole-consumer shutdown evidence are complete;
      Card-specific callback arrival remains outside this command-path canary and
      `CARD_ACTION_WS_REQUIRES_REAL_SMOKE = true` remains authoritative.

### Phase 3 — Card/Doc Memory review

- [x] Phase 3A: add durable review-surface projection and selection policy.
- [x] Implement Card callback authorization and canonical review.
- [x] Implement Bot Doc creation/grant and immutable preview-hash acceptance.
- [x] Orchestrate accepted Entry → ready snapshot before reporting success.
- [x] Task 11 production/application implementation: collaborative Doc body and
      unresolved comments/replies, bounded pagination, AgentRuntimePort-backed
      preview synthesis with candidates disabled, immutable preview/hash,
      exact Preview acceptance, Card label, and fake/bootstrap wiring.
- [x] Task 11 minimum normal path is accepted to proceed; latest Oracle hardening
      gap is explicitly deferred to Task 14. Do not claim final `SPEC_COMPLIANT`.
- [x] Task 12 complete deterministic multi-component E2E over fresh
      caller-provided PostgreSQL with fake Lark/runtime.
- [x] Task 13 real Lark/model provider QA is complete for the documented normal path;
      sanitized evidence is recorded in the Card/Doc evidence packet.
- [x] Close documentation, evidence, deferred scope, and plan archival.

### Phase 3A — Task 9 completion evidence

- [x] Migration 0014, review-surface domain/port/Postgres repository, selector,
      one-active-version CAS/idempotency, action-token lookup, exact ownership
      relations, and immutable preview fields are implemented.
- [x] Node `v24.18.0`: domain/selector 5/5; affected integration 91 passed + 12
      skipped; fresh real-PG 6 files / 73 tests; typecheck and diff checks passed.
- [x] Spec review remediation completed with verdict `SPEC_COMPLIANT`:
      exact-owner replay, binding/ingress/source-Session context, pending
      proposal checks, atomic replacement, and canonical root/Card resolution.
- [x] Quality review remediation completed with verdict `QUALITY_APPROVED`:
      row locks/TOCTOU, cross-instance PGlite serialization, preview mode, ID
      bounds, UTF-8 limits, and proposal → binding → surface lock order.
- [x] Task 10 Card transport/publication/control minimum slice is complete and
      `SPEC_COMPLIANT`.
- [x] Task 11 implementation is complete with serial application acceptance and
      bounded implementer evidence; no real-PG Task 11 evidence exists.
- [x] Task 12 deterministic full Card/Doc E2E is complete for the normal-path
      boundary; no external provider claim is made.
- [x] Task 13 real provider QA is complete for the documented normal path.

Task 11 evidence boundary: Node 24 focused unit 20 files/165 passed; review-
surface PGlite 3 and control 5 were independently rerun; typecheck, build,
Prettier, and diff-check passed. The minimum normal path is accepted to proceed,
but no final `SPEC_COMPLIANT` verdict is claimed.

Task 11 deferred Task 14 finding: after authorization, if preview generation
spans lease expiry and another worker reclaims the same ingress, `savePreview`
does not compare the caller's original exact `leaseOwner`/attempt, so a stale
worker may commit a successor. Add an exact savePreview fence and takeover test
in Task 14. Do not block Task 12 on this.

Task 12 fresh orchestrator evidence under Node 24: dedicated dropped/created
real PostgreSQL; `tests/integration/lark-memory-card-doc-real-pg.integration.test.ts`
passed 1/1 in 489 ms; existing command E2E passed 1/1 in 633 ms; `tsc
--noEmit`, `pnpm build`, and `git diff --check` passed. The normal path proved
root → source Run/long proposal → Bot Doc/active Card → body edit plus unresolved
comment/reply → `preview_doc` → Agent synthesis → immutable successor
preview/hash → late Doc edit → `accept_preview` with successor token → one
accepted Entry/ready snapshot → second Fresh Session exact snapshot pin → recall.
Product Runs: 2. Runtime calls: 3 (source, synthesis, recall). Normal-path
fixture fixes included real Pool injection, long-proposal/callback/delivery
assertions, 8192-byte outbox validation, bounded Doc owner payload/excerpt,
successor processing-surface resolution, and terminal Card patch versioning.

Task 10 protocol clarification: each active surface has one opaque random token
stored only as SHA-256; every Card button uses `{ action: <bounded enum>, token:
<opaque random token> }`. The action is untrusted and mode/status-bound; token
hash lookup plus message/chat/operator/source-session/owner checks authorizes it.
This is a clarification of the approved Task 10 protocol, not a new authority
model.

## Verification

Focused commands are listed per task in the detailed implementation plan.
Final supported matrix:

- [x] `make test-unit` passes under Node 24 via fresh `make ci`.
- [x] `make test-contract` passes under Node 24 via fresh `make ci`.
- [x] `make test-integration` passes under Node 24 via fresh `make ci`.
- [x] Fresh caller-provided PostgreSQL database passes `make test-real-pg`; the
      stale developer database failure is recorded as non-acceptance evidence.
- [x] `make e2e-smoke` passes under Node 24 via fresh `make ci`.
- [x] `make ci` passes under Node 24.
- [x] `make paseo-smoke` and `make eval-smoke` pass without weakening
      deterministic gates.
- [x] Real `agent-test` command fallback canary passes.
- [x] Manual Card and Bot Doc QA passes with machine-verifiable aftermath.
- [x] Real second Agent pins and recalls the exact accepted snapshot ID/hash.
- [x] Secret/raw-event/raw-provider-error/local-path leakage checks pass for the
      command canary evidence boundary.

## Documentation impact

- [x] `docs/features.md` remains accurate for the fixed command-only baseline.
- [x] `docs/components/channel-api-console.md` documents adapter ownership.
- [x] Session/Task/Channel/Memory contracts document trusted origin and review
      semantics.
- [x] ADR documents low-level SDK transport, fixed compatibility identity, and
      `delivery_unknown` policy.
- [x] Runbook covers App lock, startup/shutdown, duplicate/retry, command review,
      deferred recovery, and secret handling.
- [x] Evidence packet contains sanitized IDs, commands, hashes, and risks.

## Decisions and discoveries

- 2026-07-24: PR #8 merged as `61478c5`; this planning branch was reset to that
  exact `origin/master` baseline before writing plans.
- 2026-07-24: Current `lark-cli` and official SDK support
  `card.action.trigger` through local WebSocket/long connection despite stale
  older documentation that implied webhook-only callbacks.
- 2026-07-24: One App may have multiple clustered clients, but event ownership
  is random; the real E2E must use one consumer.
- 2026-07-24: Card, Doc, and command are selected modalities over one canonical
  review state, not three simultaneous messages or approvals.
- 2026-07-24: Oracle review requires explicit proposal notification,
  commit-before-ack evidence, concurrency-safe root binding, ready-snapshot
  orchestration, and outbound unknown-result handling.
- 2026-07-24: Oracle YAGNI review reduced the canary to five new tables and kept
  the existing Session transaction intact.
- 2026-07-24: Bot Doc acceptance uses immutable previewed content/hash, avoiding
  dependence on unproven historical revision reads.
- 2026-07-24: Phase 1 requires a discriminated `api`/`originRef: null` versus
  `lark`/non-empty `originRef` contract at Task and session-turn boundaries.
- 2026-07-24: Migration 0012 is safely rerunnable after SQL commits without its
  registry row; it backfills legacy Session admissions before creating separate
  session and non-Session partial uniqueness indexes.
- 2026-07-24: Non-Session admission lookup is explicitly constrained by
  `session_id IS NULL`, while Session replay is scoped to its Product Session.
- 2026-07-24: `SubmitSessionTurn` canonicalizes and freezes origin and the
  authoritative owner snapshot before forwarding; the existing PostgreSQL
  transaction and lane lock remain intact.
- 2026-07-24: A root-checkout accidental fixer incident was contained; future
  writers adopt the exact target-path/branch/ancestor guard before edits.
- 2026-07-24: User decision: prioritize a complete end-to-end path before
  non-blocking hardening; Task 5 is complete for its minimum vertical path while
  post-mutation fault-injection tests remain explicitly deferred.
- 2026-07-25: Reconfirmed the same ordering for Task 10. Card-control minimum
  behavior is spec-compliant; uncommon post-canonical retry, manual-rebuild
  contention, and rolling-upgrade allocator races are transferred to Task 14
  rather than blocking Task 11/12 Card/Doc E2E.
- 2026-07-24: Fresh PostgreSQL migration races require a stable,
  process-independent advisory lock held by one client across registry and DDL
  work; PGlite behavior remains unchanged.
- 2026-07-24: Fresh real-PG fixture corrections required completing unrelated
  pending ingress before claim assertions and using the Workspace returned by
  `createWorkspace` rather than a disconnected pre-generated ID.
- 2026-07-24: Task 6 binding/session reuse now fails closed when an existing
  Session owner scope or fixed published AgentVersion does not exactly match.
- 2026-07-25: Deterministic command-path E2E passed twice and proves replay does
  not duplicate Runs, outboxes, attempts, or review materialization. Its fixture
  explicitly opts into a published AgentVersion with `workspace_snapshot` memory
  and proposal limit 2.
- 2026-07-25: Fresh Node 24 `make ci`, `make eval-smoke`, `make paseo-smoke`, and
  fresh caller-provided real-PG gates passed. A stale developer database with an
  early unreleased migration is non-acceptance evidence only.

## Approved collaborative Doc design — 2026-07-25

Human/Product approval is complete. The Bot creates a Doc in Bot-owned space;
the body is the editable proposal draft; the user edits the body and/or adds
unresolved comments/replies; the user clicks Card `Read Changes and Generate
Preview`; Agent Server actively reads the latest complete body/comments/replies;
a managed Agent synthesizes one immutable Memory preview; and separate `Accept
Preview` accepts exactly that persisted preview/hash. There is no `Final
Accepted Content` magic section. Resolved comments are not active instructions,
incomplete body/comment/reply fetches fail closed, and raw comments/replies are
not durably retained.

The managed-Agent invocation is an intermediate operation inside the original
proposal Product Task. It uses a dedicated application service backed by
`AgentRuntimePort`; it does not create a second Product Task/Run, import Paseo
into application/domain, or generate Memory candidates. This exception is scoped
only to Doc preview synthesis.

Approved authority docs:
`docs/superpowers/specs/2026-07-24-lark-memory-canary-design.md` and
`docs/superpowers/plans/2026-07-24-lark-memory-canary.md`.

## Human Gates — approved 2026-07-24

The current user decision approves all listed gates:

- [x] core dependency `@larksuiteoapi/node-sdk@1.71.1` after compatibility RED/GREEN;
- [x] additive migrations and durable uniqueness/retention model;
- [x] internal trusted `api | lark` origin contract;
- [x] fixed service-account compatibility identity and external actor audit;
- [x] safe Lark identifier persistence with no raw-event retention;
- [x] Bot Doc creation and grant to the allowlisted test user;
- [x] bounded retry plus explicit `delivery_unknown` policy;
- [x] real App/group/user external writes and QA; and
- [x] manual Card/Doc evidence outside deterministic CI.

This approval authorizes dependency addition, migrations, safe identifiers,
fixed service-account compatibility, the Bot Doc grant, bounded retry and
`delivery_unknown`, real Lark writes, and manual Card/Doc QA.

## Risks and recovery

- SDK cannot commit before acknowledgement: stop at the compatibility gate and
  use a lower-level dispatcher path or revise the design before proceeding.
- Concurrent first-root race: unique binding plus retry-safe create-if-absent
  must reuse the winning Session and avoid orphans.
- Provider send/receipt crash: mark `delivery_unknown` after safe UUID replay is
  no longer provable; do not blind-resend an interactive review surface.
- Doc fetch/parse/grant failure: keep Card active and use command fallback; never
  accept unverified Doc content.
- Snapshot publication failure: retain the accepted Entry, retry publication,
  and do not report ready until hash-verified projection succeeds.
- Each phase is additive and independently reversible by disabling the Lark worker;
  rollback must not delete received ingress or review evidence.

## Validation evidence

Planning evidence:

- Node `v24.18.0`, pnpm `11.7.0`.
- `pnpm install --frozen-lockfile`: passed in the isolated planning worktree.
- Baseline `make check`: passed at `5841518` before PR #8 merge verification.
- GitHub confirmed PR #8 merged at `61478c5`; `origin/master` contains the
  documentation lifecycle commit.
- Planning worktree reset to `61478c5` while preserving only the new planning
  documents.
- Local `lark-cli event schema card.action.trigger --json` confirms callback
  fields and one-consumer semantics.
- Fresh Oracle design review consumed and reconciled; stale specialist cache was
  cancelled afterward.
- Fresh Phase 1 Node 24 evidence: unit 40 files / 168 tests; contract 7 files /
  71 tests; deterministic integration 7 passed + 5 skipped / 96 passed + 28
  skipped; real PostgreSQL 5 files / 67 tests; E2E 3 files / 5 tests.
- `make ci`, `make check`, documentation checks, and build passed. The public
  HTTP request/response contract remained unchanged.
- Task 6 vertical evidence under Node 24: focused unit 23 passed; focused PGlite
  24 passed; deterministic integration 120 passed / 33 skipped; fresh
  PostgreSQL 6 files / 72 tests passed; typecheck, Prettier, and diff checks
  passed.
- Task 6 evidence covers disabled-by-default fixed config and service-account
  tuple, fail-closed chat/user/new-root mention, atomic binding plus one
  Product Session/lane under race, owner/AgentVersion revalidation for bound
  Sessions, thread/different-root semantics, mention persistence,
  `completeIngress`, Lark origin/message id, one Message/Task/Run, and ready
  snapshot pinning.
- PostgreSQL advisory migration locking and fresh-test database fixture
  corrections are recorded discoveries. The SDK WebSocket domain enum mapping
  and single exact Workspace seed tuple were fixed during the real canary; the
  first bad-seed database is non-acceptance evidence only.

### 2026-07-25 real command-path canary evidence

- [x] Receiver/bootstrap, verified mention derivation, successful-source proposal
      notification, command fallback, official SDK text delivery/outbox, and
      command ingress/review-to-ready are complete.
- [x] Sole-consumer real `agent-test` transport smoke, real command approval,
      ready snapshot publication, and graceful worker shutdown are complete.
- [x] A second new root created a Fresh Session, pinned the exact ready snapshot
      ID/hash, and the real Agent recalled
      `LARK_REAL_MEMORY_ACCEPTED_20260725_0039`.
- [x] Deterministic full command-path E2E and complete Node 24 gates pass.
- [x] Final command-scope docs, ADR, runbook, and evidence packet are present.
- [x] Final diff review and PR preparation remain open.
- [x] Crash recovery, multi-node leadership, extra redrive/fault injection,
      performance, and polish transfer to post-E2E hardening; retain these as
      deferred scope.

Phase 1, Tasks 4–6, Task 7 receiver/notifier/delivery, Task 9, Task 10, Task 11,
Task 12, Task 13, Node 24 gates, and command/Card/Doc authority docs are
verified. Remaining hardening is explicitly transferred to the active Task 14
follow-up plan; it is not marked complete here.

### 2026-07-25 real Card callback transport probe

- [x] One real Card 2.0 button click was captured through `agent-test`; the
      callback subscription was explicitly enabled/published, the listener
      reported ready/connected, and `card.action.trigger` delivered exactly one
      event before bounded exit.
- [x] Sanitized callback shape matched configured operator, Card message, and
      test chat; it included `host: im_message`, `action_tag: button`, a unique
      event ID, and probe action JSON with probe ID
      `agent-server-20260725-0128`. Callback update tokens are excluded.
- [x] `card_content` was observed as Card 2.0 userDSL but did not contain
      callback behavior/action values; authorization must use the callback
      envelope and server-side surface state. The 16-digit provider timestamp is
      opaque until deliberately normalized.
- [x] The sanitized transport shape may be replayed by deterministic fixtures;
      repeated manual probe clicks are not required.
- [x] This callback probe remains transport evidence only; business Card/Doc
      normal-path evidence is recorded separately in the Card/Doc packet.

### Deferred Oracle blockers transferred to Task 14

- [x] Change retryable outbox failures from the current tight-loop behavior to
      the conservatively selected `delivery_unknown` handling.
- [x] Add `workspace_id` equality to Lark Session AgentVersion validation.
- [x] Remove or correct the nonexistent `lark-memory-smoke` automation claim.
- [x] Fix UTF-8 truncation so partial multibyte content cannot exceed the byte
      limit; also correct the minor portable NVM path and mention wording issues.

These items remain deferred and are owned by the active Task 14 follow-up plan;
this completed canary plan does not claim them resolved.

## Completion checklist

- [x] Every scope item is complete or explicitly transferred.
- [x] Every Human Gate and material decision is recorded.
- [x] Three phase boundaries are independently verified.
- [x] Full real-Lark/real-Agent acceptance evidence exists.
- [x] Working trees are clean and terminal specialist tasks reconciled.
- [x] No unchecked item remains before archival.
- [x] Plan is moved to `completed/` with `status: completed`.

## Completion status

Command-path implementation, deterministic regression, complete Node 24 gates,
authority docs, Phase 3A/Task 9, and Task 10 minimum Card control are verified.
Task 11 minimum normal path is complete and accepted to proceed; final
`SPEC_COMPLIANT` is not claimed. The exact preview successor lease-takeover
fence is deferred to Task 14. Task 12 full E2E is complete for the normal-path
boundary. Task 13 real-provider normal-path QA is complete. Deferred hardening
is transferred to the active Task 14 plan.

## Final state

Task 13 real provider QA is complete for the documented normal-path boundary;
its sanitized evidence is recorded in
`docs/evidence/lark-managed-memory-card-doc-canary-evidence-packet.md`. The
command fallback and Card/Doc projection surfaces are implemented and verified;
deferred hardening is transferred to the active Task 14 hardening follow-up
plan.

No production identity, physical exactly-once, multi-node leadership, or full
crash-recovery claim is made.

## Cleanup state

- Planning worktree: the repository worktree for this branch.
- Branch: `agent/lark-memory-e2e-plan` at `9f12c9e` plus all current uncommitted
  feature and documentation changes.
- Real provider worker was shut down gracefully; no consumer, API server, or
  runtime process remains running.
- No active specialist lane should be claimed in durable docs. `fix-12` was
  completed and reconciled; no specialist lane is currently active.
- Hermes Agent remains a read-only non-authoritative reference.

### 2026-07-25 Task 13 real-provider normal-path evidence

- [x] Source root, source Run, Card, proposal, accepted Entry, ready snapshot/version/hash, fresh recall root, and recall response were recorded in the sanitized Card/Doc evidence packet.
- [x] Production `readDraft` verified edited body plus unresolved local comment/reply before Preview.
- [x] Source, edit, and accepted markers ending `20260725_1150` were present; the source marker first appeared in snapshot version 5, proving fresh-root pin/recall.
- [x] This evidence proves the fixed compatibility normal path only. It does not prove canonical Lark identity, production readiness, physical exactly-once, multi-node leadership, or full crash recovery.
