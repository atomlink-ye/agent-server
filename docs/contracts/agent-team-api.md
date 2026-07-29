# Agent and Team registry contract

This phase implements durable Agent and Team registry records in PostgreSQL, but it does **not** expose public `/api/v1/agents` or `/api/v1/teams` HTTP routes yet. The current contract is the persisted Invokable model consumed by canonical Task admission and sequential Team execution.

## Resource families

- `AgentDefinition`: stable owner-scoped metadata (`id`, `name`, optional `description`, owner scope, timestamps)
- `AgentVersion`: immutable executable version for one Agent definition (`draft|published`, `instructions`, timestamps, optional `publishedAt`)
- `TeamDefinition`: stable owner-scoped metadata for a Team
- `TeamVersion`: immutable Team graph version for one Team definition (`draft|published`, `graph`, timestamps, optional `publishedAt`)
- `CompiledSequentialTeamPlan`: immutable publish-time IR attached to a published Team version
- `CompiledDagTeamPlan`: immutable publish-time IR for the opt-in `dag-mve-v1` subset

All resources are owner-scoped by `(tenantId, workspaceId, principalType, principalId)`. Published-version lookups used by Task invoke and Team execution stay inside that authenticated owner scope because this phase has no shared ACLs.

## Publish invariants

- Draft versions are mutable.
- Published versions are immutable.
- A published Agent version requires non-empty `instructions`.
- A published Team version requires a compiled sequential Team plan whose `teamVersionId` matches the Team version.
- Persisting a published Team version also persists its compiled plan in the same repository write so reads cannot observe a published Team version without that plan.
- Database triggers reject mutation of published Agent versions, published Team versions, and compiled Team plans.

## Sequential Team graph subset

`TeamVersion.graph` is intentionally narrower than Team V1 in this phase:

- every node is `kind: "invoke"`
- every node references a published Agent version in the same owner scope
- exactly one linear success chain is accepted by the compiler
- no branching, fan-in, loops, joins, approvals, or dynamic delegation
- exactly one terminal `output: "final"` node is required

The compiler emits `compilerVersion: "sequential-mvp-v1"` plus ordered steps with stable `nodePath` values such as `step.0001`, `step.0002`, and so on.

## Execution relationship

Task invoke accepts an invokable reference:

```json
{
  "kind": "agent|team",
  "version_id": "uuid"
}
```

Published Agent versions execute as one leaf runtime call. Published Team versions execute in the control plane by materializing child Tasks and child Runs one sequential step at a time. Each child step executes a published Agent version through the same leaf runtime port. The next step input is derived from the previous child result text.

The opt-in `dag-mve-v1` version materializes two independent leaf child
Tasks/Runs in parallel. The root Run enters `waiting_children`; a durable join
waits for both successes, then materializes a synthesizer child and completes
the root. Child execution uses task-scoped RuntimeSessions/RuntimeCells and one
shared EnvironmentVersion. Failure is fail-fast/deferred.

## Explicit non-goals

This contract does not claim:

- public Agent/Team CRUD APIs
- generalized Team V1 parallel/join behavior beyond the observed `dag-mve-v1` subset
- approvals, retry, reconcile, cancel propagation, or budget semantics
- crash recovery, restart/resume, and production readiness
- artifact lineage completion
- OIDC users or shared Workspace ACL completion

`/api/v1/runs` remains a compatibility API throughout this phase.
