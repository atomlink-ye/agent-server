# Control Plane component

## Purpose

The Control Plane owns product definitions and decisions that must outlive a runtime process: Tenant, identity, Agent/Team versions, Workspace membership, completion policy, tool/credential policy, approvals, schedules, and audit-facing projections.

## Responsibilities

- Draft, validate, publish, and retrieve immutable Agent and Team versions.
- Resolve canonical identity, tenant, effective principal, and Workspace authorization.
- Snapshot policy, input, source, version, and completion contract at Task admission.
- Expose reviewable Task trees, approval requests, Artifact lineage, and administrative state.
- Prevent an adapter, model, or caller from supplying security context or expanding capability.

## Non-responsibilities

- Executing a model or retaining provider conversation state.
- Storing raw business credentials in definitions or prompts.
- Running Team graphs as a single opaque runtime session.

## Baseline state

The first narrow Control Plane slice is implemented for the Run compatibility API:

- configured service-account bearer authentication on `POST /api/v1/runs` and `GET /api/v1/runs/{id}`;
- server-derived owner scope `(tenant, workspace, principal)` rather than caller-supplied authority fields;
- persisted tenant/workspace/principal/policy snapshot facts on root Task admission;
- owner-scoped idempotency replay and owner-scoped Run reads.

Still not implemented: durable product-definition endpoints, end-user identity, shared Workspace ACLs, credential/tool policy enforcement, approvals, or broader channel authorization. The repository must not imply those later controls already exist.

## Required consumers and evidence

The Orchestration Kernel consumes immutable definition and policy snapshots. Channel adapters consume authorization and admission services. V1 tests must demonstrate concurrent publish safety, tenant isolation, deprovisioning, policy versioning, and rejection of caller-forged principals.
