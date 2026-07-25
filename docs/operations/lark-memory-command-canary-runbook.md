# Lark Managed Memory command canary runbook

This runbook operates the fixed compatibility canary only. It is not a
production deployment, identity, or recovery runbook.

## Boundary and safety

- Use only the configured `agent-test` App, one fixed group, one allowlisted
  external user, and the matching service-account Tenant/Workspace/published
  AgentVersion tuple.
- Keep `LARK_CANARY_ENABLED` false unless deliberately running the canary.
  When enabled, provide the required `LARK_CANARY_*` values through the caller's
  secret manager/environment; never put the App Secret in a command, log, or
  document.
- Agent Server must be the sole App WebSocket consumer. Do not run a competing
  `lark-cli event consume` or a second worker.
- The supported review surfaces are Thread `/memory edit-and-accept` fallback,
  Card controls, and Bot-owned Doc controls. Agent Server creates the editable
  Bot-owned Doc before the initial Card. Open/edit the Doc if desired, then use
  direct `Accept`; the resumed Agent fetches it with `lark-cli docs +fetch
--profile "$LARK_CLI_PROFILE" --as bot --doc <token>`. New Cards do not render
  Edit/Preview controls; legacy actions remain inbound-only.

## Readiness and runtime

Use Node `v24.18.0` and pnpm `11.7.0`:

```bash
export NVM_DIR="/Users/fanye/.nvm"
. "$NVM_DIR/nvm.sh"
nvm use 24
node --version
pnpm --version
```

Verify configuration, Bot/User readiness, fixed ownership tuple, database
reachability, and the selected free OpenCode model without printing credentials.
Run deterministic and boundary gates:

```bash
make ci
DATABASE_URL="$DATABASE_URL" make test-real-pg
make paseo-smoke
make eval-smoke
```

`DATABASE_URL` must be caller-provided; do not encode a developer port. A stale
database that already applied an unreleased/incompatible migration (for example,
an early `0013` without the current mention column) is not acceptance evidence.
Use a fresh caller-provided database and record only the sanitized result.

## Execution and shutdown

Start exactly one Lark worker using the repository's `dev:lark` or `start:lark`
path. Send unique root and second-root messages. For the command fallback, send
the Thread command. For Card/Doc QA, have the user click the Card, edit the Doc
body, add unresolved comment/reply, request Preview, and separately Accept the
persisted Preview. Confirm source Run/proposal, accepted Entry, ready snapshot,
Fresh Session exact pin, and recall through sanitized database/application
evidence.

Stop with a graceful SIGTERM and wait for the worker/outbox loop to close. Do not
use `kill -9`, blind resend, or a second consumer. If provider execution cannot
be reconciled within the safe UUID replay window, preserve `delivery_unknown`
and stop automatic resend.

## Evidence handling

Record only sanitized correlation IDs, safe provider message IDs, snapshot
IDs/hashes, statuses, test commands, and result boundaries. Do not record
credentials, bearer tokens, App Secrets, raw events, raw comments/replies,
callback/action tokens, raw provider errors, prompts, local filesystem paths, or
local smoke evidence paths. The canary proves bounded retry/idempotent
materialization, not physical exactly-once delivery or canonical identity.

Preview successor lease fencing, post-canonical retry/fencing, manual rebuild
races, rolling allocator races, generalized synthesis retry/audit, crash
recovery, multi-node leadership, extra redrive/fault injection, performance, and
production rollout remain deferred to the active Task 14 follow-up plan.
