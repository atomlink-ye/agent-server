# Lark Managed Memory command canary runbook

This runbook operates the fixed Lark compatibility canary only. It is not a production deployment, identity, or recovery contract.

## Boundary and safety

- Use only the configured App/chat/user/service-account ownership tuple.
- Keep `LARK_CANARY_ENABLED` false unless deliberately running the canary.
- Provide required `LARK_CANARY_*` values and App credentials through the caller's secret manager/environment; never place secrets in commands, logs, or repository files.
- Agent Server must be the sole App WebSocket consumer for the canary.
- Thread command, Card, and Bot-owned Doc controls all operate through the canonical review state; raw callback/action tokens and comments are not retained as ordinary evidence.

## Deterministic prerequisites

Use the repository's pnpm command surface:

```bash
pnpm check
pnpm test:real-pg
pnpm eval:memory
```

Use `pnpm smoke:runtime` only when the real Paseo/provider boundary is intentionally part of the canary verification. External provider availability is not a deterministic prerequisite.

A real PostgreSQL test lane can self-start a disposable database. For a manually operated canary, the application database remains an explicit operator-owned environment and must not be encoded as a developer-specific port in documentation.

## Execution and shutdown

Start exactly one Lark worker with `pnpm dev:lark` (or the production `start:lark` entrypoint for a built image). Send a unique root and follow-up interaction through the configured canary surface. Confirm the canonical proposal/review, accepted Memory materialization, ready snapshot, and Fresh Session pin through owner-safe application/database state.

Stop gracefully and allow the worker/outbox loop to close. Do not use a competing consumer, blind resend, or broad process kill. If a provider send becomes ambiguous outside the safe replay window, preserve the durable unknown-delivery state rather than automatically resending.

## Diagnostic handling

Record only sanitized correlation/status information required to diagnose the canary. Do not commit credentials, bearer tokens, App Secrets, raw events, raw comments/replies, callback/action tokens, raw provider errors, prompts, local filesystem paths, screenshots, logs, or one-run evidence packets.

Generated diagnostics belong under ignored `.local/test-runs/<run-id>/` or a CI artifact when useful.

## Deferred boundaries

Multi-node leadership/fencing, crash recovery, generalized redrive/fault injection, performance/load work, broader identity/authorization, and production rollout remain deferred. Track such work in the current project/issue/roadmap context rather than by committing a task-specific follow-up plan to the repository.
