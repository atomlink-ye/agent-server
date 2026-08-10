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
rg -n -i 'artifact.*freeze|freeze.*artifact' docs src scripts
```
