---
status: active
owner: gpt-5.4
created_at: 2026-07-22
updated_at: 2026-07-22
authority: implementation-plan
---

# Phase 2A Authenticated Admission Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/api/v1/runs` an authenticated service-account API, persist authoritative tenant/workspace/principal/policy snapshot facts on root Task admission, scope idempotency by owner scope, and enforce the same owner scope on Run reads.

**Architecture:** Add a config-backed service-account authenticator at the API ingress, pass a resolved access context into admission/read application services, extend Task/admission persistence with security-scope columns, and use owner-scoped Run reads so cross-tenant/workspace access returns the same not-found shape as absent resources.

**Tech Stack:** TypeScript, Hono, Zod, PostgreSQL/PGlite, Vitest

---

### Task 1: Config-backed service-account authentication seam

**Files:**

- Create: `src/application/control-plane/access-context.ts`
- Create: `src/application/control-plane/service-account-authenticator.ts`
- Create: `src/entrypoints/api/authentication.ts`
- Modify: `src/shared/config.ts`
- Modify: `src/shared/config.test.ts`
- Modify: `src/entrypoints/api/app.ts`
- Modify: `src/entrypoints/api/http-types.ts`

- [x] **Step 1: Write the failing config and authenticator tests**

Add tests that prove:

- valid config can load a service account with tenant/workspace/policy metadata;
- missing token or malformed account config is rejected;
- disabled accounts are not accepted;
- bearer token lookup returns a canonical access context with no caller-supplied tenant override;
- missing/malformed/unknown/disabled tokens all produce the same public unauthorized result shape.

- [x] **Step 2: Run the focused unit test and verify RED**

Run: `pnpm vitest run src/shared/config.test.ts --config vitest.unit.config.ts`

Expected: FAIL because no service-account auth config or authenticator exists yet.

- [x] **Step 3: Implement the minimal config/authentication seam**

Implement:

- a shared `AccessContext` / `ServiceAccountContext` type;
- config parsing for a static list of service accounts;
- a small authenticator that resolves bearer tokens to canonical access context;
- Hono request context variables for authenticated access context;
- generic `401 unauthorized` public behavior with `WWW-Authenticate: Bearer`.

- [x] **Step 4: Re-run the focused unit test and verify GREEN**

Run: `pnpm vitest run src/shared/config.test.ts --config vitest.unit.config.ts`

Expected: PASS.

### Task 2: Persist authoritative admission scope on root Tasks

**Files:**

- Modify: `src/domain/tasks/task.ts`
- Modify: `src/domain/tasks/task.test.ts`
- Modify: `src/application/tasks/admit-root-task.ts`
- Modify: `src/application/tasks/admit-root-task.test.ts`
- Modify: `src/application/tasks/root-task-input.ts`
- Modify: `src/application/ports/admission-repository.ts`
- Modify: `src/application/ports/task-repository.ts`
- Create: `src/infrastructure/postgres/migrations/0002_phase_2a_authenticated_admission.sql`
- Modify: `src/infrastructure/postgres/postgres-task-repository.ts`
- Modify: `src/infrastructure/postgres/postgres-admission-repository.ts`
- Modify: `tests/integration/durable-kernel-postgres.integration.test.ts`

- [x] **Step 1: Write the failing Task/admission tests**

Add tests that prove:

- `createRootTask(...)` requires authoritative `tenantId`, `workspaceId`, `principalType`, `principalId`, and `policySnapshotVersion`;
- admitted Tasks persist those fields;
- idempotency replay works only inside the same owner scope;
- same `Idempotency-Key` used by a different owner scope creates separate admissions;
- `policySnapshotVersion` is stored but does not affect replay matching.

- [x] **Step 2: Run the focused tests and verify RED**

Run:

- `pnpm vitest run src/domain/tasks/task.test.ts --config vitest.unit.config.ts`
- `pnpm vitest run src/application/tasks/admit-root-task.test.ts --config vitest.unit.config.ts`
- `pnpm vitest run tests/integration/durable-kernel-postgres.integration.test.ts --config vitest.integration.config.ts`

Expected: FAIL because Task/admission scope fields and DB support do not exist yet.

- [x] **Step 3: Implement the minimal persistence changes**

Implement:

- Task domain shape changes for workspace/principal/policy snapshot facts;
- admission request type changes to require `AccessContext`;
- migration and repository support for new columns;
- scoped uniqueness on `(ingress, tenant_id, workspace_id, principal_type, principal_id, idempotency_key)`;
- repository save/find methods that preserve current compatibility behavior while using the new authoritative owner scope.

- [x] **Step 4: Re-run the focused tests and verify GREEN**

Run the three commands above again.

Expected: PASS.

### Task 3: Authenticated create/get and owner-scoped Run reads

**Files:**

- Modify: `src/application/runs/submit-run.ts`
- Modify: `src/application/runs/get-run.ts`
- Modify: `src/application/ports/run-repository.ts`
- Modify: `src/infrastructure/postgres/postgres-run-repository.ts`
- Modify: `src/entrypoints/api/routes/runs.ts`
- Modify: `src/bootstrap.ts`
- Modify: `tests/fixtures/create-test-app.ts`
- Modify: `tests/contract/runs.contract.test.ts`
- Modify: `e2e/run.e2e.test.ts`

- [ ] **Step 1: Write the failing contract/e2e tests**

Add tests that prove:

- missing bearer token returns `401 unauthorized` with the standard error envelope;
- malformed/unknown/disabled token returns the same public `401` shape;
- authenticated create returns `202` and still preserves the current response shape;
- authenticated GET returns the Run when owner scope matches exactly on tenant/workspace/principal;
- authenticated GET returns `404 run_not_found` for mismatched owner scope even when the run exists;
- replay still works after readiness turns false when the caller owner scope is the same.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

- `pnpm vitest run tests/contract/runs.contract.test.ts --config vitest.contract.config.ts`
- `pnpm vitest run e2e/run.e2e.test.ts --config vitest.e2e.config.ts`

Expected: FAIL because routes do not authenticate or scope reads yet.

- [ ] **Step 3: Implement authenticated create/get**

Implement:

- route authentication and stable `401` handling;
- submit path that forwards access context into admission;
- get path that performs owner-scoped lookup;
- bootstrap wiring so tests and production config share the same auth seam.

- [ ] **Step 4: Re-run the focused tests and verify GREEN**

Run the two commands above again.

Expected: PASS.

### Task 4: Documentation truth sync and full verification

**Files:**

- Modify: `README.md`
- Modify: `docs/features.md`
- Modify: `docs/contracts/run-api.md`
- Modify: `docs/components/control-plane.md`
- Modify: `docs/architecture/tenancy-and-security.md`
- Modify: `docs/decisions.md`
- Modify: `docs/exec-plans/active/2026-07-22-phase-2a-authenticated-admission-foundation.md`

- [ ] **Step 1: Write the doc updates**

Update the docs to describe the authenticated service-account baseline truth, the new API behavior, and the remaining Phase 2 gaps without implying credential/isolation completion.

- [ ] **Step 2: Run documentation and plan checks**

Run:

- `pnpm check:docs`
- `pnpm check:exec-plans`

Expected: PASS.

- [ ] **Step 3: Run the deterministic verification gate**

Run:

- `make test-unit`
- `make test-contract`
- `make test-integration`
- `make e2e-smoke`
- `make ci`

Expected: PASS.
