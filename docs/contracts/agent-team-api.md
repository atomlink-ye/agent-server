# Agent Teams v2 API contract

Agent Teams v2 is the only current Team execution model. A published Team
Version declares one Lead and a fixed roster. Task invocation activates the
`TeamDriver`, which persists the Team's durable coordination state rather than
compiling a graph or selecting an execution mode.

## Resource families

- `AgentDefinition` and immutable `AgentVersion` records describe leaf agents.
- `TeamDefinition` and immutable published `TeamVersion` records describe the
  fixed Lead, roster, and EnvironmentVersion used by a Team.
- `TeamRun` is one durable activation of that Team Version for a root Task/Run.
- `MemberRun` is the Lead or one roster member within a TeamRun.
- `Work` is a bounded unit created, assigned, submitted, reviewed, accepted, or
  returned for changes by the Team.
- `TeamMessage` is a durable addressed wake, work update, or direct message.

All resources are owner-scoped by `(tenantId, workspaceId, principalType,
principalId)`. Foreign and missing resources remain concealed. Published
versions are immutable; draft/published registry reads and package
validate/import/publish routes remain the supported definition-management
surface.

## AgentProject authoring contract

AgentProject is the authoritative declaration boundary. Environment, Agent,
and Team map entries may contain either a `file` locator or the native package
spec inline. Inline metadata names derive from their manifest keys. The loader
fills only the approved single-value and safe defaults before validating and
canonicalizing native packages; a wrong explicit value remains invalid.

The reserved `tool-profile://team-lead` and
`tool-profile://team-member` refs expand to the canonical tools for those
roles. They are materialized only when an Agent explicitly includes the ref,
so shortening a declaration never grants tools implicitly. Reserved profiles
cannot be overridden by project tool-profile entries.

Equivalent inline/defaulted and file-backed/explicit declarations normalize to
the same logical resource paths, native package bytes, project fingerprint,
apply payloads, and lock identities. `agentctl run` continues to launch only a
published Team selected from the lock and declared entrypoints; invocation
does not define Agents, tools, environments, skills, or roster membership.

## Invocation and lifecycle

`POST /api/v1/tasks:invoke` accepts a published Team Version through the
standard invokable reference. The root Task/Run is the public entry point.
`TeamDriver` creates the TeamRun, its fixed MemberRuns, and the first Lead Run.
It then advances only durable Team state:

1. The Lead inspects Team state and creates or reviews Work.
2. A roster member claims assigned Work and creates one bounded work attempt.
3. Member checkpoint/submit updates Work state and wakes the Lead.
4. The Lead accepts qualifying Work or requests changes; a direct TeamMessage
   creates one addressed recipient continuation.
5. The Lead finishes only after every Work item is accepted and no active
   attempt remains.

Every lead control turn, work attempt, and addressed continuation is a
canonical child Task/Run linked to its TeamRun and MemberRun. Members retain
independent runtime context; the Team does not imply a shared provider session.
Command receipts, owner scope, revision fencing, and message deduplication are
the mutating-operation boundaries.

## Reads

The authenticated owner can inspect the current Team state through:

- `GET /api/v1/tasks/{task_id}/team-run`
- `GET /api/v1/team-runs/{id}`
- `GET /api/v1/team-runs/{id}/members`
- `GET /api/v1/team-runs/{id}/tasks`
- `GET /api/v1/team-runs/{id}/direct-messages`
- `GET /api/v1/team-runs:project?root_task_id={uuid}`

The project projection is bounded and safe for the same-origin Web BFF. It
contains TeamRun, MemberRun, Work, attempt, turn, and safe status/report data;
it excludes prompts, credentials, RuntimeSession identifiers, provider payloads,
and raw upstream errors.

## Non-goals

This contract does not provide dynamic rosters, nested Teams, generalized graph
execution, a separate public Team command API, shared ACLs, or production
recovery/retry/cancellation guarantees. `/api/v1/runs` remains a compatibility
API for prompt-only Runs; Team callers use Task invocation and TeamRun reads.
