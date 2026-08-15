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

The `toolProfiles`, `skills`, and `memoryStores` manifest sections may be
omitted when empty; omission normalizes to `{}` and grants no tool or skill.
Agent `completion.command`, input schema/prompt, instructions, and declared
resource bindings remain explicit author intent.

## Agent-facing collaboration tools

Collaboration commands are MCP tools for the Agents in a Team, not public HTTP
commands for a Team owner. An Agent receives a tool only when its package
explicitly authorizes the canonical ref below (or explicitly includes its
reserved role profile). The HTTP routes in [Reads](#reads) are projections for
the owner to inspect; they intentionally do not include equivalents of
`message_send`, `board_claim`, or `board_request_changes`.

| Group | Canonical tool ref | MCP name |
| --- | --- | --- |
| Read | `agent-server/collaboration-state` | `collaboration_state` |
| Read | `agent-server/board-list` | `board_list` |
| Board mutation | `agent-server/board-create` | `board_create` |
| Board mutation | `agent-server/board-assign` | `board_assign` |
| Board mutation | `agent-server/board-claim` | `board_claim` |
| Board mutation | `agent-server/board-checkpoint` | `board_checkpoint` |
| Board mutation | `agent-server/board-block` | `board_block` |
| Board mutation | `agent-server/board-submit` | `board_submit` |
| Board mutation | `agent-server/board-accept` | `board_accept` |
| Board mutation | `agent-server/board-request-changes` | `board_request_changes` |
| Board mutation | `agent-server/board-cancel` | `board_cancel` |
| Mailbox | `agent-server/inbox-list` | `inbox_list` |
| Mailbox | `agent-server/message-send` | `message_send` |
| Mailbox | `agent-server/message-ack` | `message_ack` |
| Run | `agent-server/collaboration-finish` | `collaboration_finish` |

The lead role may receive board read/create/assign/review/cancel, mailbox
read/send/ack, and run-finalize capabilities. A member may receive board
read/claim/checkpoint/block/submit and mailbox read/send/ack capabilities.
In particular, a member does **not** receive `board.create`: only the lead can
create Work. The `tool-profile://team-lead` and
`tool-profile://team-member` profiles grant precisely those respective role
sets when explicitly included; an omitted profile or ref grants nothing.

For example, a minimal Agent package can authorize a member to inspect state,
list Work, and send an addressed message:

```yaml
spec:
  tools:
    - ref: agent-server/collaboration-state
      kind: tool
    - ref: agent-server/board-list
      kind: tool
    - ref: agent-server/message-send
      kind: tool
```

For local integration work, `pnpm dev` starts the `core` profile and is not the
Agent Team runtime/API process to target. Start the runtime profile with
`pnpm dev:runtime` (or `pnpm local-env up runtime`) and inspect its connection
metadata with `pnpm local-env info`. For an isolated command, use
`pnpm local-env run runtime -- <command>`; that shared environment wrapper
supplies `AGENT_SERVER_BASE_URL` and `AGENT_SERVER_SERVICE_TOKEN` to the
command. Do not copy those connection values into an Agent package or source
file.

`agentctl` authoring failures emit an error `code`, resource-qualified `path`,
and usable `message`. Native package and project-reference validation retain
their original reason while unknown filesystem failures remain
`filesystem_error`; validation is not relaxed.

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
