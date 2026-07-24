# Lark Managed Memory Canary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reproduce the proven Managed Agent Workspace Memory proposal, review,
ready-snapshot, Fresh Session, and real-Agent recall flow through one fixed Lark
group with Card-first review, Bot Doc assistance, and Thread command fallback.

**Architecture:** A low-level official Lark WebSocket adapter durably inserts
normalized inbound events before acknowledgement. Workers map one configured
group/user to the existing service-account control plane, reuse one shared
Session turn transaction, and deliver through a durable outbox. Card, Doc, and
command inputs all converge on the existing canonical Memory review and
snapshot publication flow.

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

**Delivery policy:** The user approved execution on 2026-07-24. Implement the
three phases sequentially on one branch, preserving each phase's focused and
acceptance gates. Do not open an intermediate PR; open one final PR only after
Phase 3 and the complete canary evidence pass. Do not mark implementation
checkboxes complete in this planning document until the work is actually done.

---

## Delivery graph

Execute as three sequential local phases on one branch. Do not start a later
phase until the prior phase's focused and final gates pass.

1. **Phase 1:** Shared Session turn admission seam.
2. **Phase 2:** Durable fixed-Lark text path.
3. **Phase 3:** Card/Doc Memory review and final real-Lark canary.

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
      the Phase 2 next command.
- [x] Update affected Session/Task contracts only if internal origin semantics
      are documented; public API payloads remain unchanged.
- [x] Keep the branch scoped to this delivery; the final PR is opened only
      after Phase 3 and the complete canary evidence pass.

## Phase 1 completion evidence

Tasks 1, 2, and 3 are complete. The trusted origin contract, migration
backfill/uniqueness model, shared SubmitSessionTurn seam, authenticated HTTP
parity, fake-Lark parity, and real-PostgreSQL regressions all passed their
focused and full Phase 1 gates. Phase 2 and Phase 3 remain unchecked.

## Next exact command

Begin Phase 2 Task 4 with the SDK compatibility RED test and dependency gate:

```bash
pnpm exec vitest run --config vitest.unit.config.ts \
  src/adapters/lark/lark-compatibility.test.ts
```

Expected: RED before adding the official SDK dependency. Keep all three phases
on the same branch and open one final PR only after Phase 3.

---

## Phase 2 — Durable fixed-Lark text path

### Task 4: Prove the official SDK compatibility boundary

**Files:**

- Modify: `package.json`, `pnpm-lock.yaml`
- Create: `src/adapters/lark/lark-compatibility.test.ts`
- Create: `tests/fixtures/lark/message-receive-v1.json`
- Create: `tests/fixtures/lark/card-action-trigger.json`
- Create: `src/adapters/lark/normalize-lark-event.ts`

- [ ] Add `@larksuiteoapi/node-sdk@1.71.1` exactly and create sanitized fixtures
      from the proven local event shapes without real content or secrets.
- [ ] Write tests proving message/event/chat/root/thread/reply/sender/mention IDs,
      unknown-field tolerance, and `message_id` dedup selection.
- [ ] Add a fake durable insert that blocks until released and assert the
      low-level dispatcher does not acknowledge before the returned promise commits.
- [ ] Assert card actions expose provider event ID, operator, chat, Card message
      ID, action value, and a response/update path.
- [ ] Assert graceful close cancels reconnect work and no second App consumer is
      allowed by the local lock.
- [ ] Run:

```bash
pnpm exec vitest run --config vitest.unit.config.ts \
  src/adapters/lark/lark-compatibility.test.ts
```

Expected: PASS before any production receiver is written. If durable ack or
Card callback fails, stop at the Human Gate and do not continue Phase 2.

- [ ] Preserve the compatibility evidence on the delivery branch before
      continuing Phase 2.

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

- [ ] Write RED tests for one message ingress, concurrent duplicate convergence,
      one binding/session, outbox logical uniqueness, lease reclaim, and delivery
      attempt results including `unknown`.
- [ ] Create only `channel_ingress_events`, `channel_conversation_bindings`,
      `channel_outbox`, and `channel_delivery_attempts` with the exact uniqueness,
      bounds, foreign keys, and state checks in the design.
- [ ] Implement repository methods:

```ts
insertIngress(input): Promise<{ record: ChannelIngressEvent; inserted: boolean }>;
claimIngress(workerId, leaseMs): Promise<ChannelIngressEvent | null>;
resolveBinding(input): Promise<ChannelConversationBinding>;
saveOutbox(input): Promise<{ record: ChannelOutbox; inserted: boolean }>;
claimOutbox(workerId, leaseMs): Promise<ChannelOutbox | null>;
recordAttempt(input): Promise<void>;
```

- [ ] Store normalized safe fields only; reject oversized text/action/error
      values and never add a raw payload column.
- [ ] Run focused PGlite and real-PG tests. Expected: duplicate and restart
      convergence pass on both.
- [ ] Preserve the durable-core evidence on the delivery branch before the next
      Phase 2 task.

### Task 6: Add fixed compatibility configuration and binding

**Files:**

- Modify: `src/shared/config.ts`
- Create: `src/application/channels/resolve-lark-binding.ts`
- Create: `src/application/channels/resolve-lark-binding.test.ts`
- Create: `src/application/channels/process-channel-ingress.ts`
- Create: `src/application/channels/process-channel-ingress.test.ts`

- [ ] Write RED config tests for missing/empty App secret, conflicting service
      account scope, unknown domain, missing IDs, and disabled canary.
- [ ] Add optional `larkCanary` config with `enabled`, connection/App/domain,
      allowed chat/open ID, Tenant/Workspace/service-account/AgentVersion IDs, and
      policy version. Secrets remain environment-only.
- [ ] Implement validation that the configured service account exists, is
      enabled, and has the exact Tenant/Workspace tuple.
- [ ] Implement root resolution with:

```ts
const rootMessageId = event.rootId ?? event.externalMessageId;
```

New roots require a verified Bot mention. Thread controls revalidate actor/chat
and reuse the unique binding. The resolver creates no orphan Session when it
loses a binding race.

- [ ] Call `SubmitSessionTurn` with Lark ingress ID as trusted origin and Lark
      message ID as idempotency key.
- [ ] Run focused unit/integration tests; expect unknown chat/user/no-mention to
      produce no binding, Session, or Task.
- [ ] Preserve the binding evidence on the delivery branch before the next Phase
      2 task.

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
- [ ] Implement one App lock and one low-level WebSocket dispatcher. The handler
      only normalizes and commits ingress before returning.
- [ ] Implement the terminal Task notifier as a deterministic query of proposals
      from successful source Runs; unique key is proposal + surface kind + version.
- [ ] Implement text/command-only fallback rendering with safe IDs and no raw
      provider errors.
- [ ] Implement bounded retry while UUID replay is safe; after ambiguity outside
      the provider window, persist `delivery_unknown` and stop automatic resend.
- [ ] Add `dev:lark`/`start:lark` scripts without changing default API startup.
- [ ] Run focused tests plus `make test-integration` and `make ci`.
- [ ] Preserve the text-worker evidence on the delivery branch before Phase 3.

### Task 8: Close Phase 2 evidence

- [ ] Run fake-runtime real-socket E2E proving one root → one Session/Task,
      thread reuse, different root → different Fresh Session, and safe shutdown.
- [ ] Run real PostgreSQL duplicate/concurrent/restart tests.
- [ ] Run a transport-only `agent-test` smoke with Agent Server as the sole
      consumer; do not run competing `lark-cli event consume`.
- [ ] Update `docs/features.md` as internal canary-incomplete and add the Channel
      ownership/transport ADR plus text-path runbook sections.
- [ ] Record exact evidence and continue on the same branch into Phase 3.

---

## Phase 3 — Card/Doc Memory review and final canary

### Task 9: Add review-surface persistence and selection policy

**Files:**

- Create: `src/infrastructure/postgres/migrations/0014_lark_memory_review_surfaces.sql`
- Modify: `src/infrastructure/postgres/postgres.ts`
- Create: `src/application/ports/lark-review-surface-repository.ts`
- Create: `src/infrastructure/postgres/postgres-lark-review-surface-repository.ts`
- Create: `src/application/channels/select-memory-review-surface.ts`
- Create: `src/application/channels/select-memory-review-surface.test.ts`

- [ ] Write RED tests for Card at ≤1,500 chars/≤20 lines, Card+Doc above either
      threshold, command-only fallback, immutable surface versions, and one resolved
      canonical outcome.
- [ ] Add `lark_memory_review_surfaces` with proposal/binding IDs, mode, Card
      message ID, Doc token/revision, immutable preview content/hash, surface
      version/status, creating/resolving ingress IDs, and state constraints.
- [ ] Implement the deterministic policy and repository CAS transitions.
- [ ] Run unit, PGlite, and real-PG tests; expected: concurrent cross-modality
      decisions converge on one active surface version.
- [ ] Preserve review-surface evidence on the delivery branch before the next
      Phase 3 task.

### Task 10: Implement Card-first review

**Files:**

- Create: `src/adapters/lark/lark-memory-card.ts`
- Create: `src/adapters/lark/lark-memory-card.test.ts`
- Create: `src/application/channels/apply-memory-review-control.ts`
- Create: `src/application/channels/apply-memory-review-control.test.ts`
- Modify: Lark receiver and outbox delivery files from Phase 2

- [ ] Write RED tests for bounded Card rendering, accept, reject,
      edit-and-accept, wrong operator/chat, stale version, duplicate click, missing
      loop, and async update fallback.
- [ ] Render action values containing only proposal ID, surface version, and
      action; never encode principal, Workspace, secret, or accepted content in an
      authority-bearing token.
- [ ] Commit card actions to `channel_ingress_events` before acknowledgement.
- [ ] Implement `ApplyMemoryReviewControl` to revalidate the configured tuple,
      call `ReviewMemoryProposal`, pass the returned accepted Entry to
      `ManagedMemory.acceptEntry`, verify the returned snapshot is `ready`, and write
      proposal/entry/snapshot evidence before resolving the surface.
- [ ] Retry publication from an already accepted Entry without changing the
      decision; never report success for a failed snapshot.
- [ ] Run focused tests and existing Workspace Memory contract/integration/E2E
      tests.
- [ ] Preserve Card review evidence on the delivery branch before the next Phase
      3 task.

### Task 11: Implement Bot Doc auxiliary review

**Files:**

- Create: `src/adapters/lark/lark-memory-document.ts`
- Create: `src/adapters/lark/lark-memory-document.test.ts`
- Modify: `src/application/channels/apply-memory-review-control.ts`
- Modify: `src/adapters/lark/lark-memory-card.ts`

- [ ] Write RED tests for one Bot-owned Doc, one explicit user grant, at most
      200 blocks, one delimited `Accepted Content` section, ≤4,096 accepted chars,
      malformed/duplicate sections, permission failure, and later-edit isolation.
- [ ] Implement Doc creation and grant using the official client; do not use
      `lark-cli` from production code.
- [ ] Implement two-step preview:

```text
Preview Doc Version
→ fetch and parse current Accepted Content
→ persist immutable content + SHA-256 hash on surface version
→ show excerpt/hash on Card

Accept Previewed Version
→ revalidate actor/chat/proposal/surface version
→ accept the persisted immutable content/hash
```

- [ ] If Doc creation/grant/fetch fails, keep Card active and expose one command
      fallback. Never accept unverified Doc content.
- [ ] Run focused tests and verify later Doc edits do not mutate the accepted
      Entry or ready snapshot.
- [ ] Preserve Bot Doc review evidence on the delivery branch before final E2E.

### Task 12: Add deterministic and real-Lark final E2E

**Files:**

- Create: `e2e/lark-memory-canary.e2e.test.ts`
- Create: `scripts/smoke/lark-memory-canary.mjs`
- Modify: `package.json`, `Makefile`
- Create: `docs/evidence/lark-managed-memory-canary-evidence-packet.md`

- [ ] Write deterministic fake-provider E2E for source root → successful Run →
      proposal → Card/Doc/command review → ready snapshot → second root → exact pin
      → recall, including rejected/late/other-Workspace exclusion.
- [ ] Make the smoke script require the caller-provided `agent-test` profile and
      environment; verify Bot/User auth readiness without printing credentials.
- [ ] Automate the command fallback canary. Keep Card click and Doc edit as
      bounded human QA steps with machine-verifiable database/API aftermath.
- [ ] Use unique provider/idempotency keys per run and graceful consumer
      shutdown. Never `kill -9` and never start a second App consumer.
- [ ] Record only sanitized correlation IDs, snapshot hashes, commands, result
      boundaries, and remaining risks.
- [ ] Run:

```bash
make test-unit
make test-contract
make test-integration
DATABASE_URL="$DATABASE_URL" make test-real-pg
make e2e-smoke
make ci
make paseo-smoke
make eval-smoke
pnpm lark-memory-smoke
```

Expected: deterministic/local gates pass; real Lark and real Agent evidence
proves the exact edited accepted marker is recalled from the pinned snapshot.

### Task 13: Close repository authority and archive the plan

**Files:**

- Modify: `docs/features.md`
- Modify: `docs/components/channel-api-console.md`
- Modify: `docs/contracts.md` and relevant detailed contracts
- Create: `docs/decisions/0008-lark-memory-canary.md`
- Create: `docs/operations/lark-memory-canary-runbook.md`
- Finalize and move: `docs/exec-plans/active/2026-07-24-lark-memory-canary.md`
  to `docs/exec-plans/completed/`

- [ ] State the exact compatibility boundary: one App/group/user, fixed service
      account, no canonical User/Membership, no production claim.
- [ ] Document Card-first/Doc auxiliary/command fallback and one canonical Memory
      state machine.
- [ ] Document external actor audit, no raw event retention, 4,096-char accepted
      content bound, and `delivery_unknown` recovery.
- [ ] Record all Human Gate decisions and transfer every deferred item to a
      linked issue or follow-up Exec Plan.
- [ ] Run `make check`, verify no secret/raw error/local-path leakage, check every
      Exec Plan item, set `status: completed`, move it to `completed/`, and rerun
      `pnpm check:exec-plans`.
- [ ] Open one final PR containing the complete implementation and documentation
      only after all Phase 3 gates pass.

---

## Compression resume contract

A fresh implementation Agent must read, in order:

1. task-bundle `CONTEXT.md` and newest Lark planning handoff;
2. `WORKFLOW-2026-07-24-agent-server-delivery.md`;
3. repository `AGENTS.md`, `README.md`, `docs/product.md`, and
   `docs/features.md`;
4. `docs/superpowers/specs/2026-07-24-lark-memory-canary-design.md`;
5. this implementation plan;
6. `docs/exec-plans/active/2026-07-24-lark-memory-canary.md`; and
7. the files listed under the next unchecked task only.

Before coding, verify branch/HEAD/worktree status, live PR state, Node 24, and
the exact Human Gates granted by the user's execution approval. Start with Task
1 RED evidence and keep the Active Exec Plan truthful after every material
result.
