---
status: completed
owner: orchestrator
created_at: 2026-07-25
updated_at: 2026-07-25
authority: execution-plan
---

# Product-stage real-E2E delivery policy

## Outcome

Repository documentation now records the approved current product implementation-stage delivery policy: the smallest complete user-visible/main-flow real E2E is the primary acceptance target, while non-blocking hardening and new test authoring remain deferred unless explicitly requested.

## Scope

- [x] Updated repository instructions, contribution guidance, PR template, agent handbook, lifecycle, verification, Exec Plan protocol, and release gates.
- [x] Updated the active Lark direct-Accept plan so real main-flow evidence is primary and deterministic E2E authoring is not promised by default.
- [x] Preserved security, tenant, credential, public API, migration, durable-state, and core-dependency Human Gates.
- [x] Added no code or tests and rewrote no historical completed plan or evidence.
- [x] Removed remaining default full-gate and mandatory-new-test wording; documentation-only E2E applicability is explicitly supported.

## Verification

- [x] Follow-up `pnpm check:format` passed under Node 24.
- [x] Follow-up `pnpm check:docs` passed under Node 24.
- [x] Follow-up `pnpm check:exec-plans` passed under Node 24.
- [x] Follow-up `git diff --check` passed.

## Decisions and deferred work

The user explicitly requested documentation-only policy synchronization. Existing CI remains allowed and must be reported truthfully, but no tests were run or authored for this documentation change. Deterministic E2E, eval datasets, fixtures, and other hardening remain deferred unless explicitly requested.

## Cleanup state

Completed. No code, tests, generated evidence, or commits were changed by this plan.
