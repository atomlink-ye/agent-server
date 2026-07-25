---
status: completed
owner: orchestrator
created_at: 2026-07-25
updated_at: 2026-07-25
authority: execution-plan
---

# Lark Thread Agent Continuity

## Outcome

Preserve the fixed Lark thread binding so replies resolve the same root binding
and Product Session, while successive Agent Runs in that Product Session reuse
one idle Paseo provider Agent.

## Scope

- Replies in one Lark thread resolve the existing root binding and Product
  Session.
- Unrelated roots/threads in the same chat do not share a Product Session.
- The first Run creates a provider Agent and persists its ID.
- Later Runs query the Product Session's latest provider binding and use
  `sendAgentMessage` followed by `waitForFinish`.
- Send/wait failures fail closed; no replacement Agent is created.
- Runtime evidence uses the `agent-test` profile and free
  `opencode/deepseek-v4-flash-free`.

## Ordering and gates

The real E2E gate ran first. Existing deterministic continuation coverage and
the complete repository gates then passed.

## Non-goals

- Proposal, Card, Doc, or publication behavior.
- Provider replacement/recovery, Task 14 hardening, or multi-node fencing.

## Verification

- [x] Real E2E used `agent-test` and
      `opencode/deepseek-v4-flash-free`. Two messages in thread
      `omt_19014ee5120f1be8` resolved Product Session
      `702aa279-0ade-419e-abc4-4b5b382c3542` and provider Agent
      `6de168dc-2506-491a-8951-d1cf35c8ce3f`; both Bot replies were delivered.
- [x] Existing continuation tests and deterministic integration evidence pass.
- [x] Node 24 `make ci` passed with 371 unit, 71 contract, 143 integration plus
      36 skipped, and 7 E2E tests.
- [x] Fresh real-PostgreSQL verification passed 6 files and 74 tests.
- [x] Typecheck, build, documentation, format, Exec Plan, and diff checks pass.

## Completion

The same-thread Product Session and provider-Agent continuity outcome is
complete. Unrelated Memory direct-Accept hardening remains owned by its separate
active plan.
