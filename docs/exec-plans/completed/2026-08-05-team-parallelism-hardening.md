---
status: completed
owner: agent/team-ergonomics
created_at: 2026-08-05
updated_at: 2026-08-05
authority: execution-plan
---

# Outcome

Harden the accepted parallel Team path by making nested telemetry push-primary, periodically repairing missed durable wakes, proving process-crash behavior during Lead and member turns, and emitting a bounded board snapshot on smoke timeout.

## Context and authority

`docs/superpowers/specs/2026-08-05-team-parallelism-design.md` section 9 is the approved Human Gate and design authority. Iteration 1 is checkpointed in local commits `652cdf3` and `e72497a`. The AgentProject remains the authoritative boundary. No migration, public contract change, push, or PR is authorized.

## MVE contract

```yaml
stage: harden
appetite: one bounded runtime/dispatcher lifecycle slice
baseline: nested telemetry reconciles every 250ms; queued Team wake repair runs only at startup; smoke timeout lacks a one-look board dump
outcome: push-primary nested activity with a slow fallback, periodic missed-wake repair, and observable crash/stall behavior under concurrent Team execution
real_path: declared three-member Team -> concurrent Paseo runs -> induced Agent Server process loss -> lease expiry/restart -> atomic fail-closed Team projection
highest_unknown: resolved; successful in-flight resume needs durable runtime grants, so this slice terminalizes expired Team turns instead of re-executing them
scope_now:
  - push-primary nested activity with a wakeable slow reconcile fallback
  - dispatcher-idle periodic reconcileQueuedWakeRoots sweep
  - induced mid-Lead and mid-member process crash/restart evidence
  - bounded timeout board dump in the existing Team smoke
no_gos:
  - no AgentProject boundary change, migration, public API, new suite, provider classification scheme, or unrelated recovery framework
canonical_smoke: PASEO_MODEL=opencode-go/deepseek-v4-flash make agent-teams-v2-smoke
exit_condition: measured event-driven RPC volume, nested activity retained, both induced crash windows reach a bounded terminal outcome without double Lead or stall, and timeout diagnostics show the durable board
hill_status: known
```

## Scope

- [x] Replace the 250ms nested-activity busy poll with existing push subscriptions plus a wakeable approximately five-second fallback and one final reconcile.
- [x] Add a dispatcher-idle, dispatcher-wide single-flight periodic `reconcileQueuedWakeRoots` sweep while retaining startup repair.
- [x] Atomically fail closed an expired running Team Lead/member child Run with its Task, attempt/member projection where applicable, and root Team/Run/Task; never reclaim and re-execute the same Run.
- [x] Add a bounded stall snapshot to the existing Team smoke covering Team, Work/attempt/member, Task/Run/lease, and queued-message state without unsafe payloads.
- [x] Exercise process death during one Lead turn and one member turn, then verify bounded fail-closed Team terminalization and the non-terminal Lead mutex.

## Non-goals

- No new test suite, migration, new durable state value, public route, runtime-selected boundary, generalized scheduler, multi-node leadership claim, or broad error-mapping cleanup.
- Do not alter dependency gating, per-member single-flight, finish policy, Lead-turn accounting, AgentProject authority, or provider-subagent authorization/provenance.

## Work breakdown

- [x] Re-read the design authority and map telemetry subscriptions, dispatcher lifecycle, smoke queries, and restart controls with a fresh explorer.
- [x] Obtain fresh Oracle approval of the push/fallback missed-event argument, periodic sweep single-flight behavior, and expired-Run recovery semantics.
- [x] Implement the smallest reviewed file set with a fresh fixer; preserve unrelated untracked work.
- [x] Review the complete diff for scope, safe diagnostics, lifecycle cleanup, and concurrency correctness.
- [x] Run cheap focused checks, then real measured telemetry and induced crash/restart evidence before broad repository checks.
- [x] Run required final checks, update evidence truthfully, commit locally, and archive this plan without push or PR.

## Verification

- [x] A concurrent real Team run retains nested activity reporting while measured `fetchAgentTimeline` plus `listProviderSubagents` volume falls from hundreds per 30 seconds to event-driven/five-second-fallback levels.
- [x] Mid-Lead process loss plus lease expiry/restart produces no overlapping non-terminal Lead turns and reaches the explicit fail-closed Team terminal outcome.
- [x] Mid-member process loss plus lease expiry/restart produces no overlapping non-terminal Lead turns and reaches the explicit fail-closed Team terminal outcome.
- [x] The existing smoke emits a bounded board snapshot when its Team terminal wait times out.
- [x] Existing Iteration 1 strict invariants remain true in the real flow.
- [x] `make paseo-smoke`, `make check`, applicable integration tests, and real-PostgreSQL tests pass.

## Documentation impact

- [x] Product/Feature status remains accurate; no status change is needed for bounded fail-closed hardening.
- [x] Paseo Runtime Adapter and Orchestration component/operations documentation reflects push fallback and periodic repair where materially changed.
- [x] No public Contract or ADR change is currently expected; stop at a Human Gate if discovery proves otherwise.

## Decisions and discoveries

- Existing `agent_stream` and `agent.provider_subagents.update` subscriptions already project nested events; the 250ms RPC loop duplicates them and is telemetry-only.
- The slow fallback must be interruptible, otherwise terminal Run completion can inherit up to five seconds of avoidable latency.
- Dispatcher concurrency means an idle callback needs one shared single-flight/time gate rather than one sweep per loop.
- Discovery found no expired-running-Run reclaim predicate: `claimNextQueued` selects only `runs.status = 'queued'`, and `buildClaimQueuedSql` also requires `fencing_token = 0`.
- Oracle rejected same-Run reclaim/re-execution: Team tools authorize by Task ID, Run ID, terminal status, and a Task+Run context epoch rather than activation/fencing token, so a replacement execution could overlap valid mutations from the stale worker.
- Oracle approved atomic fail-closed terminalization for the exact section 9 requirement. Successful in-flight resume is deferred because the restarted process cannot validate the already-running Paseo agent's in-memory runtime grant bearer. The terminalizer must lock the Team first, then conditionally fail the expired Run, child Task, work attempt/member where applicable, and root Team/Run/Task in one transaction.
- The requested `TeamDriver.materializeQueuedAttempts(team, owner)` cleanup was already committed in Iteration 1 (`652cdf3`).

## Risks and recovery

The primary telemetry risk is a missed push event combined with a fallback that cannot stop or overlaps final reconciliation. The primary dispatcher risk is N concurrent idle loops amplifying repairs. The primary crash risk is any window where an expired Run remains non-terminal after recovery begins; the fail-closed update must make old tool resolution and completion lose before projections are exposed. Successful resume/retry, durable runtime grants, strict wall-clock maintenance under a permanently saturated queue, and provider-agent cancellation are deferred. All changes remain branch-local and recoverable by reverting the Iteration 2 commits.

## Validation evidence

- `2026-08-05`: worktree verified at `e72497a` on `agent/team-ergonomics`; only unrelated untracked `src/adapters/in-memory/` is present and will remain untouched.
- `2026-08-05`: fresh explorer mapped the existing push subscriptions and final reconcile, dispatcher idle/start/stop lifecycle, startup-only wake sweep, smoke board queries, and Docker/Paseo process controls.
- `2026-08-05`: fresh Oracle gave a conditional GO: push events remain primary with a wakeable five-second fallback and final reconcile; dispatcher idle maintenance must be shared/single-flight and separately logged; crash recovery must atomically fail expired Team child Runs and the Team rather than re-executing a Run whose Team tool context lacks activation fencing.
- `2026-08-05`: implementation uses a dispatcher-wide idle callback that first
  terminalizes expired active-Team child Runs (Team row lock first), then repairs
  queued wakes. The callback is idle-triggered and therefore is not a strict
  wall-clock guarantee while all dispatcher loops remain saturated.
- `2026-08-05`: fail-closed recovery deliberately does not resume a successful
  in-flight provider turn; durable runtime grants and provider cancellation are
  deferred until a restart-safe capability seam exists.
- `2026-08-05`: an expired Team child uses stable stop reason
  `turn_lease_expired`; the triggering child is timed out and all sibling
  nonterminal Team children are failed in the same Team-locked transaction so
  no stale child remains executable after root failure.
- `2026-08-05`: the reused Oracle returned GO after verifying owner scoping on every recovery query, `direct_message` sibling fencing, checked root Run/Task terminalization, and explicit diagnostic list bounds.
- `2026-08-05`: a real three-member `opencode-go/deepseek-v4-flash` run passed with overlapping member intervals, incremental acceptance, terminal success, all attempts terminal, and maximum one nonterminal Lead. Paseo reported 13 timeline fetches plus 11 provider-subagent lists in its first 30-second window, then 13/11 and 11/9, versus the measured 117/117 baseline; `agent_stream` carried 118, 123, and 179 pushed events in those windows.
- `2026-08-05`: the existing Paseo adapter suite now proves a pushed provider-subagent update emits an attributed `subagent` activity, performs no fallback list/fetch through 4,999 ms, and performs the expected final reconcile.
- `2026-08-05`: the mid-Lead SIGKILL window contained one running Lead. After the 30-second lease floor and process restart, the Team/root Task/root Run were `failed` with `turn_lease_expired`; nonterminal Leads, all Team children, and queued/running attempts were each zero. The recovery marker identified `lead_turn` with one affected child.
- `2026-08-05`: the mid-member SIGKILL window contained two concurrent running attempts. Restart produced the same bounded fail-closed root state with zero nonterminal children/attempts; one attempt Run was timed out, its sibling failed, and the marker reported two affected children.
- `2026-08-05`: an opt-in forced stall skipped dispatcher start and reached `team_terminal_timeout`; the emitted bounded snapshot showed Team phase/control/revision, three members, two Work items, two attempts, Task/Run statuses, lease/fence/dispatch facts, and queued messages without prompts, results, raw provider errors, paths, or secrets. One preliminary invocation was rejected before setup as `invalid_timeout`; it was corrected to the documented 30-second minimum and is not acceptance evidence.
- `2026-08-05`: no provider or infrastructure retries were needed for the counted real run or induced crash windows. The process deaths were deliberate test stimuli.
- `2026-08-05`: `make paseo-smoke` passed (`PASEO_OPENCODE_BASELINE_OK`); `make check` passed; `make test-integration` passed 141 tests with 36 environment-gated skips; `make test-real-pg` passed all 74 tests.

## Deferred ledger

- **Successful in-flight Team-turn resume.** Runtime grants are currently process-memory bearers, so a restarted Agent Server cannot validate the already-running Paseo Agent. Durable grants, provider cancellation, and safe same-Run resume/retry require a separate capability design; this slice fails closed instead.
- **Strict wall-clock repair under permanent dispatcher saturation.** The periodic repair is intentionally driven from the shared idle path. A permanently saturated dispatcher can delay it; a dedicated scheduler is deferred.
- **Surface existing typed durable failure codes.** `runtime_timed_out` and `runtime_execution_failed` already distinguish infrastructure timeout from execution failure in durable Runs. A later slice should project those existing codes into the board snapshot rather than invent another classification scheme.
- **Generic error mapping loses causes on the Team execution path.** The recurring pattern recorded in Iteration 1 remains: broad mappings in `execute-run.ts` and adjacent execution reporting can collapse useful causes. This slice adds observability for its benign recovery path and bounded smoke diagnostics but does not broaden error refactoring.
- **Runtime-unavailable dispatcher retry noise.** The isolated restart harness deliberately restarted without Paseo and exposed rapid repeated `run.runtime.unavailable` warnings for unrelated queued Runs before the expired Team lease was recovered. It did not affect either recovery invariant, but retry pacing for an unavailable runtime is deferred.

## Completion checklist

- [x] Implementation and design authority agree; no partial hardening subset is claimed complete.
- [x] Required real evidence and supporting checks are recorded with exact outcomes.
- [x] No secret, raw provider error, prompt, local path, generated proof, or debug output is committed.
- [x] Full diff contains only intended Iteration 2 files and this plan is archived completed.
- [x] Local commits exist only on `agent/team-ergonomics`; nothing is pushed and no PR is opened.

## Cleanup state

Ignored `.local` smoke/crash evidence remains available for Manager audit and is not staged. Unrelated untracked `src/adapters/in-memory/in-memory-runtime-adapter.ts` remains preserved and excluded.
