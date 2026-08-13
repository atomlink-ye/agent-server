# S6 state-honesty evidence

Recorded on 2026-08-11. This packet does not treat a successful technical Run
as proof of canonical submit. Submit is inferred only by the post-OI-19 durable
write invariant documented below.

The sandbox-local database rows needed to preserve the OI-24/OI-25 scene are
archived in `2026-08-11-s6-db-state-snapshots.json`. That snapshot is
metadata-only: it records state, IDs, timestamps, boolean summary presence, and
`run_events` counts, while excluding summary content, transcripts, credentials,
and all event payloads.

## Canonical-submit discriminator

The canary uses this SQL predicate for a Work attempt:

```sql
CASE WHEN attempt.status = 'completed'
       AND technical_run.status = 'succeeded'
       AND length(trim(coalesce(attempt.result_summary, ''))) > 0
     THEN true ELSE false
END AS canonical_submit_committed
```

This is a derived receipt, not a first-class submit record. It is accepted here
because the production write surface for `result_summary` is currently unique.
The following read-only search was run from repository HEAD:

```sh
rg -n "result_summary\\s*=|result_summary\\)|result_summary," src --glob '*.ts'
rg -n "updateAttemptStatus\\(|submitCurrentAttempt\\(" src --glob '*.ts'
```

Actual relevant output:

```text
src/infrastructure/postgres/postgres-collaborative-team-repository.ts:506:              SET status='failed', result_summary=NULL,
src/infrastructure/postgres/postgres-collaborative-team-repository.ts:696:              SET status='failed', result_summary=NULL, completed_at=$2, updated_at=$2
src/infrastructure/postgres/postgres-collaborative-team-repository.ts:1034:          SET status=$2,result_summary=$3,
src/infrastructure/postgres/postgres-collaborative-team-repository.ts:1099:        `UPDATE team_work_item_attempts SET status='completed', result_summary=$2, completed_at=now(), updated_at=now() WHERE id=$1 AND status='running' RETURNING *`,
src/application/ports/team-execution-repository.ts:136:  updateAttemptStatus(
src/application/ports/team-execution-repository.ts:142:  submitCurrentAttempt(input: {
src/application/teams/team-driver.ts:313:        await this.executions.updateAttemptStatus(
src/application/teams/team-command-service.ts:255:    const result = await this.repo.submitCurrentAttempt({
src/infrastructure/postgres/postgres-collaborative-team-repository.ts:1026:  public async updateAttemptStatus(
src/infrastructure/postgres/postgres-collaborative-team-repository.ts:1044:  public async submitCurrentAttempt(input: {
```

Inspection of those callers shows:

- `TeamCommandService.submit -> submitCurrentAttempt` is the only production
  path that writes `status='completed'` with the submitted non-empty summary.
- The generic `updateAttemptStatus` method can technically accept a summary,
  but its sole production caller is `team-driver.ts`; that caller always passes
  `status='failed'` and `null`.
- Both terminal failure updates write `status='failed', result_summary=NULL`.

Therefore the predicate distinguishes canonical submit from the OI-19
`succeeded_without_submit` state under the current post-fix write invariant.

## Negative branch and historical limit

The negative branch is grounded in the real-PostgreSQL integration test
`lets the succeeded-without-submit failure win without deadlock`, introduced by
commit `dba5245` and fixture-linked by `4c15e23`. The test races canonical submit
against OI-19 failure on two real PostgreSQL connections and observes
`attempt_status='failed'` and `stop_reason='succeeded_without_submit'`.
The winning failure SQL at the tested write point sets
`result_summary=NULL`. The test did **not** select `result_summary` in its final
assertion, so NULL is a code-path fact for that concrete race, not a separately
printed test observation.

The current acceptance database does not simultaneously retain a positive row
and a `succeeded_without_submit` negative row. No new negative Run was created
for this acceptance.

This inference is valid only for data produced after the OI-19 fix. Before that
fix, an attempt that succeeded technically without canonical submit was not
guaranteed to be rewritten to `failed/NULL`; historical data spanning the fix
boundary must not be classified with this predicate.

## State-honesty canary

### Contract and focused verification

Commit `3a54428` exposes `stuck: boolean`. The response schema pins its exact
definition as:

```text
team.status='active' && no_active_attempts && all_members_idle && !all_work_accepted
```

The three focused files pass without file parallelism:

```text
Test Files  3 passed (3)
Tests       7 passed (7)
```

`team-runs-schema.test.ts` proves both decision-capture variants remain
structurally distinct:

- `reported` carries `decisions=[]`, explicitly reporting that none exist.
- `not_captured` has no `decisions` property, reporting capability absence
  rather than a seemingly real empty result.

The real API sample below also returned `not_captured` with
`decisions_present=false`.

The interface-surface count was machine-produced over
`src/contracts/teams.ts`, `src/application/teams/project-agentic-team.ts`, and
`src/entrypoints/api/routes/team-runs.ts`:

```text
human_input_requested=0
clarification=0
```

### Real negative sample

The read-only smoke script compares each ordered gate field from PostgreSQL to
the API projection; equality is not inferred from a count or aggregate. It
produced:

```json
{
  "marker": "S6_STATE_HONESTY_NEGATIVE_PASS",
  "team_run_id": "9ccbce64-ed68-4e2f-9127-9734fe2b3f3a",
  "db_gates": {
    "no_active_attempts": true,
    "all_members_idle": true,
    "all_work_accepted": true
  },
  "api_gates": {
    "no_active_attempts": true,
    "all_members_idle": true,
    "all_work_accepted": true
  },
  "stuck": false,
  "team_status": "succeeded",
  "stop_reason": null,
  "decision_capture_status": "not_captured",
  "decisions_present": false
}
```

The smoke exited with `S6_NEGATIVE_SMOKE_RC=0`.

### Positive sample blocked by OI-25 (not omitted)

The required positive shape is a real Team that remains active after canonical
submit, with no active attempts, all members idle, and submitted Work not yet
accepted. It is unreachable in the current product. This is recorded as
OI-25; the sample is **blocked by a product defect, not left unimplemented**.

Two candidate paths were verified and rejected without weakening the gates:

1. **Lead declines to accept.** Once submitted Work wakes the Lead, the policy
   still exposes an accept/rework action. A successful Lead turn that makes no
   qualifying control mutation reaches the `lead_no_progress` terminal path.
   A real attempt at this shape ended as `failed/done/terminal` with
   `stop_reason=lead_no_progress`; it did not remain active.
2. **Completion approval wait.** A pending completion request correctly returns
   before the no-progress guard and freezes wake reconciliation. However,
   `requestCompletion` rejects while any Work is neither `accepted` nor
   `cancelled`, and the policy exposes `team_finish` only after all Work is
   accepted/cancelled. Therefore submitted-but-unaccepted completed Work cannot
   enter approval pending. `submit -> cancel -> finish` was explicitly rejected
   as a different state, because the Work would be `cancelled`.

The code basis is:

- `src/application/teams/team-driver.ts:327-338`: pending approval returns
  before the Lead no-progress guard; without a completion request the guard is
  active.
- `src/application/teams/team-policy-evaluator.ts:57-66,102-107,131-135`:
  defines pending as a current request with no matching decision, suppresses
  commands while pending, and exposes finish only for accepted/cancelled Work.
- `src/application/teams/team-wake-reconciler.ts:66-78`: pending approval
  freezes wake materialization.
- `src/infrastructure/postgres/postgres-collaborative-team-repository.ts:1771-1784`:
  completion is an invalid transition while unfinished Work exists.
- `src/application/teams/project-agentic-team.ts:216-234`: computes `stuck`
  from raw active status and the three gates, independently of approval wait,
  while projecting the public status as `waiting`.

Existing focused tests corroborate the first half of the approval behavior:
`team-driver.completion-decision.approval.test.ts:278-295` proves no extra Lead
is scheduled while pending, and
`team-wake-reconciler.approval.test.ts:214-224` proves queued direct/work
materialization is frozen.

### Definition false-positive observation

The frozen SPEC definition does not exclude a Team intentionally waiting for a
completion decision. The projection calculates `stuck` from the raw active
Team and the three gates, then separately publishes that Team as `waiting` with
`stop_reason=approval_required`. Consequently, a reachable approval-wait shape
with cancelled Work can satisfy `stuck=true` even though it is waiting for a
human decision rather than stuck.

This evidence does not change the contract. OI-25 must address definition and
positive-state reachability together in a later slice; changing only one would
either preserve the false positive or leave the promised state unobservable.
