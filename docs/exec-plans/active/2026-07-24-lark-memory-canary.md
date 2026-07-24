---
status: active
owner: orchestrator
created_at: 2026-07-24
updated_at: 2026-07-24
authority: execution-plan
---

# Lark Managed Memory Canary

## Outcome

Reproduce the existing real Managed Agent Workspace Memory proposal, review,
ready-snapshot, Fresh Session, and recall flow through one fixed Lark group with
Card-first review, Bot Doc assistance, and Thread command fallback.

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
- implement Card as primary, Bot Doc as long-context auxiliary, and Thread
  command as fallback;
- complete design and plan before requesting one execution approval; execution
  is now approved for the sequential phase delivery; and
- use fresh specialist sessions after a phase/topic change; and
- execute three sequential local phases on one branch and open one final PR only
  after all phases and acceptance evidence pass.

## Scope

- [x] Phase 1 shares Session turn admission between API and trusted Lark origin
      without splitting the current PostgreSQL transaction.
- [ ] Phase 2 adds durable ingress/binding/outbox/attempt state and the fixed-Lark
      group text path.
- [ ] Phase 3 adds Card/Doc/command Memory review and completes the real-Lark
      source-review-ready-snapshot-new-root-recall canary.
- [ ] Product, Feature, Component, Contract, ADR, Runbook, and Evidence authority
      match the implemented boundary.

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

- [ ] Pass the official SDK compatibility gate before production adapter code.
- [ ] Add four-table durable Channel core with no raw-event retention.
- [ ] Validate fixed configuration and service-account ownership tuple.
- [ ] Implement group mention gate, allowlist, concurrency-safe root binding,
      WebSocket receiver, and shared turn submission.
- [ ] Implement successful-source proposal notifier, command fallback, durable
      delivery, and explicit `delivery_unknown` handling.
- [ ] Prove duplicate, concurrent, restart, unauthorized, and different-root
      behavior.

### Phase 3 — Card/Doc Memory review

- [ ] Add durable review-surface projection and selection policy.
- [ ] Implement Card callback authorization and canonical review.
- [ ] Implement Bot Doc creation/grant and immutable preview-hash acceptance.
- [ ] Orchestrate accepted Entry → ready snapshot before reporting success.
- [ ] Complete deterministic fake-provider and real `agent-test`/real-Agent E2E.
- [ ] Close documentation, evidence, deferred scope, and plan archival.

## Verification

Focused commands are listed per task in the detailed implementation plan.
Final supported matrix:

- [ ] `make test-unit` passes.
- [ ] `make test-contract` passes.
- [ ] `make test-integration` passes.
- [ ] Caller-provided `DATABASE_URL` with `make test-real-pg` passes.
- [ ] `make e2e-smoke` passes.
- [ ] `make ci` passes under Node 24.
- [ ] `make paseo-smoke` and `make eval-smoke` pass or their external blocker is
      recorded without weakening deterministic gates.
- [ ] Real `agent-test` command fallback canary passes.
- [ ] Manual Card and Bot Doc QA passes with machine-verifiable aftermath.
- [ ] Real second Agent pins and recalls the exact accepted snapshot ID/hash.
- [ ] Secret/raw-event/raw-provider-error/local-path leakage checks pass.

## Documentation impact

- [ ] `docs/features.md` remains accurate after each PR.
- [ ] `docs/components/channel-api-console.md` documents adapter ownership.
- [ ] Session/Task/Channel/Memory contracts document trusted origin and review
      semantics.
- [ ] ADR documents low-level SDK transport, fixed compatibility identity, and
      `delivery_unknown` policy.
- [ ] Runbook covers App lock, startup/shutdown, duplicate/retry, Doc grants,
      recovery, and secret handling.
- [ ] Evidence packet contains sanitized IDs, commands, hashes, and risks.

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
  HTTP request/response contract remained unchanged. No Lark implementation or
  external QA has started.

Phase 1 implementation and verification are complete. Phase 2 and external
validation have not started.

## Completion checklist

- [ ] Every scope item is complete or explicitly transferred.
- [ ] Every Human Gate and material decision is recorded.
- [ ] Three phase boundaries are independently verified.
- [ ] Full real-Lark/real-Agent acceptance evidence exists.
- [ ] Working trees are clean and terminal specialist tasks reconciled.
- [ ] No unchecked item remains before archival.
- [ ] Plan is moved to `completed/` with `status: completed`.

## Current blocker

None. Phase 1 is verified; Phase 2 is not started.

## Next exact command

Begin Phase 2 Task 4 with the SDK compatibility RED test and dependency gate:

```bash
pnpm exec vitest run --config vitest.unit.config.ts \
  src/adapters/lark/lark-compatibility.test.ts
```

Expected: RED before adding the official SDK dependency. Keep all three phases
on the same branch and open one final PR only after Phase 3.

## Cleanup state

- Planning worktree:
  `/Volumes/AgentsWorkspace/orgs/0xdtech/code/agent-server/.worktrees/lark-memory-e2e-plan`.
- Branch: `agent/lark-memory-e2e-plan` at `61478c5` plus uncommitted planning
  documents.
- No database, Lark consumer, API server, Paseo process, or external smoke is
  running.
- Job Board has no active, unreconciled, or reusable specialist task.
- Hermes Agent reference clone remains read-only under
  `/Volumes/AgentsWorkspace/orgs/0xdtech/tmp/hermes-agent`.
