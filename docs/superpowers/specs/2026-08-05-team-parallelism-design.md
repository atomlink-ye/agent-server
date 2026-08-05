# Design: parallel members + incremental Lead

Status: design authority for the Team parallelism slice (Iteration 1) and its
hardening follow-up (Iteration 2). Supersedes nothing; extends
`2026-08-05-team-ergonomics-design.md`, whose determinism constraint (§2 there)
remains binding.

## 1. Goal

Bring Team orchestration to the sequencing shape of ordinary subagent fan-out:
**launch N members concurrently, react incrementally as each returns** — while
preserving determinism.

Determinism here means durable state, deduplicated addressed wakes,
dependency-aware work, bounded turns, replayability, and tenant isolation. It
does **not** mean serial execution. Serialization is an implementation
artifact, not a design guarantee.

The AgentProject declaration remains the authoritative boundary. Nothing in
this slice lets a Lead define agents, tools, environments, or roster
membership at runtime. All changes are in scheduling and gating over
already-declared artifacts.

## 2. Evidence and one correction

A real run (`make agent-teams-v2-smoke`, `opencode-go/glm-5.2`, Docker +
ephemeral Postgres + Paseo) passed `RESULT_PASS` with
`team_members:3, work_items:2, attempts:2, lead_turns:4`, and the Paseo daemon
never reported more than one agent running.

**That observation does not by itself prove a structural barrier.** The smoke's
scripted Lead prompt (`scripts/smoke/agent-teams-v2-main-flow.mjs:706`) creates
Work B with `dependency_refs ["work-1"]`. Work B genuinely depends on Work A, so
the dependency gate (`team-wake-reconciler.ts:142-150`,
`postgres-collaborative-team-repository.ts:628-637`) correctly forbids overlap.
A fully parallel platform would show the same thing on this scenario. The
structural barriers below are real and separately confirmed, but the
acceptance scenario must use **independent** work to prove anything.

Member-member parallelism already exists structurally, capped at 2
(`bootstrap.ts:505` `{ concurrency: 2 }`); `claimNextQueued` has no
per-root-task fence.

## 3. Root causes of serialization

| #   | Mechanism                                                               | Location                                                                                |
| --- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| S1  | Dispatcher cap of 2 blocking loops, each inline through `waitForFinish` | `bootstrap.ts:505`; `postgres-run-dispatcher.ts:60-80`; `paseo-runtime-adapter.ts:1337` |
| S2  | Lead review barrier: false if ANY team-actor child task is non-terminal | `team-driver.ts:307-353` (calls `:143`, `:286`, `:293`)                                 |
| S3  | **S2 is also the only lead-turn mutex**                                 | see §4                                                                                  |
| S4  | Lead command policy zeroed while any attempt is active                  | `team-policy-evaluator.ts:62-72`                                                        |
| S5  | Per-member single-flight, enforced 3×                                   | repo `:808-831`, `:605-627`; `execute-run.ts:724-731`                                   |
| S6  | Dependency gating — correct, keep                                       | `team-wake-reconciler.ts:142-150`                                                       |
| S7  | Directs delivered only to idle members                                  | `team-wake-reconciler.ts:70`                                                            |
| S8  | Wake sweep runs at startup only                                         | `bootstrap.ts:615`                                                                      |

**Removing the barrier alone yields no concurrency and breaks correctness.** It
moves the bottleneck (S4 leaves a mid-flight Lead with zero command tools; S1
still caps at 2) and deletes the only lead mutex (S3). The barrier, the policy
gate, the concurrency cap, and a replacement mutex must change **as one unit**.

## 4. Why `control_state` cannot serve as the lead mutex

`advanceAgenticLead` guards on `control_state <> 'lead_running'`
(`postgres-collaborative-team-repository.ts:1328`). But `control_state` stops
being `'lead_running'` mid-turn: the first `team_work_create` sets
`'member_work_running'` (`:884`), accept sets `'lead_ready'` (`:1006`),
request_changes sets `'member_work_running'` (`:1159`).

So once a Lead turn issues any command, a second Lead turn can pass the CAS.
Because every tool call re-resolves context with a fresh `revision`
(`team-tool-context.ts:58-76`), both turns' commands are _individually_ valid
and optimistic concurrency will not catch the interleaving. This is the single
most dangerous property in the slice.

## 5. Target design

Lead turn N creates K Work items across the roster in one turn. On lead-turn
terminal the reconciler materializes all dependency-free attempts, which
dispatch concurrently. **When any member reaches terminal, the Lead is woken
incrementally** to accept / request changes / create follow-on work for that
item while other members keep running.

**One Work item in flight per member — keep S5.** Member runtime sessions are
reusable single-threaded conversations (`execute-run.ts:607-619`) and the
previous-turn grant fence (`:707-750`) assumes one active task per member.
Parallelism scales with roster size, which is exactly the declared boundary.

### Invariants that must not break

1. **At most one non-terminal `lead_turn` task per team** — the new mutex.
2. `leadTurnCount` monotonic via the `advanceAgenticLead` CAS; stale lead
   terminals dropped by the `teamSequence !== leadTurnCount` guard
   (`team-driver.ts:196-202`).
3. One active attempt per member (S5, all three enforcement points).
4. Attempt materialization atomic with Task/Run/message-bind/dispatch.
5. No materialization until all dependencies accepted (S6).
6. `team_finish` only when every Work item is accepted and no attempt is
   non-terminal.
7. Tenant scoping on every query.

## 6. Race conditions and preventions

- **R1 Double lead turn (the big one).** Prevention: inside the `scheduleLead`
  transaction (`team-driver.ts:398-430`), before `advanceAgenticLead`, query for
  any non-terminal task with `teamMemberRunId = lead.id` and abort if found.
  Invariant 1, enforced in the same transaction as the CAS.
- **R2 Lost wake.** A member finishing during a lead turn has its wake
  suppressed by R1's mutex. No new wake record is needed: "completed attempt
  whose Work item is not accepted" is already durable evidence, and the driver
  re-evaluates at lead-turn terminal (`team-driver.ts:276-292`). That becomes
  the compensating wake.
- **R3 Concurrent wake dedupe.** Already correct: the `revision=$2` CAS lets one
  win and the loser's `stale_state` is swallowed (`:431-434`). Preserve both.
- **R4 Reconciler mid-pass staleness.** The reconciler snapshots
  `team.revision` once (`team-wake-reconciler.ts:37-41`); a Lead command
  committing mid-pass makes the rest throw `stale_state` and abandons queued
  attempts. Prevention: re-read revision per iteration, or catch/reload/retry
  once. With S8 this can otherwise stall a team.
- **R5 Double materialization.** Already protected by `FOR UPDATE` on
  `team_runs` (`:588`) and the claim predicate (`:602`). Keep. Subsequent real
  concurrency evidence exposed a pre-existing ordering defect around that
  protection: the reconciler inserts Task/Run before reaching the durable
  message/attempt claim, so a concurrent loser can receive the committed
  winner's logical-step unique conflict before the claim predicate runs.
  Iteration 1 did not introduce this bug; parallel execution merely made the
  latent race reachable.
- **R6 `lead_no_progress` false failures.** Keep unchanged; the
  `expectedRevision` + `stale_state` swallow already tolerate racing progress.
- **R7 Stale board snapshot in the Lead prompt.** Intended: mutations validate
  server-side against fresh revision and R2 picks up the remainder. Document,
  no code change.
- **R8 Eligibility.** When relaxing the policy gate, delete only the team-wide
  "any attempt active → none()" clause; per-item eligibility (`:81-91`) already
  computes from that item's latest completed attempt. `team_finish` stays gated
  by invariant 6.

## 7. Migration

**Not required.** The lead mutex is a query over existing `tasks` columns
(`team_member_run_id`, `team_task_kind`, from `0026`); wake dedupe uses the
existing `team_runs.revision` CAS and the `team_messages (team_run_id,
dedup_key)` unique constraint (`0024`). No new `control_state` value is needed
because the design deliberately stops using `control_state` as the mutex. The
last migration remains `0027`.

## 8. Iteration 1 — one indivisible unit

1. Raise and expose dispatcher concurrency (`bootstrap.ts:505`), env-driven,
   default 4. Keep the blocking-loop design.
2. Rewrite the barrier (`team-driver.ts:307-353`): "no non-terminal _lead_
   task" AND "at least one actionable condition (completed-unreviewed attempt,
   empty board, or all-accepted)". Members running no longer block. Keep the
   dependency-aware queued-attempt clause (`:342-352`).
3. Lead mutex in-transaction (`team-driver.ts:398-430`) per R1.
4. Relax the policy gate (`team-policy-evaluator.ts:62-72`) per R8.
5. Reconciler staleness resilience (`team-wake-reconciler.ts:177-198`) per R4.
6. Make the acceptance scenario use **independent** Work A and Work B assigned
   to different members (see §2 — this is what makes the proof valid).

### Acceptance (real E2E, real model, Docker + Postgres + Paseo)

In one run: (a) the two member attempts have **overlapping run intervals**
(`runs` timestamps, or Paseo `byLifecycle.running >= 2`); (b) the Lead accepts
work-1 while work-2's run is still non-terminal; (c) the team reaches
`succeeded`; (d) an invariant query for non-terminal `lead_turn` tasks per team
never exceeds 1.

Because R1 is a race, run the parallel smoke **~10 times** with a fast model
before calling this done. The race, if present, appears under exactly that
repetition.

### Deferred

Telemetry poll replacement, multiple attempts per member, Lead corrective
actions (cancel/reassign), new test suites, per-tenant scheduling fairness,
non-blocking dispatcher.

Claim-before-insert was evaluated for the R5 ordering defect and rejected for
this slice. Both `team_messages.consumed_by_task_id` and
`team_work_item_attempts.execution_task_id` are immediate foreign keys to
`tasks(id)`, so the existing claim operations cannot bind a pre-generated Task
UUID before its Task row exists. A lock-before-insert design would require a
new transaction-scoped reservation operation across the message and execution
ports. The bounded correction instead treats only PostgreSQL `23505` on
`tasks_root_logical_step_key_unique` as evidence of a committed competing
materialization, makes that benign loss observable, and propagates every other
error.

## 9. Iteration 2 — hardening

1. Replace the nested-activity busy-poll (`paseo-runtime-adapter.ts:1102-1106`,
   ~234 RPC per 30s per run, multiplied by N concurrent runs) with the existing
   push subscription (`paseo-client-port.ts:371-378`) plus a slow (~5s)
   reconcile fallback for missed events.
2. Crash/restart discipline under concurrency: kill mid-lead-turn and
   mid-member-turn; verify no double lead turn and no stalled team. Add a
   periodic `reconcileQueuedWakeRoots` sweep (currently startup-only,
   `bootstrap.ts:615`) so S8 stalls self-heal.
3. Stall detector in the smoke: on timeout, dump board state so a lost wake is
   diagnosable in one look.

## 9b. Member-internal subagents: allowed, with attribution enforced

Owner decision, 2026-08-05. This corrects an earlier judgement in this task
bundle that treated member subagent spawning as boundary-hostile.

Two distinct layers exist, and the AgentProject boundary constrains only the
first:

- **Declaration layer** — agent-server Agents and the Team roster. Durable
  entities, tenancy, tool grants. Must be declared; a Lead may not mint new
  member types at runtime.
- **Runtime-internal layer** — the provider runtime's own subagent
  decomposition inside a single member's turn (Codex `~/.codex/agents/*.toml`,
  opencode subagents).

**Spawning at the runtime-internal layer does not widen the boundary.** It
defines nothing in agent-server: no durable entity, no tenant object, and no
additional tool grant — descendants remain inside the member's granted
toolset, because `allowedTools` is computed server-side as role ∩ agent grant
(`team-policy-evaluator.ts:156-160`, `execute-run.ts:516-531`). How a member
accomplishes its assigned Work is exactly the in-boundary latitude §2 of the
ergonomics design endorses. The earlier "boundary-hostile" call conflated
_runtime-internal decomposition_ with _defining an Agent at invocation time_;
they are different things.

**The real constraint is attribution, not spawning.** The historical reason for
forbidding it was that a descendant could call control-plane tools, leaving the
control plane unable to tell whether the member itself or a descendant acted.

Today that is enforced only by prompt text
(`scripts/smoke/agent-teams-v2-main-flow.mjs:706`: "Only the original outer
member may create at most one bounded domain child subagent... the whole tree
must stop all Team mutation"), and prompt-level tree discipline has been
observed to fail in this bundle — a nested verifier wandered into disallowed
shell exploration and failed its attempt.

Direction when this becomes a slice:

1. Bind Team mutation tools to member identity + turn epoch, recording
   provenance (member root thread vs descendant).
2. Enforce single-submit/idempotency server-side rather than by prompt.
3. Keep descendants inside the member's declared grant (already true).

Foundation already exists: provider subagents are already observed
(`paseo-runtime-adapter.ts:1070-1099`). What is missing is turning that
telemetry into authorization and provenance. Do not design anything that
forecloses agent-server offering equivalent nested capability itself later.

## 10. Where agent-server still differs, and whether that is a gap

- **Teammate-to-teammate messaging while busy** — directs queue until the
  recipient is idle (`team-wake-reconciler.ts:70`). Correct consequence of
  one-task-per-member determinism.
- **Lead interrupting/redirecting a running member** — **genuine gap**, and the
  natural next slice after these two (Lead corrective actions).
- **Wake latency** — durable dispatch costs seconds versus in-session wakes.
  Correct consequence of durability and replayability.
- **Bounded fan-out** — bounded by `AGENTIC_TEAM_LIMITS` and the declared
  roster. Correct consequence of the AgentProject boundary; the constants being
  hardcoded is a parameterization chore, not an architecture gap.
- **Worker-pool cap vs unbounded per-call concurrency** — a durable
  multi-tenant platform should keep the cap and make it configuration, which
  Iteration 1 does.
