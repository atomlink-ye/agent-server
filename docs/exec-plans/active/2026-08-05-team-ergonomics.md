---
status: active
owner: agent/team-ergonomics
created_at: 2026-08-05
updated_at: 2026-08-05
authority: execution-plan
---

# Outcome

Complete the isolated Phase B prerequisite: non-empty declared Team rosters and one enforced Team-limit policy source, preserving the existing two-member real flow.

## Context and authority

The Manager's 2026-08-05 brief authorizes the forward-only `0027` constraint migration, roster relaxation, and shared Team limits. A later correction explicitly withdraws the inline-member Phase A design and requires work to stop after the Phase B gate.

## Scope

- [x] Phase B: accept non-empty rosters at all four enforcement layers and add migration `0027`.
- [x] Phase B: make driver, evaluator, and PostgreSQL query enforcement read one shared limits object; raise `maxLeadTurns` above four.

## Non-goals

- No new test suites, adapters, ports, retry/recovery/concurrency/performance work, generalized orchestration refactors, or changes to the deferred Team state-machine items named by the Manager.
- No inline Team construction or Phase A work. AgentProject remains the authoritative declared boundary.
- No self-HTTP calls, AgentProject synthesis, direct `team_versions` writes, synchronous terminal wait, PR, or push.

## Work breakdown

- [x] Complete explorer path map before code changes.
- [x] Implement and review Phase B.
- [x] Pass Phase B gate and report it before Phase A.
- [ ] Run later replacement-scope checks and review the final diff.

## Verification

- [x] `scripts/smoke/agent-teams-v2-main-flow.mjs` unchanged, two members, exits zero.
- [x] `make check` exits zero at the Phase B gate.

## Documentation impact

- [ ] Product/Feature status remains truthful for the bounded additive ergonomics slice.
- [ ] Component/Contract describe the additive route and non-empty roster boundary.
- [ ] ADR/Runbook impact is recorded or explicitly not applicable.

## Decisions and discoveries

- Stage is `prove`; the Manager's detailed brief is the approved design and explicit Human Gate authority for the public contract and durable migration.
- The earlier inline-member Phase A design is withdrawn; no Phase A code will be started before replacement scope arrives.
- Non-blocking findings go to the deferred ledger rather than expanding scope.
- `maxLeadTurns` is 8: still bounded, with room for a three-member declaration's separate create/review cycles while `maxWorkItems` remains 4.
- Deferred hardening: for a large production `team_versions` table, consider `NOT VALID` plus later validation to reduce migration lock impact; this is not needed for the local MVE gate.

## Risks and recovery

`0027` is forward-only and was reviewed before real database execution. Recovery is branch-local revert of this worktree's changes; the migration ran only against the smoke's disposable local database.

## Validation evidence

- `2026-08-05`: fixer ran `pnpm check:types`, the existing focused TeamVersion test (2 passed), durable-kernel plus agent-registry integration tests (67 passed, 12 skipped), and targeted Prettier checks.
- `2026-08-05`: Oracle reviewed the Phase B diff before real database execution. One unrelated migration tightening was corrected and re-reviewed; final recommendation was GO with no blockers.
- `2026-08-05`: `PASEO_MODEL=opencode-go/glm-5.2 make agent-teams-v2-smoke` ran the unchanged two-member script against real PostgreSQL/model and exited 0 with `RESULT_PASS`; durable cardinality was Lead plus two roster members, two Work items, two attempts, three TeamMessages, one direct message, four Lead turns, and terminal completion.
- `2026-08-05`: `make check` ran in the Node 24.18.0 Docker image and exited 0: types, formatting, docs, and Exec Plan checks passed.

## Completion checklist

- [ ] All scoped behavior and documentation agree.
- [ ] Required real flow and supporting checks are recorded truthfully.
- [ ] No secret, generated evidence, debug output, or out-of-scope edit remains.
- [ ] Plan is complete and archived.

## Current blocker

Phase A replacement scope has not yet been supplied; work is intentionally stopped at the Phase B gate.

## Next exact command

Wait for the Manager's replacement Phase A scope. Do not implement the withdrawn inline-member API design.

## Cleanup state

Branch-local worktree contains only Phase B and this active plan. The smoke used disposable local PostgreSQL/runtime state through the repository wrapper; verify wrapper cleanup before resuming.
