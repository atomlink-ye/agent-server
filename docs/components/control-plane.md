# Control Plane component

## Purpose

The Control Plane owns product definitions and decisions that must outlive a runtime process: Tenant, identity, Agent/Team definitions and versions, Workspace membership, completion policy, tool/credential policy, approvals, schedules, and audit-facing projections.

## Responsibilities

- Draft, validate, publish, and retrieve immutable Coworker Agent, formal
  Worker, and Team versions through their separate lifecycle boundaries.
- Resolve canonical identity, tenant, effective principal, and Workspace authorization.
- Snapshot policy, input, source, version, and completion contract at Task admission.
- Expose reviewable Task trees, approval requests, Artifact lineage, and administrative state.
- Prevent an adapter, model, or caller from supplying security context or expanding capability.

## Non-responsibilities

- Executing a model or retaining provider conversation state.
- Storing raw business credentials in definitions or prompts.
- Running Team graphs as a single opaque runtime session.

## Baseline state

The first narrow Control Plane slice now covers authenticated ingress plus durable invokable state:

- configured service-account bearer authentication on `POST /api/v1/runs`, `GET /api/v1/runs/{id}`, `POST /api/v1/tasks:invoke`, `GET /api/v1/tasks/{id}`, and `GET /api/v1/tasks/{id}/tree`;
- server-derived owner scope `(tenant, workspace, principal)` rather than caller-supplied authority fields;
- persisted tenant/workspace/principal/policy snapshot facts on root Task admission;
- owner-scoped idempotency replay and owner-scoped Task/Run reads;
- durable `AgentDefinition`/`AgentVersion`, `WorkerDefinition`/`WorkerVersion`,
  and `TeamDefinition`/`TeamVersion` records in PostgreSQL;
- explicit Worker registry and migration scaffolding; this is not yet proof
  that active Product Work callers have completed the Agent-to-Worker cutover;
- immutable published invokable versions and immutable compiled sequential Team plans;
- canonical Task admission that accepts only published invokable versions in the authenticated owner scope and only the authenticated workspace for this phase.

The current Product Work compatibility path still contains Agent-shaped
composition fields and may import/publish Agents while resolving a Work. The
formal target is WorkerVersion-only composition, with no implicit Agent
materialization or Chat publication side effect. See [Coworker Agent / Worker
semantic split](../features/coworker-worker-semantic-split.md) for the cutover
rules and baseline checklist.

Still not implemented: public `/api/v1/agents`, `/api/v1/workers`, or
`/api/v1/teams` management endpoints, end-user identity, shared Workspace
ACLs, credential/tool policy enforcement, approvals, or broader channel
authorization. The repository must not imply those later controls already
exist.

## Required consumers and evidence

The Orchestration Kernel consumes immutable definition and policy snapshots. Channel adapters consume authorization and admission services. V1 tests must demonstrate concurrent publish safety, tenant isolation, deprovisioning, policy versioning, and rejection of caller-forged principals.
