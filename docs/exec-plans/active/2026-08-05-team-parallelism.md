---
status: active
owner: agent/team-ergonomics
created_at: 2026-08-05
updated_at: 2026-08-05
authority: execution-plan
---

# Outcome

Let independent declared Team members execute concurrently and wake the Lead incrementally as each finishes, while preserving the durable scheduling invariants and the AgentProject boundary.

## Context and authority

`docs/superpowers/specs/2026-08-05-team-parallelism-design.md` is the approved Human Gate and design authority for this slice. Its Iteration 1 section is one indivisible unit. The prior ergonomics work is checkpointed in three local commits ending at `3550450`; no migration is authorized or required here.

## Scope

- [x] Expose dispatcher concurrency through configuration with default 4, retaining the existing blocking worker loops.
- [x] Replace the team-wide Lead barrier with a no-active-Lead-task check plus an actionable wake condition, while preserving dependency-aware queued-attempt behavior.
- [x] Enforce at most one non-terminal `lead_turn` task inside the same `scheduleLead` transaction and before `advanceAgenticLead`.
- [x] Remove only the policy evaluator's team-wide active-attempt suppression; retain per-item eligibility and the finish gate.
- [x] Make wake reconciliation tolerate one mid-pass revision race without weakening materialization, dependency, or member single-flight checks.
- [x] Change the existing smoke acceptance scenario to independent Work A and Work B assigned to different declared members, and assert the Lead-task mutex during the run.

## Non-goals

- No migration, new state value, new test suite, runtime boundary expansion, dynamic roster/tool/environment definition, or change to the AgentProject authority.
- No telemetry transport rewrite, multiple attempts per member, Lead cancel/reassign actions, tenant-fair scheduling, non-blocking dispatcher, periodic recovery sweep, or crash/restart hardening.

## Required invariants

1. At most one non-terminal `lead_turn` task exists per Team.
2. `leadTurnCount` remains monotonic through the existing revision CAS; stale Lead terminals are ignored.
3. One active attempt per member remains enforced at all existing gates.
4. Attempt materialization remains atomic with Task/Run/message binding/dispatch.
5. Dependencies must be accepted before materialization.
6. `team_finish` remains available only after all Work is accepted and no attempt is non-terminal.
7. Every new query remains tenant/workspace/principal scoped.

## Work breakdown

- [x] Read the design authority and map dispatcher, driver, repository, policy, reconciler, and smoke paths with a fresh explorer.
- [x] Obtain pre-implementation Oracle review of R1 transaction safety and the R2 compensating-wake argument.
- [x] Implement all six Iteration 1 changes as one bounded slice with a fresh fixer.
- [x] Review the complete diff and have the Oracle inspect the R1/R2/R4 implementation before real execution.
- [x] Run cheap static and deterministic checks, then the existing parallel smoke repeatedly against a fast real model.
- [x] Record the accepted `opencode-go/deepseek-v4-flash` evidence; the Manager explicitly removed the obsolete `glm-5.2` run.
- [ ] Run final repository checks, update evidence truthfully, and commit locally without push or PR.

## Verification

- [x] The two independent member attempt run intervals overlap in all 10 counted runs.
- [x] Incremental acceptance is demonstrated in 10/10 counted runs, exceeding the required 7/10.
- [x] The Team reaches `succeeded` and every attempt is terminal in all 10 counted runs.
- [x] During every observation, non-terminal `lead_turn` task count per Team never exceeds 1.
- [x] Ten fast-model real runs pass to exercise R1 repeatedly.
- [x] `PASEO_MODEL=opencode-go/deepseek-v4-flash` captures the accepted real evidence; no `glm-5.2` run is required.
- [x] `make check` and applicable existing integration/real-PostgreSQL checks pass.

## Risks and recovery

The primary risk is two interleaved Lead turns: `control_state` changes during a turn and is not a mutex. The replacement check must run inside the scheduling transaction before the revision CAS. A member completion suppressed by that mutex remains recoverable because completed-unreviewed Work is durable and Lead-terminal reconciliation re-evaluates it. Mid-pass reconciliation gets one fresh-revision retry so a racing Lead command cannot strand later queued attempts. Recovery is a branch-local revert; no durable schema change exists in this slice.

## Decisions and discoveries

- The previous dependent smoke scenario could not demonstrate concurrency; acceptance must use independent Work assigned to distinct members.
- PostgreSQL dispatch already supports N loops and claim SQL has no per-root fence; configuration wiring is sufficient for dispatcher capacity.
- The existing three member single-flight gates and dependency gates are retained.
- R1 requires removing both stale `control_state` mutex predicates, then checking the transaction-scoped owner-filtered task repository before the existing revision CAS; no new port or migration is needed.
- R2 also requires removing the earlier Lead-terminal active-attempt return, or the revised readiness predicate and compensating wake are unreachable while another member runs.
- Readiness uses the latest attempt per Work item, does not treat dependency-blocked queues as a wake source, and preserves the existing direct-message completion fence for the all-accepted branch.
- R4 retries one full reconciliation pass on `stale_state`, reloading all snapshots; it does not retry generic or invalid-transition failures.
- The reconciler Task-before-claim ordering race is a pre-existing latent bug. Iteration 1 did not introduce it; the added legitimate reconciliation concurrency merely made it reachable.
- Claim-before-insert is not compatible with the current immediate foreign keys from direct messages and attempts to Tasks. A lock-before-insert reservation would add new port/repository behavior, so this MVE uses only the exact committed-winner logical-step conflict as the benign lost-claim signal.
- Non-blocking findings remain in the design authority's Iteration 2/deferred ledger.

## Deferred ledger

- **Generic error mapping loses causes on the team execution path.** This is now a confirmed recurring diagnostic pattern, not a one-off: the local project loader formerly collapsed authoring failures into `filesystem_error`; the smoke formerly collapsed non-symbolic failures into `unexpected_failure`; `execute-run.ts` plus TeamDriver still map most runtime/reconciliation failures to generic `runtime_execution_failed`; and the smoke's `attempts_not_terminal` assertion also hid an exact-count mismatch. The blocking loader/smoke cases and the misleading attempt assertion were corrected in their slices. Broader production error-cause preservation is report-only here.
- **Surface existing typed durable runtime failures in Team board snapshots.** The platform already distinguishes `runtime_timed_out` from `runtime_execution_failed`; a follow-up should project those existing codes into safe board state instead of inventing another classification scheme.

## Validation evidence

- `2026-08-05`: fresh explorer mapped the dispatcher, TeamDriver barrier/scheduler, policy evaluator, reconciler, repository CAS/materialization, and smoke proof points before implementation.
- `2026-08-05`: fresh Oracle returned a conditional GO after identifying the hidden Lead-terminal active-attempt gate, the second SQL `control_state` mutex predicate, direct-delivery finish interaction, full-pass R4 retry requirement, and durable acceptance timing evidence.
- `2026-08-05`: the initial fast-model acceptance repetition was 9/10; repetition 7 failed after incremental acceptance and before finish, with the original smoke mapping hiding the cause.
- `2026-08-05`: after adding failure-only diagnostics, reproduction attempt 6 exposed PostgreSQL `23505` on `tasks_root_logical_step_key_unique` while a committed queued direct-message Task/Run already existed. Two concurrent reconciler calls can insert Task/Run before the direct-message or work-attempt durable claim, so the loser raises before the existing claim CAS can deduplicate it.
- `2026-08-05`: the bounded exact-conflict fix passed TypeScript, formatting, 37 focused tests, Oracle review, and the scripted real-PostgreSQL smoke. Before the revised gate rule, fresh attempt 1 failed before Work creation: the first Lead runtime reported `unknown certificate verification error` in retained Paseo evidence. This is recorded as infrastructure retry 1 and does not count as a product repetition.
- `2026-08-05`: under the revised gate, counted repetitions 1-5 passed all strict invariants and demonstrated incremental acceptance. The next run reached legitimate Team review policy: Lead turn 2 called `team_work_request_changes` for work-1, a second attempt completed, later Lead turns accepted both Work items and finished the Team. The old smoke conflated exact-two attempt cardinality with terminality, so this run is recorded as inconclusive rather than a product failure and does not count.
- `2026-08-05`: after correcting attempt cardinality/terminality diagnostics, counted repetitions 6-10 also passed every strict invariant and demonstrated incremental acceptance. Final gate ledger: 10/10 strict passes, 10/10 incremental demonstrations, one inconclusive successful request-changes trajectory, one infrastructure retry, and zero product failures.
- `2026-08-05`: final `make check` passed types, formatting, docs, and Exec Plan validation; `make test-integration` passed 12 files / 141 tests with 7 files / 36 tests skipped by their normal environment gates; `make test-real-pg` passed 6 files / 74 tests with no skips.

## Current blocker

None. The real-model gate and required repository checks are complete. Only the local commit and plan archival remain.

## Next exact command

Review the final scoped diff, commit locally without push or PR, then archive this completed Exec Plan.

## Cleanup state

The user-authored design authority remains untracked for inclusion in this slice. Unrelated untracked `src/adapters/in-memory/in-memory-runtime-adapter.ts` is preserved and excluded.
