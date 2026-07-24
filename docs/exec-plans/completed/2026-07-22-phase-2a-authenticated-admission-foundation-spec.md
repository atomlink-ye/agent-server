---
status: completed
owner: gpt-5.4
created_at: 2026-07-22
updated_at: 2026-07-24
authority: design-spec
---

# Phase 2A Authenticated Admission Foundation Design

## Summary

Phase 2A introduces the first real control-plane identity boundary for Agent Server. The current `/api/v1/runs` compatibility API remains the only public invocation surface, but it will stop accepting anonymous callers. A caller must authenticate as a configured service account. The server resolves the canonical tenant, principal, and workspace from that service account binding, persists that security snapshot on admitted root Tasks, scopes idempotency to that resolved authority, and enforces the same owner scope on Run reads.

This is intentionally not the whole Phase 2 roadmap. It is the smallest implementation slice that makes admission authorization real without pretending that user OIDC, credential brokering, approval policy, or execution-cell isolation already exist.

## Context and authority

- Product direction: `docs/product.md`
- Feature ledger: `docs/features.md`
- Phase sequencing: `docs/roadmap.md`
- Control-plane boundary: `docs/components/control-plane.md`
- Security boundary: `docs/architecture/tenancy-and-security.md`
- Current compatibility API: `docs/contracts/run-api.md`
- Human Gate rules: `docs/agents/human-gates-and-handoff.md`

The user explicitly chose to jump from Durable Kernel A into a Phase 2 thin slice instead of finishing Durable Kernel B first.

## Problem

The current baseline has no authentication, no tenant boundary, and no authorization on `POST /api/v1/runs` or `GET /api/v1/runs/{id}`. Root Task admission hardcodes `tenant_local`, and persisted admission state cannot distinguish one caller from another. This blocks any credible Phase 2 foundation because the system cannot prove who admitted work, which workspace it belongs to, or whether a later reader is allowed to inspect it.

## Goals

1. Require authentication for create and read operations on the Run compatibility API.
2. Resolve canonical service-account identity on the server rather than trusting caller-supplied tenant or principal fields.
3. Persist tenant, workspace, principal, and policy snapshot facts at root Task admission.
4. Scope idempotency by resolved owner scope so one caller cannot collide with another caller's admission key.
5. Enforce the same owner scope on `GET /api/v1/runs/{id}` without leaking cross-tenant existence.
6. Record enough persisted snapshot metadata and structured logs for later recovery, review, and control-plane expansion, without building an audit subsystem.

## Non-goals

- End-user OIDC, canonical human user mapping, or Lark identity binding.
- Credential broker, tool gateway, capability tokens, or approval flows.
- Execution-cell isolation, workload identity injection, or runtime credential isolation.
- Public Task routes, Session APIs, SSE, or Web/Lark channel work.
- Durable Kernel B reconcile, retry, cancel, or `unknown` outcome semantics.
- Audit tables, audit APIs, or a durable policy engine.
- Production claim that customer data or production credentials are now safe to process.

## Chosen approach

### Authentication model

Use `Authorization: Bearer <token>` on the existing Run compatibility API.

Each accepted token maps to one configured service-account binding with:

- `serviceAccountId`
- `tenantId`
- `workspaceId`
- `policyVersion`
- `disabled` flag

This binding is configured from server configuration for Phase 2A rather than from a durable control-plane store. It is authoritative ingress enforcement, not a durable identity registry, token lifecycle system, or credential-security completion story. It is still real enforcement because the token is required, the mapping is authoritative, disabled accounts are denied, and callers cannot override the resolved tenant/principal/workspace.

Changing a service account's tenant/workspace binding is treated as a new principal identity for Phase 2A. Existing runs are never silently reinterpreted under an in-place rebinding.

### Admission model

The route keeps the same prompt-only request body. The workspace is not caller-selectable in this phase; it is derived from the service-account binding. This keeps the first identity slice narrow and avoids introducing a half-designed multi-workspace API before the control plane exists to manage it.

When a request is admitted, the Task persists:

- `tenantId`
- `workspaceId`
- `principalType = service_account`
- `principalId`
- `policySnapshotVersion`

The admission record also persists the resolved scope. Scoped idempotency uniqueness is defined by:

- `ingress`
- `tenantId`
- `workspaceId`
- `principalType`
- `principalId`
- `idempotencyKey`

`policySnapshotVersion` is persisted as a snapshot fact but is not part of authorization or idempotency matching.

### Read model

Run reads are owner-scoped in Phase 2A. A caller can read a run only when the stored Task matches all of:

- `tenantId`
- `workspaceId`
- `principalType`
- `principalId`

`policySnapshotVersion` does not affect read authorization. Mismatched scope returns the same `404 run_not_found` shape used for absent runs so the API does not confirm cross-tenant identifiers.

### Policy snapshot model

Phase 2A persists a small policy snapshot version string, not a full policy object graph. The purpose is to prove that admission snapshots can carry authorization facts without waiting for the full control-plane policy engine.

## Alternatives considered

### 1. Finish Durable Kernel B first

Pros: better reliability sequencing; avoids mixing recovery and identity work.

Cons: does not broaden product scope; postpones the first real security boundary the user wants now.

Rejected because the user explicitly wants to expand foundation breadth before perfecting the kernel.

### 2. Add end-user OIDC first

Pros: closer to eventual user-facing product model.

Cons: much larger surface; requires identity provider integration, canonical user mapping, and more product/API decisions.

Rejected as too broad for the first Phase 2 slice.

### 3. Add auth plus credential broker skeleton simultaneously

Pros: covers more of Phase 2 quickly.

Cons: high risk of secure-looking placeholders. The repository docs explicitly forbid that.

Rejected because broker/tool enforcement without the real gateway and execution boundary would overclaim security.

## Architecture

### Request flow

1. API middleware extracts the bearer token.
2. A service-account authenticator resolves a canonical access context or rejects the request.
3. Routes call application services with that access context.
4. Root Task admission persists the access context snapshot.
5. Run reads use a scope-aware repository lookup so cross-scope IDs are not exposed.

### Domain and application changes

- Extend root Task shape to carry workspace/principal/policy snapshot facts.
- Extend admission request types to include resolved access context.
- Add a small control-plane access-context type that can be passed through application services without importing HTTP concerns.
- Extend repositories with scope-aware lookup and scope-aware idempotency operations.

### Infrastructure changes

- Add a new SQL migration for Task/admission identity fields and scoped uniqueness.
- Add a config-backed service-account registry/authenticator.
- Update PostgreSQL repositories to save and query the new scope columns.

## Error handling

- Missing, malformed, unknown, or disabled bearer token: identical `401 unauthorized` response shape.
- `401` responses return the normal error envelope and `WWW-Authenticate: Bearer`.
- Authenticated caller outside stored owner scope on read: `404 run_not_found`
- Same scoped `Idempotency-Key` with different prompt: `409 idempotency_conflict`
- Same key used by a different owner scope: independent admission, not a conflict

## Security and threat model

### Threats addressed in this phase

- anonymous submit/poll against the compatibility API
- caller-forged tenant/principal/workspace context
- cross-tenant or cross-workspace read by guessed Run ID
- global idempotency collisions across different callers
- logging or echoing raw token material in normal API responses

### Threats explicitly not solved yet

- use of private business credentials inside tools or runtimes
- execution-cell filesystem/network isolation
- approval replay/bypass
- stale activation/fence capability misuse at tool-call time
- post-admission reconcile behavior after runtime uncertainty

## Verification approach

Minimum evidence for this phase:

- route/contract tests for `401`, owner-scoped `404`, and authenticated create/get success
- unit tests for service-account config parsing and Task snapshot creation
- integration tests for persisted tenant/workspace/principal/policy fields and scoped idempotency
- adversarial integration checks for cross-scope read rejection and forged-context rejection
- `make test-unit`, `make test-contract`, `make test-integration`, `make e2e-smoke`, and `make ci`

External runtime smoke is not required unless the runtime boundary changes; this phase should stay in control-plane admission and storage seams.

## Human Gate record

This phase changes the tenant/identity/public API boundary by making the Run compatibility API authenticated and by extending persisted Task/admission state with security scope. The user explicitly approved proceeding with this direction and asked for autonomous completion. The corresponding ADR and Active Exec Plan record the narrower scope so the repo does not accidentally imply full Phase 2 completion.

## Expected documentation impact

- README baseline limitations and quick-start examples must mention authenticated Run API use.
- Features, control-plane, security, and Run API contract docs must reflect the new authenticated baseline.
- A new ADR records the first tenant/service-account admission boundary.
