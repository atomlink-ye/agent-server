# Lark Managed Memory Canary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reproduce the proven Managed Agent Workspace Memory proposal, command
review, ready-snapshot, Fresh Session, and real-Agent recall flow through one
fixed Lark group. The verified acceptance surface is Thread command only; Card
and Bot Doc remain deferred.

**Architecture:** A low-level official Lark WebSocket adapter durably inserts
normalized inbound events before acknowledgement. Workers map one configured
group/user to the existing service-account control plane, reuse one shared
Session turn transaction, and deliver through a durable outbox. The command
input converges on the existing canonical Memory review and snapshot publication
flow; Card and Doc are deferred modalities.

**Tech Stack:** TypeScript 7, Node.js 24, pnpm 11.7, PostgreSQL/PGlite,
Vitest, Hono, `@larksuiteoapi/node-sdk@1.71.1`, Paseo 0.1.110, OpenCode
1.18.4, and `lark-cli` as an external QA driver only.

**Design authority:**
`docs/superpowers/specs/2026-07-24-lark-memory-canary-design.md`

**Baseline:** `origin/master` at
`61478c5aacb299c58ae35cafca7e410ff16439e0` after merged PR #8.

**Fresh baseline CI:** Under Node 24, `make ci` passed with 39 unit files / 159
tests, 7 contract files / 71 tests, integration 7 passed + 5 skipped / 84
passed + 28 skipped, 3 E2E / 5 tests, and build pass.

**Phase 1 verification:** Under Node 24, unit passed with 40 files / 168 tests;
contract passed with 7 files / 71 tests; deterministic integration passed with
7 files / 5 skipped and 96 passed / 28 skipped; real PostgreSQL passed with 5
files / 67 tests; E2E passed with 3 files / 5 tests; and `make ci`, `make
check`, documentation checks, and build passed.

**Delivery policy:** The user approved execution on 2026-07-24. The command-only
compatibility slice and its deterministic/real evidence are now complete on one
branch. Perform final diff/docs review and prepare the requested PR; do not
represent deferred Card/Doc or post-E2E hardening as complete. Do not mark any
remaining implementation checkbox complete without evidence.

---

## Delivery graph

Execute as three sequential local phases on one branch. Do not start a later
phase until the prior phase's focused and final gates pass.

1. **Phase 1:** Shared Session turn admission seam.
2. **Phase 2:** Durable fixed-Lark text path.
3. **Phase 3:** Deferred Card/Doc review and any broader final canary work; the
   command-only acceptance slice is already verified.

Open one final PR after Phase 3 completes. The repository Feature ledger must
remain `in progress` until Phase 3 completes.

## File map

### Phase 1 — Shared turn admission

- Create `src/application/sessions/session-turn-origin.ts` — trusted API/Lark
  origin union.
- Create `src/application/sessions/submit-session-turn.ts` and `.test.ts` —
  shared application entrypoint.
- Modify `src/application/ports/session-repository.ts` — structured turn input.
- Modify `src/infrastructure/postgres/postgres-session-repository.ts` — retain
  the existing transaction while parameterizing trusted origin.
- Modify `src/entrypoints/api/routes/sessions.ts` and API dependency assembly.
- Modify admission/task origin types and PostgreSQL mappings.
- Create `src/infrastructure/postgres/migrations/0012_session_turn_origin.sql`.
- Modify `src/infrastructure/postgres/postgres.ts` migration registry.
- Extend Session contract/integration/real-PG tests.

### Phase 2 — Durable fixed-Lark text path

- Add `@larksuiteoapi/node-sdk@1.71.1` and lockfile changes only after the
  compatibility test is RED/GREEN.
- Create `src/adapters/lark/` receiver, normalizer, client, fixtures, and tests.
- Create `src/domain/channels/` bounded event/delivery types.
- Create `src/application/ports/channel-repository.ts` and
  `src/application/ports/lark-delivery.ts`.
- Create `src/application/channels/process-channel-ingress.ts`,
  `resolve-lark-binding.ts`, `publish-memory-review-surface.ts`, and
  `deliver-channel-outbox.ts` with focused tests.
- Create `src/infrastructure/postgres/migrations/0013_channel_core.sql` and
  `postgres-channel-repository.ts`.
- Extend `src/shared/config.ts` with fixed canary configuration.
- Create `src/entrypoints/lark/worker.ts` and shutdown tests.
- Add fake-adapter, PGlite, real-PG, and real-socket E2E coverage.

### Phase 3 — Card/Doc Memory interaction

- Create `src/infrastructure/postgres/migrations/0014_lark_memory_review_surfaces.sql`.
- Create `src/application/channels/select-memory-review-surface.ts`.
- Create `src/application/channels/apply-memory-review-control.ts`.
- Create `src/adapters/lark/lark-memory-card.ts` and
  `lark-memory-document.ts` with contract tests.
- Create `src/infrastructure/postgres/postgres-lark-review-surface-repository.ts`.
- Create `scripts/smoke/lark-memory-canary.mjs`.
- Create `e2e/lark-memory-canary.e2e.test.ts` for deterministic fake-provider
  behavior; real external QA remains a smoke/evidence action.
- Update Product, Feature, Component, Contract, ADR, Runbook, Evidence, and the
  Active Exec Plan.

---

## Phase 1 — Shared Session turn admission seam

### Task 1: Add trusted origin contracts and migration

**Files:**

- Create: `src/application/sessions/session-turn-origin.ts`
- Create: `src/infrastructure/postgres/migrations/0012_session_turn_origin.sql`
- Modify: `src/application/ports/admission-repository.ts`
- Modify: `src/infrastructure/postgres/postgres-admission-repository.ts`
- Modify: `src/infrastructure/postgres/postgres.ts:24-37`
- Test: `tests/integration/durable-kernel-postgres.integration.test.ts`

- [x] **Step 1: Write the failing migration and type tests**

Add assertions that existing API rows keep `origin_ref = NULL`, Lark requires a
non-null ingress reference, and unsupported ingress values fail.

```ts
expect(apiAdmission.ingress).toBe('api');
expect(apiAdmission.origin_ref).toBeNull();
await expect(
  insertAdmission({ ingress: 'lark', origin_ref: null }),
).rejects.toThrow();
await expect(
  insertAdmission({ ingress: 'email', origin_ref: 'x' }),
).rejects.toThrow();
```

- [x] **Step 2: Run the focused test and verify RED**

```bash
pnpm exec vitest run --config vitest.integration.config.ts \
  tests/integration/durable-kernel-postgres.integration.test.ts
```

Expected: FAIL because `lark` and `origin_ref` are not supported.

- [x] **Step 3: Define the trusted origin union**

```ts
export type SessionTurnOrigin =
  | { readonly channel: 'api'; readonly requestId: string }
  | { readonly channel: 'lark'; readonly ingressEventId: string };

export type AdmissionIngress = SessionTurnOrigin['channel'];

export function originReference(origin: SessionTurnOrigin): string | null {
  return origin.channel === 'lark' ? origin.ingressEventId : null;
}
```

Update `AdmissionRecord`, transaction lookup, row mapping, and save SQL to use
`AdmissionIngress` plus `originRef: string | null`.

- [x] **Step 4: Add migration `0012_session_turn_origin.sql`**

The migration drops the ingress checks, adds `origin_ref` and session ownership,
backfills legacy Session admissions from `tasks.session_id`, and adds named
constraints plus rerunnable partial uniqueness indexes. It remains safe when its
SQL committed but its registry row is missing. The origin constraints are
equivalent to:

```sql
CHECK (ingress IN ('api', 'lark'));
CHECK (
  (ingress = 'api' AND origin_ref IS NULL) OR
  (ingress = 'lark' AND origin_ref IS NOT NULL)
);
```

Register `0012_session_turn_origin.sql` after `0011`.

- [x] **Step 5: Run focused tests and verify GREEN**

Run the command from Step 2 and `pnpm check:types`. Expected: PASS.

- [x] **Step 6: Preserve phase-local evidence on the delivery branch**

```bash
git add src/application/sessions/session-turn-origin.ts \
  src/application/ports/admission-repository.ts \
  src/infrastructure/postgres/postgres-admission-repository.ts \
  src/infrastructure/postgres/migrations/0012_session_turn_origin.sql \
  src/infrastructure/postgres/postgres.ts \
  tests/integration/durable-kernel-postgres.integration.test.ts
git diff --check
```

### Task 2: Introduce `SubmitSessionTurn` without splitting the transaction

**Files:**

- Create: `src/application/sessions/submit-session-turn.ts`
- Create: `src/application/sessions/submit-session-turn.test.ts`
- Modify: `src/application/ports/session-repository.ts:35-54`
- Modify: `src/infrastructure/postgres/postgres-session-repository.ts:111-214`
- Modify: `src/entrypoints/api/routes/sessions.ts:153-180`
- Modify: API dependency interfaces in `src/entrypoints/api/app.ts`
- Modify: `src/bootstrap.ts`

- [x] **Step 1: Write failing application tests**

Cover API origin forwarding, Lark origin forwarding, missing Session behavior,
and rejection of caller-created arbitrary origin objects.

```ts
const result = await useCase.execute({
  sessionId: 'session-1',
  text: 'remember this',
  idempotencyKey: 'message-1',
  owner,
  origin: { channel: 'lark', ingressEventId: 'ingress-1' },
});
expect(repository.input.origin).toEqual({
  channel: 'lark',
  ingressEventId: 'ingress-1',
});
expect(result.taskId).toBe('task-1');
```

- [x] **Step 2: Verify RED**

```bash
pnpm exec vitest run --config vitest.unit.config.ts \
  src/application/sessions/submit-session-turn.test.ts
```

Expected: FAIL because the use case does not exist.

- [x] **Step 3: Change the repository input atomically**

```ts
export interface SubmitSessionTurnInput {
  readonly sessionId: string;
  readonly text: string;
  readonly idempotencyKey: string;
  readonly owner: AccessContext;
  readonly origin: SessionTurnOrigin;
}

export interface SessionRepository {
  postMessage(input: SubmitSessionTurnInput): Promise<UserMessage>;
  // existing methods unchanged
}
```

`PostgresSessionRepository.postMessage` must use `origin.channel` in replay,
Task, and Admission SQL and use `originReference(origin)`. Do not move the lane
lock or writes out of the transaction.

- [x] **Step 4: Implement the narrow use case and route API through it**

```ts
export class SubmitSessionTurn {
  public constructor(private readonly sessions: SessionRepository) {}

  public execute(input: SubmitSessionTurnInput): Promise<UserMessage> {
    return this.sessions.postMessage(input);
  }
}
```

The HTTP route creates only `{ channel: 'api', requestId }`; no request body can
provide origin, principal, Workspace, or AgentVersion.

- [x] **Step 5: Verify GREEN and API contract parity**

```bash
pnpm exec vitest run --config vitest.unit.config.ts \
  src/application/sessions/submit-session-turn.test.ts
pnpm exec vitest run --config vitest.contract.config.ts \
  tests/contract/sessions.contract.test.ts
pnpm exec vitest run --config vitest.integration.config.ts \
  tests/integration/session-lane-postgres.integration.test.ts \
  tests/integration/session-message-provenance.integration.test.ts
```

Expected: PASS with unchanged HTTP response and Memory snapshot pinning.

- [x] **Step 6: Preserve phase-local evidence on the delivery branch**

```bash
git add src/application/sessions src/application/ports/session-repository.ts \
  src/infrastructure/postgres/postgres-session-repository.ts \
  src/entrypoints/api/routes/sessions.ts src/entrypoints/api/app.ts src/bootstrap.ts \
  tests/contract/sessions.contract.test.ts tests/integration/session-*.test.ts
git diff --check
```

### Task 3: Close Phase 1 evidence

- [x] Run Node 24 focused gates:

```bash
make test-unit
make test-contract
make test-integration
DATABASE_URL="$DATABASE_URL" make test-real-pg
make ci
```

Expected: all deterministic and real-PG gates pass.

- [x] Update the Active Exec Plan with exact commands, results, decisions, and
      the final diff/docs review next action.
- [x] Update affected Session/Task contracts only if internal origin semantics
      are documented; public API payloads remain unchanged.
- [x] Keep the branch scoped to this delivery; the final PR is opened only
      after Phase 3 and the complete canary evidence pass.

## Phase 1 completion evidence

Tasks 1–8 and the command-only portion of Tasks 9–13 are complete for the fixed
compatibility boundary. The trusted origin contract, durable channel path,
deterministic command E2E, real-Lark command canary, and Node 24 gates passed.
Card/Doc review and post-E2E hardening remain explicitly deferred.

## Next exact action

Perform final diff/docs review and prepare the explicitly requested PR. The
active plan remains open while deferred Card/Doc and post-E2E hardening items are
unchecked.
Do not return to feature hardening before this regression and the Node 24 gate
evidence. Defer crash recovery, multi-node leadership, extra redrive/fault
injection, performance, and polish to post-E2E hardening.

---

## Phase 2 — Durable fixed-Lark text path

### Task 4: Prove the official SDK compatibility boundary

**Files:**

- Modify: `package.json`, `pnpm-lock.yaml`
- Create: `src/adapters/lark/lark-compatibility.test.ts`
- Create: `tests/fixtures/lark/message-receive-v1.json`
- Create: `tests/fixtures/lark/card-action-trigger.json`
- Create: `src/adapters/lark/normalize-lark-event.ts`

- [x] Add `@larksuiteoapi/node-sdk@1.71.1` exactly and create sanitized fixtures
      from the proven local event shapes without real content or secrets.
- [x] Write tests proving message/event/chat/root/thread/reply/sender/mention IDs,
      unknown-field tolerance, and `message_id` dedup selection.
- [x] Add a fake durable insert that blocks until released and assert the
      low-level dispatcher does not acknowledge before the returned promise commits.
- [x] Assert card actions expose provider event ID, operator, chat, Card message
      ID, action value, and a bounded typed callback response path.
- [x] Assert graceful close cancels reconnect work and no second App consumer is
      allowed by the local lock.
- [x] Run:

```bash
pnpm exec vitest run --config vitest.unit.config.ts \
  src/adapters/lark/lark-compatibility.test.ts
```

Expected: PASS before any production receiver is written. If durable ack or
Card callback fails, stop at the Human Gate and do not continue Phase 2.

- [x] Preserve the compatibility evidence on the delivery branch before
      continuing Phase 2.

#### Task 4 evidence

- The exact dependency is `@larksuiteoapi/node-sdk@1.71.1`; the frozen lockfile
  records integrity `sha512-Z4cZmgWvwiE7tCHqGm+t7DKvbpNRRTH2HqVwcYiOMAwbjIytXSoQqWytsOVu3p+d0fIvrtyIPZok5HOV/VNxxw==`.
  The installed `node_modules` bundle is the authority for compatibility claims;
  the test anchors the pinned `lib/index.js` acknowledgement and reconnect
  cleanup implementation.
- Under Node `v24.18.0` / pnpm `11.7.0`, the focused compatibility suite passed
  16 tests and the full unit suite passed 41 files / 184 tests.
- Normalization is strict and bounded: exact `message_type: "text"` is required
  before content parsing; unsupported image/post/file messages reject first;
  text and action bounds are enforced; card callback output is a narrow bounded
  toast contract and arbitrary/oversized content is rejected.
- The pinned dispatcher test waits for the returned handler promise and verifies
  the exact callback payload is encoded in the WebSocket acknowledgement. This
  proves callback return semantics only; `CARD_ACTION_WS_REQUIRES_REAL_SMOKE`
  remains `true` and real Card-over-WS arrival smoke is still pending.
- Independently created lock handles contend on the same fixed App/connection
  key. Opaque ownership tokens make stale or double release unable to clear a
  newer owner; close remains graceful. Reconnect timer cleanup is verified.

### Task 5: Add the four-table durable Channel core

**Files:**

- Create: `src/infrastructure/postgres/migrations/0013_channel_core.sql`
- Modify: `src/infrastructure/postgres/postgres.ts`
- Create: `src/domain/channels/channel-event.ts`
- Create: `src/domain/channels/channel-delivery.ts`
- Create: `src/application/ports/channel-repository.ts`
- Create: `src/infrastructure/postgres/postgres-channel-repository.ts`
- Create: `tests/integration/channel-core-postgres.integration.test.ts`
- Extend: `tests/integration/real-pg-pool.integration.test.ts`

- [x] Write RED tests for one message ingress, concurrent duplicate convergence,
      one binding/session, outbox logical uniqueness, lease reclaim, and delivery
      attempt results including `unknown`.
- [x] Create only `channel_ingress_events`, `channel_conversation_bindings`,
      `channel_outbox`, and `channel_delivery_attempts` with the exact uniqueness,
      bounds, foreign keys, and state checks in the design.
- [x] Implement repository methods:

```ts
insertIngress(input): Promise<{ record: ChannelIngressEvent; inserted: boolean }>;
claimIngress(workerId, leaseMs): Promise<ChannelIngressEvent | null>;
resolveBinding(input): Promise<ChannelConversationBinding>;
saveOutbox(input): Promise<{ record: ChannelOutbox; inserted: boolean }>;
claimOutbox(workerId, leaseMs): Promise<ChannelOutbox | null>;
recordAttempt(input): Promise<void>;
```

- [x] Store normalized safe fields only; reject oversized text/action/error
      values and never add a raw payload column.
- [x] Run focused PGlite and real-PG tests. Expected: duplicate and restart
      convergence pass on both.
- [x] Preserve the durable-core evidence on the delivery branch before the next
      Phase 2 task.

#### Task 5 evidence

- Node `v24.18.0` / pnpm `11.7.0`: focused channel-core suite 19 tests passed;
  integration lane 115 passed / 30 skipped; real-PG lane 69 tests passed.
  Typecheck and `git diff --check` passed; Prettier passed.
- The minimum vertical path implements exactly four durable tables with
  connection-scoped uniqueness, UUID FKs for Product Sessions/Tasks, creating
  ingress/binding/attempt FKs, lease/state consistency checks, and no raw
  payload/callback-token columns.
- Ingress and Card action data are bounded normalized safe fields; Card actions
  are flat scalar maps and reject nested/array and sensitive token/secret/raw/
  callback keys. Atomic claims converge under leases; delivery attempts are
  explicit transactional, idempotent for exact replay, and reject conflicting
  replay without mutating the prior result.
- Post-mutation transaction fault-injection tests for PGlite and real PostgreSQL
  are explicitly deferred as non-blocking hardening after the end-to-end canary.
  They are not complete and must not be treated as acceptance evidence.

### Task 6: Add fixed compatibility configuration and binding

**Files:**

- Modify: `src/shared/config.ts`
- Create: `src/application/channels/resolve-lark-binding.ts`
- Create: `src/application/channels/resolve-lark-binding.test.ts`
- Create: `src/application/channels/process-channel-ingress.ts`
- Create: `src/application/channels/process-channel-ingress.test.ts`

- [x] Write RED config tests for missing/empty App secret, conflicting service
      account scope, unknown domain, missing IDs, and disabled canary.
- [x] Add optional `larkCanary` config with `enabled`, connection/App/domain,
      allowed chat/open ID, Tenant/Workspace/service-account/AgentVersion IDs, and
      policy version. Secrets remain environment-only.
- [x] Keep the canary disabled by default and enforce the fixed service-account
      Tenant/Workspace/principal tuple at the binding/session boundary.
- [x] Implement root resolution with:

```ts
const rootMessageId = event.rootId ?? event.externalMessageId;
```

New roots require a verified Bot mention. Thread controls revalidate actor/chat
and reuse the unique binding. The resolver creates no orphan Session when it
loses a binding race.

- [x] Call `SubmitSessionTurn` with Lark ingress ID as trusted origin and Lark
      message ID as idempotency key.
- [x] Run focused unit/integration tests; expect unknown chat/user/no-mention to
      produce no binding, Session, or Task.
- [x] Preserve the binding evidence on the delivery branch before the next Phase
      2 task.

#### Task 6 evidence

- [x] The boundary is a disabled-by-default fixed configuration with one
      allowlisted chat/open ID and one service-account Tenant/Workspace/principal
      tuple; it is not a general connection or membership system.
- [x] New roots require verified `botMentionVerified`; unknown chat/user and
      unmentioned roots fail closed. Existing bound threads reuse their Session;
      a different root creates a Fresh Session.
- [x] Binding election and creation of exactly one Product Session plus one
      `session_lane` are atomic under a race. Existing bound Sessions revalidate
      exact owner scope and fixed published AgentVersion before reuse, and losers
      do not create orphan Sessions.
- [x] Verified mention evidence is persisted; `completeIngress` records
      processed/failed status, safe error/admission fields, and clears leases.
- [x] The vertical path calls `SubmitSessionTurn` with Lark origin and ingress
      message id, producing one Message/Task/Run with a ready memory snapshot
      pin.
- [x] Evidence under Node 24: focused unit 23 passed; focused PGlite 24 passed;
      deterministic integration 120 passed / 33 skipped; fresh PostgreSQL 6
      files / 72 tests passed; typecheck, Prettier, and diff checks passed.
- [x] PostgreSQL migration application uses a process-independent advisory lock
      on one client. Fresh real-PG fixtures were corrected to complete unrelated
      pending ingress and to use the Workspace returned by `createWorkspace`.

### Task 7: Add receiver, proposal notifier, text fallback, and outbox delivery

**Files:**

- Create: `src/adapters/lark/lark-websocket-receiver.ts`
- Create: `src/adapters/lark/lark-delivery-adapter.ts`
- Create: `src/application/ports/lark-delivery.ts`
- Create: `src/application/channels/publish-memory-review-surface.ts`
- Create: `src/application/channels/deliver-channel-outbox.ts`
- Create: focused `.test.ts` files beside each application class
- Create: `src/entrypoints/lark/worker.ts`
- Create: `src/entrypoints/lark/shutdown.test.ts`
- Modify: `package.json` scripts and `src/bootstrap.ts` shared assembly

- [ ] Write RED tests proving receiver commit-before-ack, duplicate replay,
      terminal-success-only proposal intent, one fallback message, provider UUID
      reuse, and `delivery_unknown` after an unreconcilable send/receipt crash.
- [x] Implement one App lock and one low-level WebSocket dispatcher. The handler
      only normalizes and commits ingress before returning.
- [x] Implement the terminal Task notifier as a deterministic query of proposals
      from successful source Runs; unique key is proposal + surface kind + version.
- [x] Implement text/command-only fallback rendering with safe IDs and no raw
      provider errors.
- [x] Implement bounded retry while UUID replay is safe; after ambiguity outside
      the provider window, persist `delivery_unknown` and stop automatic resend.
- [x] Add `dev:lark`/`start:lark` scripts without changing default API startup.
- [ ] Run focused tests plus `make test-integration` and `make ci`.
- [ ] Preserve the text-worker evidence on the delivery branch before Phase 3.

### Task 8: Close Phase 2 evidence

- [ ] Run fake-runtime real-socket E2E proving one root → one Session/Task,
      thread reuse, different root → different Fresh Session, and safe shutdown.
- [ ] Run real PostgreSQL duplicate/concurrent/restart tests.
- [x] Run a transport-only `agent-test` smoke with Agent Server as the sole
      consumer; do not run competing `lark-cli event consume`.
- [ ] Update `docs/features.md` as internal canary-incomplete and add the Channel
      ownership/transport ADR plus text-path runbook sections.
- [ ] Record exact evidence and continue on the same branch into Phase 3.

#### Task 7/8 real command-path evidence (2026-07-25)

- [x] Receiver/bootstrap and verified mention derivation are implemented.
- [x] Successful-source proposal notification, command-only fallback, official
      SDK text delivery/outbox, and command ingress/review-to-ready are implemented.
- [x] Real transport smoke used `agent-test` as the sole consumer; the worker
      shut down gracefully.
- [x] Real command approval produced one Entry and a ready snapshot; a second
      new root created a Fresh Session, pinned the exact snapshot ID/hash, and
      the real Agent recalled `LARK_REAL_MEMORY_ACCEPTED_20260725_0039`.
- [ ] Deterministic full command-path E2E, `make ci`, final docs/ADR/runbook/
      evidence packet, and final PR remain incomplete.
- [ ] Crash recovery, multi-node behavior, extra redrive/fault injection,
      performance, and polish are transferred to post-E2E hardening.

---

## Phase 3 — Autonomous Card/Doc Memory review

The command-only path and Tasks 1–8 are complete. Tasks 9–14 below are the next
implementation graph. Each task follows RED → minimal GREEN → focused tests →
affected integration gates. Do not add commit/stage steps; commits require
explicit approval outside this plan.

### Task 9: Add review-surface persistence and selection policy

**Files and symbols:**

- Create `src/infrastructure/postgres/migrations/0014_lark_memory_review_surfaces.sql`.
- Modify `src/infrastructure/postgres/postgres.ts` migration registry.
- Create `src/domain/channels/lark-memory-review-surface.ts` with
  `ReviewSurfaceMode`, `ReviewSurfaceStatus`, `LarkMemoryReviewSurface`, and
  bounded transition types.
- Create `src/application/ports/lark-review-surface-repository.ts` with
  `createSurface`, `getSurface`, `claimActiveVersion`, `savePreview`, and
  `resolveSurface` CAS/idempotency methods.
- Create `src/infrastructure/postgres/postgres-lark-review-surface-repository.ts`.
- Create `src/application/channels/select-memory-review-surface.ts` and its test.
- Add PGlite coverage beside the application/repository tests and fresh real-PG
  assertions in `tests/integration/real-pg-pool.integration.test.ts`.

- [x] Write RED tests first:
      `pnpm exec vitest run --config vitest.unit.config.ts src/application/channels/select-memory-review-surface.test.ts`
      must fail because the repository and selection policy are absent. Cover
      short iff `content.length <= 1500` **and** line count `<= 20`, long when
      either threshold is exceeded, command-only fallback, one active version,
      stale CAS, exact replay, and cross-modality convergence.
- [x] Add additive migration `0014_lark_memory_review_surfaces.sql` with exact
      Proposal/Binding foreign-key relations, one active version invariant,
      mode/status, Card message ID, Doc token/revision, immutable preview
      content/SHA-256 hash, opaque action-token hash/lookup fields,
      creating/resolving ingress IDs, bounded fields, and idempotency/CAS
      constraints. Do not store provider callback update tokens or raw payloads.
- [x] Implement the minimal domain/port/Postgres repository. `claimActiveVersion`
      must prevent a stale or duplicate surface transition from replacing the
      active version or reopening canonical Memory. `savePreview` persists an
      immutable content/hash pair; `resolveSurface` is idempotent by ingress and
      surface version.
- [x] Run focused unit/PGlite tests and then:

  ```bash
  pnpm exec vitest run --config vitest.integration.config.ts \
    tests/integration/channel-core-postgres.integration.test.ts \
    tests/integration/real-pg-pool.integration.test.ts
  ```

  Expected: concurrent and replayed surface operations converge on one active
  version under PGlite and fresh caller-provided PostgreSQL.

- [x] Preserve the focused evidence and keep the command-only path green before
      starting Task 10.

#### Task 9 completion evidence

- Under Node `v24.18.0`, domain/selector focused tests passed 5/5; affected
  integration passed 91 with 12 skipped; fresh real PostgreSQL passed 6 files /
  73 tests; typecheck and `git diff --check` passed.
- The additive `0014` migration, review-surface domain/port/Postgres repository,
  selection policy, one-active-version CAS/idempotency, opaque action-token
  lookup, exact Proposal/Binding/ingress/source-Session relations, and preview
  fields are implemented.
- Spec review remediation covered exact-owner replay, binding/ingress/source-
  Session context, pending-proposal enforcement, atomic replacement, and
  canonical root/Card resolution. Final verdict: `SPEC_COMPLIANT`.
- Quality review remediation covered row locks/TOCTOU, cross-instance PGlite
  serialization, preview mode, ID bounds, UTF-8 limits, and consistent
  proposal → binding → surface lock order. Final verdict: `QUALITY_APPROVED`.

### Task 10: Implement Card 2.0 render, callback, and canonical review

**Files and symbols:**

- Create `src/adapters/lark/lark-memory-card.ts` with
  `renderPendingMemoryCard`, `renderCardWithDocControls`,
  `patchMemoryReviewCard`, and bounded action helpers.
- Create `src/adapters/lark/lark-memory-card.test.ts`.
- Create `src/application/channels/apply-memory-review-control.ts` and
  `src/application/channels/apply-memory-review-control.test.ts`.
- Modify `src/adapters/lark/lark-websocket-receiver.ts` registration and
  `src/adapters/lark/normalize-lark-event.ts` Card action normalization.
- Modify `src/application/channels/publish-memory-review-surface.ts` and
  `src/application/channels/deliver-channel-outbox.ts` for Card 2.0 JSON,
  stable Thread replies, `message.patch`, and `update_multi`.
- Add captured sanitized fixture under
  `tests/fixtures/lark/card-action-trigger-captured.json` without the callback
  update token.

- [x] Write RED tests first:
      `pnpm exec vitest run --config vitest.unit.config.ts src/adapters/lark/lark-memory-card.test.ts src/application/channels/apply-memory-review-control.test.ts`
      must fail because business Card rendering/application is absent. Cover
      short Card, long control Card, Accept/Edit in Doc/Reject, the multi-button
      `{ action: <bounded enum>, token: <opaque random token> }` value, token-hash
      lookup, message/chat/operator/surface/source-Session/owner validation,
      duplicate/stale/cross-user actions, callback fixture replay, and Card
      patch failure after canonical commit.
- [x] Implement short selection as both `<= 1500` characters and `<= 20` lines.
      Render category, full proposal text, and safe source explanation with no
      UUID-first user text. Render buttons Accept, Edit in Doc, and Reject.
      Long proposals render only a bounded readable excerpt plus Doc URL/status
      and Preview Doc, Accept Preview, and Reject controls.
- [x] Register `card.action.trigger` on the existing low-level WebSocket path.
      Normalize the captured envelope while treating `card_content` as
      non-authoritative and the provider timestamp as an opaque scalar. Store
      durable control ingress before acknowledgement. Each active surface has one
      opaque random token, with only its SHA-256 hash persisted. Every callback
      value is `{ action: <bounded enum>, token: <opaque random token> }`; the
      action is untrusted and must match current surface mode/status. Token-hash
      lookup plus Card message ID, chat, operator, action, surface version, source
      Session, and exact owner tuple authorize the action. Do not place proposal
      IDs, accepted content, owner identifiers, or provider callback update
      tokens in the value.
- [x] Implement `ApplyMemoryReviewControl` to converge Card and command actions
      on `ReviewMemoryProposal` and `ManagedMemory.acceptEntry`, verify a ready
      snapshot before reporting success, and preserve canonical decisions when a
      Card patch/update fails. Reply in Thread with stable provider UUID.
- [x] Run focused unit tests, the captured-fixture replay, and affected
      integration tests. Expected: Card actions pass through durable ingress and
      wrong/stale/duplicate actions fail safely without reopening Memory.

Task 10 final verdict is `SPEC_COMPLIANT`. Its latest narrow Node 24 regression
passed 5 unit files / 38 tests, 3 integration files / 16 tests, typecheck, and
`git diff --check`. Post-canonical ingress retry/fencing, manual rebuild versus
concurrent Accept, and rolling-upgrade allocator races are intentionally deferred
to Task 14 after the minimum Card/Doc E2E.

### Task 11: Complete collaborative Bot Doc preview and acceptance

Task 11 minimum normal path implementation is complete and accepted to proceed.
Preserve the existing Doc create/grant, surface, Card patch, immutable preview,
and Accept Preview code. The latest Oracle lease successor gap is deferred to
Task 14; do not claim final `SPEC_COMPLIANT` or restart the review loop here.

**Files and responsibilities:**

- Modify `src/application/ports/lark-memory-document.ts`: structured current
  draft plus unresolved comments/replies.
- Modify `src/adapters/lark/lark-memory-document.ts` and its test: write only the
  proposal as the editable body; read current blocks and Drive comments/replies
  through the SDK client's low-level `request`; enforce pagination and bounds.
- Create `src/application/channels/synthesize-memory-document.ts` and its test:
  one bounded intermediate Agent call through `AgentRuntimePort`.
- Modify `src/application/channels/apply-memory-review-control.ts` and its test:
  authorize → pull → synthesize → persist immutable preview.
- Modify `src/adapters/lark/lark-memory-card.ts` and its test: label the action
  `Read Changes and Generate Preview`; keep the wire enum `preview_doc`.
- Modify `src/bootstrap.ts`, `src/bootstrap.test.ts`, and
  `tests/fixtures/create-lark-test-service.ts`: wire production and deterministic
  synthesizers plus stateful body/comment fixtures.
- Modify `tests/integration/lark-memory-doc-review-postgres.integration.test.ts`:
  prove the minimum persistence path before the full E2E.

- [x] **Step 1: write the structured Doc-port RED tests.** Replace
      `readFinalContent` with:

  ```ts
  export type MemoryDocumentComment = {
    readonly id: string;
    readonly text: string;
    readonly replies: readonly string[];
  };

  export type MemoryDocumentDraft = {
    readonly body: string;
    readonly revision: string;
    readonly unresolvedComments: readonly MemoryDocumentComment[];
  };

  export type MemoryDocumentPort = {
    create(input: {
      category: string;
      proposal: string;
      allowedOpenId: string;
    }): Promise<BotDocument>;
    readDraft(token: string): Promise<MemoryDocumentDraft>;
  };
  ```

  Test that the created body contains the proposal once and no
  `Final Accepted Content` heading; current body, unresolved comments, and all
  replies are returned; resolved comments are excluded; incomplete pagination,
  empty/oversized body, more than 100 comments, more than 200 total replies, or
  more than 32,768 feedback bytes fails closed.

- [x] **Step 2: run the adapter RED test.** Run:

  ```bash
  pnpm exec vitest run --config vitest.unit.config.ts \
    src/adapters/lark/lark-memory-document.test.ts
  ```

  Expected: fail because `readDraft` and comment/reply retrieval do not exist.

- [x] **Step 3: implement the minimum Doc adapter.** Keep
      `client.docx.document.create`, block writes, and
      `client.drive.permissionMember.create`. Read the latest complete body and
      revision, then use `client.request` for
      `/open-apis/drive/v1/files/:token/comments?file_type=docx&is_solved=false`
      and each comment's `/replies` endpoint. Follow every page token. Do not
      retain raw comments after synthesis and do not silently return a partial
      page.

- [x] **Step 4: add the bounded synthesis service RED test.** The application
      service has this boundary:

  ```ts
  export class SynthesizeMemoryDocument {
    constructor(private readonly runtime: Pick<AgentRuntimePort, 'execute'>) {}
    execute(input: {
      requestId: string;
      category: string;
      body: string;
      unresolvedComments: readonly MemoryDocumentComment[];
    }): Promise<string>;
  }
  ```

  It calls `runtime.execute` once with `runId: input.requestId`, a server-owned
  prompt that treats body as draft and comments/replies as revision requests,
  and `memoryCandidates: { maxCandidates: 0, proposalLimit: 0 }`. It returns only
  trimmed runtime text and rejects empty or more than 4,096 UTF-8 bytes. This is
  the user-approved intermediate call inside the existing Product Task; it does
  not create a second Product Task/Run and does not import Paseo.

- [x] **Step 5: run synthesis RED, implement, and rerun GREEN.** Run:

  ```bash
  pnpm exec vitest run --config vitest.unit.config.ts \
    src/application/channels/synthesize-memory-document.test.ts
  ```

  Expected RED: class absent. Expected GREEN: body-only, body-plus-comment,
  reply, empty output, oversized output, and runtime failure cases pass.

- [x] **Step 6: convert Preview Doc into pull → synthesize → immutable preview.**
      In `ApplyMemoryReviewControl`, keep all existing authorization checks.
      `preview_doc` calls `readDraft`, then `SynthesizeMemoryDocument.execute`
      with `requestId: ingress.id`, then persists only candidate content/hash via
      `savePreview`. `accept_preview` never rereads the Doc and accepts exactly
      persisted preview content. Body/comment/synthesis failure keeps the
      proposal pending and records a safe reason such as
      `document_feedback_unavailable` or `memory_preview_synthesis_failed`.

- [x] **Step 7: extend the fake and focused persistence scenario.** Add
      deterministic `setBody`, `addComment`, `addReply`, and `resolveComment`
      helpers. Prove body plus one unresolved comment produces the fake Agent's
      synthesized marker; changing the Doc afterward cannot change the stored
      preview, accepted Entry, or ready snapshot.

- [x] **Step 8: run focused Task 11 evidence under Node 24.** Run the adapter,
      synthesizer, control, Card, bootstrap, and Doc-review integration tests,
      then typecheck and `git diff --check`. Expected: all pass; no full E2E or
      real-provider claim is made yet. Latest evidence is unit 20 files/165
      passed, review-surface PGlite 3 and control 5 rerun, focused serial
      acceptance passed, typecheck/build/Prettier/diff-check passed, with no
      real-PG Task 11 evidence. Final `SPEC_COMPLIANT` remains unclaimed.

### Task 12: Add deterministic full Card/Doc E2E

**Files and symbols:**

- Create `e2e/lark-memory-card-doc.e2e.test.ts` using the existing fake provider,
  service fixture, managed published AgentVersion opt-in, and a fresh
  caller-provided real PostgreSQL database. Single-connection PGlite cannot
  credibly model receiver, ingress worker, Run dispatcher, outbox worker, and
  direct-SQL polling with independent transaction owners.
- Create `tests/fixtures/lark/captured-card-action-trigger.json` as the sanitized
  transport replay fixture; generate action-specific opaque tokens per test.
- Extend `tests/fixtures/create-lark-test-service.ts` only for deterministic
  Card/Doc provider behavior; no external model/provider calls.

- [x] **Step 1: write one RED E2E first** against fresh caller-provided
      PostgreSQL:
      `DATABASE_URL="$DATABASE_URL" pnpm exec vitest run --config vitest.e2e.config.ts e2e/lark-memory-card-doc.e2e.test.ts`
      Expected RED: comment/synthesis or complete Card/Doc path is not wired.
- [x] **Step 2: implement only the minimum accepted long-Doc path.** First root
      creates a long proposal, Bot Doc, and active control Card. The fixture edits
      the Doc body, adds one unresolved comment plus reply, clicks
      `preview_doc`, and the fake Agent returns a unique synthesized marker.
      Assert immutable preview content/hash and that the proposal remains pending.
- [x] **Step 3: accept and recall.** Change the Doc again after preview, click
      `accept_preview`, and assert exactly one accepted Entry and one ready
      snapshot contain the preview marker but not the later edit. A second new
      root creates a Fresh Session, pins that exact snapshot ID/hash, and its
      fake Agent prompt/result recalls the preview marker.
- [x] **Step 4: add only acceptance-boundary negative assertions.** Wrong actor,
      missing/incomplete comments, and accepting without preview fail closed;
      exact callback replay creates no duplicate Entry/snapshot/outbox. Defer
      broad provider retry, multi-node, and unusual race matrices to Task 14.
- [x] **Step 5: run focused E2E twice together against fresh caller-provided
      PostgreSQL, then:**

  ```bash
  pnpm exec vitest run --config vitest.e2e.config.ts \
    e2e/lark-memory-card-doc.e2e.test.ts \
    e2e/lark-memory-command.e2e.test.ts
  ```

  Expected: all deterministic Card/Doc/command paths pass with fake Lark and
  fake runtime over real PostgreSQL, with no external model, Lark App, or
  provider network dependency.

- [x] **Step 6: run affected unit/integration gates under Node 24;** preserve sanitized
      correlation IDs, hashes, and status boundaries only.

Task 12 orchestrator fresh evidence: dedicated dropped/created real PostgreSQL;
`tests/integration/lark-memory-card-doc-real-pg.integration.test.ts` passed 1/1
in 489 ms; existing command E2E passed 1/1 in 633 ms; `tsc --noEmit`,
`pnpm build`, and `git diff --check` passed. The normal path proved two Product
Runs and three runtime calls (source, synthesis, recall), including exact
successor preview/hash acceptance and second-session snapshot pin/recall.

### Task 13: Run autonomous real provider Card/Doc QA (complete normal path)

**Files and symbols:**

- Create `scripts/smoke/lark-memory-card-doc-canary.mjs` with bounded readiness,
  one-consumer orchestration, unique IDs, graceful shutdown, and sanitized
  evidence output.
- Modify `package.json` only to add the explicit
  `lark-memory-card-doc-smoke` script if needed.
- Update the command-canary evidence packet only with sanitized provider IDs,
  snapshot IDs/hashes, statuses, and commands after the run.

- [x] Run one Agent Server Lark consumer only. Use the already captured callback
      transport shape for handler replay; do not require another probe click.
      Send/render/read/patch actual business Cards and create/grant/edit/comment/
      reply/read actual Bot Docs through the provider. The user may assist with
      the real Card click/edit/comment step. The orchestrator performs DB/Memory/
      snapshot/Fresh-Session recall checks and records sanitized evidence.
- [x] Confirm compositional real-boundary evidence: captured callback transport,
      deterministic handler replay, and actual provider surface checks together
      prove the contract; do not claim one uninterrupted live click workflow.
- [x] Shut down gracefully, never `kill -9`, never start a second consumer, and
      preserve explicit `delivery_unknown` or safe fallback outcomes.
- [x] Run with Node 24 and caller-provided PostgreSQL. Expected: real provider
      Card/Doc effects, canonical Entry/snapshot state, exact Fresh Session pin,
      and real Agent recall are all correlated without secrets, raw events, raw
      provider errors, or local paths in evidence. Repeated user clicks are only
      required if live provider behavior materially differs.

Task 13 normal-path evidence is recorded in
`docs/evidence/lark-managed-memory-card-doc-canary-evidence-packet.md`. The
source marker first appeared in ready snapshot version 5 and was recalled by a
fresh root. This does not establish production readiness, canonical identity,
physical exactly-once delivery, multi-node leadership, or full crash recovery.
Task 14 hardening is explicitly transferred to
`docs/exec-plans/active/2026-07-25-lark-memory-task14-hardening.md`.

### Task 14: Resolve deferred Oracle blockers before PR

**Files and symbols:**

- Modify the retry classification in
  `src/application/channels/deliver-channel-outbox.ts` and its tests.
- Modify Lark binding/session AgentVersion validation in the existing channel
  resolver and its tests to require exact `workspace_id` equality.
- Modify the relevant smoke/docs command references to remove the nonexistent
  `lark-memory-smoke` claim.
- Fix the UTF-8 byte-safe truncation helper and focused tests.
- Correct the portable NVM command path and mention wording in touched runbook/
  handoff documentation.
- Revisit post-canonical ingress retry/fencing, manual rebuild versus concurrent
  Accept, rolling-upgrade allocator races, and generalized synthesis retry/audit
  state only after Task 12 and Task 13 acceptance evidence exists.
- Add the exact preview successor lease-takeover fence: `savePreview` must
  compare the caller's original exact `leaseOwner` and attempt after preview
  synthesis, and add the takeover regression test. A stale worker must not
  commit a successor after another worker reclaims the ingress.

- [ ] Write RED tests first:
      `pnpm exec vitest run --config vitest.unit.config.ts src/application/channels/deliver-channel-outbox.test.ts src/application/channels/resolve-lark-binding.test.ts`
      must fail for the current retry, workspace equality, or truncation cases.
- [ ] Implement the smallest fixes: retryable outbox ambiguity transitions to
      `delivery_unknown` according to the selected conservative policy; binding
      rejects mismatched AgentVersion Workspace; truncation never exceeds the
      UTF-8 byte bound; stale smoke claims and wording are corrected.
- [ ] Run focused tests, deterministic integration, fresh real-PG, and the full
      Node 24 gates. Expected: all four blockers have explicit passing evidence.
- [ ] Keep the plan active until Card/Doc real QA, remediation, final diff/docs
      review, and PR preparation are complete. Do not claim production identity,
      multi-node leadership, crash recovery, or physical exactly-once delivery.

---

## Compression resume contract

A fresh implementation Agent must read, in order:

1. task-bundle `CONTEXT.md` and newest Lark planning handoff;
2. `WORKFLOW-2026-07-24-agent-server-delivery.md`;
3. repository `AGENTS.md`, `README.md`, `docs/product.md`, and
   `docs/features.md`;
4. `docs/superpowers/specs/2026-07-24-lark-memory-canary-design.md`;
5. this implementation plan;
6. `docs/exec-plans/completed/2026-07-24-lark-memory-canary.md`; and
7. the files listed under the next unchecked task only.

Before coding, verify branch/HEAD/worktree status, live PR state, Node 24, and
the exact Human Gates granted by the user's execution approval. Start with the
Task 9 RED command and keep the Active Exec Plan truthful after every material
result.
