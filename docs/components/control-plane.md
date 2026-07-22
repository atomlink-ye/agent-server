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

The component is documented but not implemented. The current API has no authentication or product-definition endpoints. Adding any identity or policy placeholder that appears secure without real enforcement is out of scope; the first implementation must start with a dedicated Exec Plan and threat model.

## Required consumers and evidence

The Orchestration Kernel consumes immutable definition and policy snapshots. Channel adapters consume authorization and admission services. V1 tests must demonstrate concurrent publish safety, tenant isolation, deprovisioning, policy versioning, and rejection of caller-forged principals.
