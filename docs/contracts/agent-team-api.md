# Agent and Team registry contract

This phase implements durable owner-scoped Agent and Team registry records in PostgreSQL and their authenticated validate/import/read/list/publish routes. The current contract is the persisted Invokable model consumed by canonical Task admission and Team execution.

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

## Collaborative Team MVE

The published Team registry model contains one lead and a persisted roster.
`POST /api/v1/tasks:invoke` creates the root Task/Run and a durable `TeamRun`;
`GET /api/v1/tasks/{id}/team-run` plus the TeamRun member/task routes expose
owner-scoped `TeamRun`, `MemberRun`, and `WorkItem` state. The lead kickoff
prompt is generated from the stored roster names. Members use the team MCP
tools (`team_members_list`, `team_task_list`, `team_task_create`,
`team_task_claim`, `team_task_update`, and `team_complete`) through the runtime
boundary. Each member has an independent RuntimeSession. Lead finalization uses
a fresh task-scoped runtime execution/provider Agent while the lead member's
canonical session remains the kickoff team_member session.

Lead finalization requires exactly one completed, member-owned WorkItem per
roster member, every member Task to be `completed`, and every member Task's
latest/current Run to be `succeeded`. CAS phase transitions and owner scope
remain enforcement boundaries.

## Explicit non-goals

This contract does not claim:

- generalized Agent/Team CRUD beyond the implemented registry routes
- generalized Team V1 parallel/join behavior beyond the observed `dag-mve-v1` subset
- approvals, retry, reconcile, cancel propagation, or budget semantics
- crash recovery, restart/resume, and production readiness
- artifact lineage completion
- OIDC users or shared Workspace ACL completion

`/api/v1/runs` remains a compatibility API throughout this phase.
