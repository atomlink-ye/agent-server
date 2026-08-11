# S6 state-honesty evidence

Recorded on 2026-08-11. This packet does not treat a successful technical Run
as proof of canonical submit. Submit is inferred only by the post-OI-19 durable
write invariant documented below.

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

Pending the final real-Run marker. The marker must contain the positive
`team_run_id`, all three DB/API-equal gates, a positive `run_events_count`, the
derived canonical-submit predicate above, and a separate normal Run with
`stuck=false`.
