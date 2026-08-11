# HG-2 migration evidence runbook

This is a small operator evidence command for the real PostgreSQL database. It
does not apply migrations, start a provider, call MCP, create fixtures, or print
the connection string. The command reads migration registry state, owner column
types, constraint/index names and definitions, the `trigger_kind` check,
backfill source preflight, product identity counts, expired pending rows, and
the SHA-256 of migration `0029_product_work_identity.sql`.

Run it with either supported connection variable (never paste a credential into
the command or evidence output):

```sh
DATABASE_URL="$DATABASE_URL" node scripts/migrations/hg2-migration-evidence.mjs
POSTGRES_URL="$POSTGRES_URL" node scripts/migrations/hg2-migration-evidence.mjs --format=ndjson
```

The default output is one JSON object. `--format=ndjson` (or `--ndjson`) emits
one JSON record per top-level section. A failed connection or query emits only a
safe error on stderr; driver details and credentials are intentionally omitted.

## Real provider HTTP/MCP acceptance placeholders

The following are command shapes only. An operator must substitute IDs from a
real provider-backed run; this document does not claim that these commands have
been executed. Keep the resulting `RUN_ID`, `WORK_ID`, and `WORK_RUN_ID` in the
evidence packet without adding prompts, tokens, or provider credentials.

```sh
BASE_URL=http://127.0.0.1:3000
RUN_ID=<real-technical-run-id>
WORK_ID=<real-product-work-id>
WORK_RUN_ID=<real-product-work-run-id>

# HTTP: inspect the owner-scoped technical run and start the product WorkRun.
curl -sS "$BASE_URL/api/v1/runs/$RUN_ID" \
  -H 'authorization: Bearer <operator-supplied-token>'
curl -sS -X POST "$BASE_URL/api/v1/works/$WORK_ID/runs" \
  -H 'authorization: Bearer <operator-supplied-token>' \
  -H 'content-type: application/json' \
  -d '{"trigger_kind":"manual","trigger_ref":"<real-trigger-ref>"}'

# MCP: invoke product_work_run_start in the real provider MCP session, then
# compare its returned WORK_RUN_ID with the PostgreSQL evidence counts.
MCP_SESSION=<real-provider-mcp-session>
mcp-client call product_work_run_start \
  --session "$MCP_SESSION" \
  --json '{"work_id":"<real-product-work-id>","trigger_kind":"manual","trigger_ref":"<real-trigger-ref>"}'
```

## Artifact-freeze grep

Run this repository check alongside the packet and record its output or a
truthful `not_run` result; no execution is claimed here:

```sh
rg -n \
  'production_receipt_id, artifact_id|work_runs\.id|摘要.*Artifact|种类.*生产凭据' \
  docs/contracts/product-work-identity.md
```

Expected: the frozen contract states the future unique key
`(production_receipt_id, artifact_id)`, the future FK target `work_runs.id`, and
that Artifact computes digest/kind rather than accepting them in the receipt.

## Backfill replay evidence

Run these against the same migrated real PostgreSQL database and preserve each
complete JSON line and exit code. The second write must report
`inserted=0 conflicts=0`; a non-zero conflict count is a failure, not a warning.

```sh
node scripts/migrations/backfill-product-work-identity.mjs --dry-run
node scripts/migrations/backfill-product-work-identity.mjs --batch-size 100
node scripts/migrations/backfill-product-work-identity.mjs --batch-size 100
node scripts/migrations/hg2-migration-evidence.mjs --ndjson
```

## Idempotency and binding SQL

After the real provider-backed HTTP calls have produced `WORK_ID`,
`WORK_RUN_ID`, `TRIGGER_REF`, and the technical receipt in `source_refs`, run
the following through `psql "$DATABASE_URL" -v ON_ERROR_STOP=1`. These are
queries only; do not replace the IDs with hand-written database rows.

```sql
SELECT id, work_id, trigger_kind, trigger_ref, root_task_id, bound_at
FROM work_runs
WHERE tenant_id = :'tenant_id'
  AND workspace_id = :'workspace_id'::uuid
  AND work_id = :'work_id'::uuid
ORDER BY created_at, id;

SELECT trigger_ref, count(*) AS rows, count(DISTINCT id) AS distinct_ids
FROM work_runs
WHERE tenant_id = :'tenant_id'
  AND workspace_id = :'workspace_id'::uuid
  AND work_id = :'work_id'::uuid
  AND trigger_ref = :'trigger_ref'
GROUP BY trigger_ref;

SELECT root_task_id, count(*)
FROM work_runs
WHERE root_task_id IS NOT NULL
GROUP BY root_task_id
HAVING count(*) <> 1;

SELECT count(*) AS expired_pending_visible_candidates
FROM work_runs
WHERE root_task_id IS NULL AND expires_at <= now();
```

For the two-call idempotency criterion, preserve both HTTP/MCP responses and
assert in the evidence recorder that their product `work_run.id` values are
byte-for-byte equal. For the one-Work/two-Runs criterion, repeat with two
different `trigger_ref` values and assert the query returns two distinct IDs
under one `work_id`.
