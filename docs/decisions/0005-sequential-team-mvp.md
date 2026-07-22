# ADR 0005: Sequential Team MVP boundary

- Status: accepted
- Date: 2026-07-22

## Context

The durable-kernel and authenticated-admission phases proved canonical Task/Run persistence, owner-scoped service-account ingress, and fenced leaf-runtime execution, but the repository still lacked durable Agent/Team product objects, canonical public Task invocation, and any real Team coordination capability.

The next slice needed to land an actual Agents & Teams feature line without overclaiming Team V1. The repository rules also require keeping Paseo as a leaf runtime, preserving `/api/v1/runs` as a compatibility API, and avoiding misleading claims about approvals, retry, reconcile, artifacts, OIDC, or shared ACL completion.

## Decision

Implement a Sequential Team MVP with these boundaries:

1. Persist durable `AgentDefinition`/`AgentVersion` and `TeamDefinition`/`TeamVersion` resources plus immutable compiled sequential Team plans.
2. Expose canonical public Task routes on `POST /api/v1/tasks:invoke`, `GET /api/v1/tasks/{id}`, and `GET /api/v1/tasks/{id}/tree`.
3. Preserve `/api/v1/runs` as the authenticated compatibility API over the same canonical Task/Run state.
4. Allow Task invoke to target only published `agent` or `team` versions in the authenticated owner scope.
5. Compile Team graphs only for a sequential-only subset: invoke nodes only, one linear success chain, one final-output node, no join, no approval, no loop, no fan-in.
6. Execute published Team versions in the control plane by materializing child Tasks and child Runs inline under the claimed Team root activation. Only leaf Agent steps cross `AgentRuntimePort` into Paseo.
7. Do not add public Agent/Team management routes yet.

## Consequences

Agent Server now has a real but intentionally narrow Teams capability. Canonical public invocation is Task-first, while Run remains a compatibility representation. Team execution creates durable child genealogy without creating a shared Team-wide runtime session.

This ADR explicitly does **not** claim Team V1 completion. Parallel/join behavior, approvals, retry, reconcile, cancel propagation, artifact lineage, OIDC users, shared Workspace ACLs, and public Agent/Team CRUD APIs remain future work and must stay documented as such.
