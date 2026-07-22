---
status: completed
owner: gpt-5.4
created_at: 2026-07-22
updated_at: 2026-07-22
authority: execution-plan
---

# Phase 2A Authenticated Admission Foundation

## Outcome

Require authenticated service-account access for the Run compatibility API, persist canonical tenant/workspace/principal/policy snapshot facts on root Task admission, and scope idempotency plus Run reads by that authoritative access context.

## Context and authority

- Authority order: explicit user direction and accepted ADRs, then Product/Feature/Component/Contract docs, then this Active Exec Plan, then current code/tests.
- Accepted design spec: `docs/exec-plans/active/2026-07-22-phase-2a-authenticated-admission-foundation-spec.md`.
- Detailed implementation plan: `docs/exec-plans/active/2026-07-22-phase-2a-authenticated-admission-foundation-plan.md`.
- ADR: `docs/decisions/0004-authenticated-service-account-admission.md`.
- Repo boundaries that must remain true: Task remains canonical; Run stays the compatibility HTTP representation; callers cannot supply authoritative tenant or effective principal; prompts/tokens/raw provider errors/local paths must not leak through normal responses or logs.
- User explicitly chose to jump to a narrow Phase 2 slice rather than finishing Durable Kernel B first, and requested autonomous completion.

## Human Gate record

- Observed facts: the current `/api/v1/runs` API is anonymous, Task admission hardcodes `tenant_local`, and GET reads do not enforce tenant/workspace scope.
- Decision required: begin the first tenant/identity/public-API boundary change now using authenticated service-account admission.
- Viable options considered: finish Durable Kernel B first; do user OIDC first; do service-account admission first.
- Recommendation: service-account admission first because it is the smallest real enforcement slice.
- Explicit human decision: proceed with this Phase 2A direction and complete docs + code autonomously.
- Safe paused state if blocked: keep the current anonymous compatibility API unchanged and record blockers in this plan.

## Scope

- Require bearer-token service-account authentication on `POST /api/v1/runs` and `GET /api/v1/runs/{id}`.
- Resolve canonical tenant/workspace/principal/policy scope from config-backed service-account bindings.
- Persist tenant/workspace/principal/policy snapshot facts on root Tasks and admission records.
- Scope idempotency to `(ingress, tenant_id, workspace_id, principal_type, principal_id, idempotency_key)` and not to policy version.
- Scope Run reads to exact owner scope `(tenantId, workspaceId, principalType, principalId)` without leaking cross-scope existence.
- Update public/docs truth where the authenticated baseline changes it.

## Non-goals

- End-user OIDC, canonical human users, Lark identity, or SCIM/SAML.
- Credential broker, tool gateway, approvals, capability tokens, or execution-cell isolation.
- Public Task routes, Team/child-task work, or Durable Kernel B recovery/reconcile.
- Claiming customer-data or production-credential readiness.

## Work breakdown

- [x] Verify clean branch/worktree state and take ownership of this Active Exec Plan before code changes.
- [x] Add failing config/unit tests for service-account auth configuration and authenticator behavior.
- [x] Implement config-backed service-account authentication and request context propagation.
- [x] Add failing admission/integration tests for owner-scoped Task/admission persistence and scoped idempotency behavior.
- [x] Implement root Task/admission scope persistence plus PostgreSQL migration/repository changes.
- [x] Add failing contract/e2e/integration tests for authenticated create/get, generic `401`, and owner-scope `404` behavior.
- [x] Implement scoped create/get authorization without leaking tokens or cross-scope existence.
- [x] Update docs truth for README, Features, contracts, security, and decisions.
- [x] Run focused loops first, then the deterministic gate.
- [x] Reconcile risks, doc impact, and any deferred work before completion.

## Verification

- [x] `pnpm vitest run src/shared/config.test.ts --config vitest.unit.config.ts`
- [x] `pnpm vitest run src/application/control-plane/service-account-authenticator.test.ts --config vitest.unit.config.ts`
- [x] `pnpm check:types`
- [x] `pnpm vitest run src/domain/tasks/task.test.ts --config vitest.unit.config.ts`
- [x] `pnpm vitest run src/application/tasks/admit-root-task.test.ts --config vitest.unit.config.ts`
- [x] `pnpm vitest run tests/contract/runs.contract.test.ts --config vitest.contract.config.ts`
- [x] `pnpm vitest run tests/integration/durable-kernel-postgres.integration.test.ts --config vitest.integration.config.ts`
- [x] `pnpm vitest run e2e/run.e2e.test.ts --config vitest.e2e.config.ts`
- [x] `make test-unit`
- [x] `make test-contract`
- [x] `make test-integration`
- [x] `make e2e-smoke`
- [x] `make ci`

## Documentation impact

- [x] Product/Feature: README and Features reflect authenticated Run API baseline and remaining Phase 2 gaps.
- [x] Component/Contract: Control Plane, security, and Run API docs reflect canonical service-account admission and owner-scoped reads.
- [x] ADR/Human Gate: ADR 0004 remains the anchor and this plan now matches the implemented documentation truth.

## Decisions and discoveries

- The current Task domain already has `tenantId` but hardcodes `tenant_local`; Phase 2A should replace that at admission rather than layering parallel security context elsewhere.
- The prompt snapshot remains prompt-only; identity scope should be persisted as first-class Task/admission columns, not hidden inside prompt snapshot payloads.
- Read authorization should prefer scope-aware lookups that return null on mismatch so the API does not confirm guessed run identifiers.
- Static config-backed service-account bindings are acceptable for this slice because they provide real enforcement without pretending that full credential brokerage, audit systems, or token lifecycle tooling exists.
- Phase 2A read authorization is owner-only, not workspace-shared; widening reads can wait for a later workspace ACL phase.
- `policySnapshotVersion` is persisted for history and later policy evolution only; it must never affect read authorization or idempotency matching in this slice.
- Task 1 intentionally stops at config/authentication seam creation: request context typing, generic `401` helper/middleware, and service-account config parsing landed without changing Task admission persistence or owner-scoped run behavior.
- Task 2 keeps the current Run submission path behavior intact by having `SubmitRun` supply a temporary compatibility access context until Task 3 switches the route to authenticated caller-derived scope.
- Task 3 keeps the existing global `RunRepository.findById(...)` path for internal recovery/dispatch work and adds a separate owner-scoped read seam for authenticated HTTP reads so cross-scope existence still collapses to `404 run_not_found`.
- Oracle Task 3 follow-up: `src/infrastructure/memory/in-memory-run-repository.ts` cannot safely emulate owner-scoped reads because stored in-memory runs do not retain authoritative owner scope, so `findByIdForOwner(...)` now fails explicitly instead of silently performing a global lookup.
- Worktree was not clean at start: `docs/decisions.md` was modified and the new Phase 2A ADR/plan/spec files were already present as untracked files before Task 1 code edits.
- Task 4 documentation truth is intentionally narrow: README, Features, Run API, Control Plane, and Tenancy/Security now describe authenticated service-account ingress and owner-scoped reads without implying that OIDC, shared ACLs, credential brokerage, approvals, or execution isolation are done.
- `pnpm check:exec-plans` also required status frontmatter on the adjacent Phase 2A implementation-plan and spec files; adding that metadata was a docs-only consistency fix, not a code or scope change.

## Risks and recovery

- Largest scope risk: accidentally expanding into OIDC, credential broker, approvals, or execution isolation.
- Largest contract risk: changing the public Run response shape or leaking more than `401`/`404` behavior requires.
- Largest data risk: migration/repository changes might accidentally keep global idempotency uniqueness or break replay semantics.
- Local verification ran under Node `v26.0.0` while the repo engine declares `>=22 <25`; all deterministic checks still passed, but that environmental warning remains recorded.
- Recovery point: branch `agent/harness-baseline` remains the last pre-durable checkpoint; this worktree branch isolates all new changes.

## Validation evidence

- 2026-07-22 RED: `pnpm vitest run src/shared/config.test.ts --config vitest.unit.config.ts` failed with 3 assertions because `serviceAccounts` config parsing was not implemented yet.
- 2026-07-22 RED: `pnpm vitest run src/application/control-plane/service-account-authenticator.test.ts --config vitest.unit.config.ts` failed because `src/entrypoints/api/authentication.ts` did not exist yet.
- 2026-07-22 GREEN: `pnpm vitest run src/shared/config.test.ts --config vitest.unit.config.ts` passed (6 tests).
- 2026-07-22 GREEN: `pnpm vitest run src/application/control-plane/service-account-authenticator.test.ts --config vitest.unit.config.ts` passed (3 tests).
- 2026-07-22 RED: `pnpm vitest run src/shared/config.test.ts --config vitest.unit.config.ts` failed with 2 assertions because duplicate token validation and conflicting duplicate `serviceAccountId` owner-scope validation were not enforced yet.
- 2026-07-22 RED: `pnpm check:types` failed because `parseBearerToken(...)` still indexed `match[1]` without proving the capture group existed to TypeScript.
- 2026-07-22 GREEN: `pnpm vitest run src/shared/config.test.ts --config vitest.unit.config.ts` passed (8 tests) after adding duplicate token and conflicting duplicate `serviceAccountId` owner-scope validation.
- 2026-07-22 GREEN: `pnpm vitest run src/application/control-plane/service-account-authenticator.test.ts --config vitest.unit.config.ts` still passed (3 tests), confirming generic public unauthorized behavior stayed unchanged.
- 2026-07-22 GREEN: `pnpm check:types` passed after rewriting `parseBearerToken(...)` to narrow the bearer capture before trimming/returning it.
- 2026-07-22 RED: `pnpm vitest run src/domain/tasks/task.test.ts --config vitest.unit.config.ts` failed because root Tasks still hardcoded `tenant_local` and did not validate/persist authoritative scope fields.
- 2026-07-22 RED: `pnpm vitest run src/application/tasks/admit-root-task.test.ts --config vitest.unit.config.ts` failed because `AdmitRootTask` did not carry `AccessContext` into Task/admission persistence or scope idempotency lookups.
- 2026-07-22 RED: `pnpm vitest run tests/integration/durable-kernel-postgres.integration.test.ts --config vitest.integration.config.ts` failed because migration/repository support for persisted owner-scope columns and scoped uniqueness did not exist yet.
- 2026-07-22 GREEN: `pnpm vitest run src/domain/tasks/task.test.ts --config vitest.unit.config.ts` passed (6 tests) after requiring authoritative root Task scope fields.
- 2026-07-22 GREEN: `pnpm vitest run src/application/tasks/admit-root-task.test.ts --config vitest.unit.config.ts` passed (4 tests) after persisting `AccessContext` on Tasks/admissions and replaying only within owner scope.
- 2026-07-22 GREEN: `pnpm vitest run tests/integration/durable-kernel-postgres.integration.test.ts --config vitest.integration.config.ts` passed (11 tests) after landing migration `0002` plus scoped admission repository behavior.
- 2026-07-22 GREEN: `pnpm check:types` passed after adding authoritative Task/admission scope fields and a temporary compatibility submission context.
- 2026-07-22 RED: `pnpm vitest run tests/contract/runs.contract.test.ts --config vitest.contract.config.ts` failed with 5 assertions because `/api/v1/runs` was still anonymous and GET still used a global run lookup.
- 2026-07-22 RED: `pnpm vitest run e2e/run.e2e.test.ts --config vitest.e2e.config.ts` failed because unauthenticated POST still returned `202` instead of the generic bearer `401`.
- 2026-07-22 GREEN: `pnpm vitest run tests/contract/runs.contract.test.ts --config vitest.contract.config.ts` passed (15 tests) after requiring bearer auth on POST/GET and enforcing owner-scoped run reads.
- 2026-07-22 GREEN: `pnpm vitest run e2e/run.e2e.test.ts --config vitest.e2e.config.ts` passed (1 test) after the real-socket path required bearer auth and rejected non-owner reads with `404 run_not_found`.
- 2026-07-22 GREEN: `pnpm check:types` passed after threading authenticated access context through Run submit/get flows and adding an owner-scoped repository read seam.
- 2026-07-22 GREEN: `pnpm vitest run tests/contract/runs.contract.test.ts --config vitest.contract.config.ts` still passed (15 tests) after the Oracle Task 3 follow-up changed the in-memory repository to reject unsupported owner-scoped fallback reads explicitly.
- 2026-07-22 GREEN: `pnpm vitest run e2e/run.e2e.test.ts --config vitest.e2e.config.ts` still passed (1 test) after the Oracle Task 3 follow-up, confirming authenticated create/get behavior stayed intact.
- 2026-07-22 GREEN: `pnpm check:types` still passed after the Oracle Task 3 follow-up.
- 2026-07-22 GREEN: `pnpm check:docs` passed after syncing README, Features, Run API, Control Plane, and Tenancy/Security docs to the authenticated service-account baseline.
- 2026-07-22 GREEN: `pnpm check:exec-plans` passed after updating this Active Exec Plan and adding required status metadata to the adjacent Phase 2A plan/spec files.
- 2026-07-22 GREEN: `make test-unit` passed (`13` files / `40` tests) with only the existing Node engine warning.
- 2026-07-22 GREEN: `make test-contract` passed (`2` files / `18` tests) with only the existing Node engine warning.
- 2026-07-22 GREEN: `make test-integration` passed (`2` files / `15` tests) with only the existing Node engine warning.
- 2026-07-22 GREEN: `make e2e-smoke` passed (`1` file / `1` test) with only the existing Node engine warning.
- 2026-07-22 GREEN: `make ci` passed after a first RED formatting failure; rerunning after `pnpm exec prettier --write ...` succeeded, and the remaining output contained only the existing Node engine warning.
- 2026-07-22 GREEN: `make check` passed from the completed-plan path; typecheck, formatting, docs, and exec-plan validation all succeeded with only the existing Node engine warning.

## Completion checklist

- Accepted scope is implemented and non-goals remain true.
- Feature/Component/Contract/ADR docs reflect the implemented baseline truth.
- Focused RED/GREEN evidence is recorded for each task.
- Full deterministic verification ran and results are recorded exactly.
- No prompt/token/raw provider error/local path leakage or debug residue remains.
- Work breakdown, verification, documentation impact, and evidence sections are fully updated.
- Final archive bookkeeping completed successfully, including the `make check` rerun from the completed-plan path.

## Current blocker

- None.

## Next exact command

- None. Phase 2A is complete in the local worktree.

## Cleanup state

- No intentional background process or temporary artifact exists for this docs-sync follow-up.
