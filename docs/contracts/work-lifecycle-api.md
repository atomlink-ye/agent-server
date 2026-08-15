# Work lifecycle API

This is the minimum public HTTP flow for a client that creates and runs one
Team-backed Product Work. It is an authenticated, owner-scoped lifecycle. The
same authenticated owner scope must be used for the registry writes and the
Work writes; foreign or missing resources are concealed as the corresponding
not-found response. A Work's definition lineage is also fixed: its
`definition_id` is the Team definition ID, and its `definition_version_id` is
the ID of the published Team version whose `definition_id` is that Team ID.

The endpoint examples below show only contract fields. Replace angle-bracket
placeholders with IDs returned by the preceding response. Every request uses
the same API bearer authentication described in [Authentication and
credentials](#authentication-and-credentials).

## Exact minimum flow

The sequence is:

1. Authenticate every request with an API bearer token.
2. Import and publish each managed Agent version referenced by the Team.
3. Import and publish the managed Environment referenced by the Team.
4. Import and publish the managed Team.
5. Create a Work with the Team definition and published Team version IDs.
6. Start a WorkRun.
7. Poll the WorkRun projection until the client has the required product
   state, then retrieve its trace.

The registry package bodies are JSON objects whose only field is `source`, a
single bounded YAML document. Registry import and publish requests also carry a
non-empty `Idempotency-Key`.

### 1. Managed Agent import and publish

Import both concrete Agent packages used by this flow. The lead has the
canonical Team state, list, create, accept, and finish tools. The analyst has
the canonical Team state, list, and submit tools. The `agent-server/` prefix
is part of each package's tool reference.

Lead package:

```yaml
apiVersion: agent-server/v1alpha1
kind: ManagedAgent
metadata:
  name: smoke-lead
spec:
  description: Canonical Agent Team smoke role
  instructions: 'Act as Team Lead using only canonical Team tools. Read the board first. If no Work exists, create exactly one Work assigned to analyst with subject "Return smoke marker" and description "Submit exactly AGENT_TEAM_SMOKE_MEMBER_OK", then stop. If the analyst Work is completed, accept it. When every Work is accepted and no active attempt remains, call team_finish exactly once. Never create duplicate Work and never substitute prose for a required Team mutation.'
  runtime:
    provider: paseo
    modelPolicyRef: free-only
    mode: isolated
  tools:
    - ref: agent-server/team-state
      kind: tool
    - ref: agent-server/team-work-list
      kind: tool
    - ref: agent-server/team-work-create
      kind: tool
    - ref: agent-server/team-work-accept-v2
      kind: tool
    - ref: agent-server/team-finish
      kind: tool
  skills: []
  input:
    schema:
      type: object
      properties: {}
      additionalProperties: false
    prompt: "Execute exactly the next legal Team transition for your role."
  session:
    invocation: fresh_per_invocation
    followUps: queued
    binding: reusable
  memory:
    policy: workspace_snapshot
    proposalLimit: 0
  permissions:
    network: read_only
    filesystem: workspace_read
  completion:
    type: executable
    command: "done"
```

Analyst package:

```yaml
apiVersion: agent-server/v1alpha1
kind: ManagedAgent
metadata:
  name: smoke-analyst
spec:
  description: Canonical Agent Team smoke role
  instructions: 'Act as the assigned Team member using canonical Team tools. Read the board, locate your active Work, and submit it exactly once with result summary AGENT_TEAM_SMOKE_MEMBER_OK. Do not create Work, accept Work, finish the Team, use provider subagents, or emit unrelated prose.'
  runtime:
    provider: paseo
    modelPolicyRef: free-only
    mode: isolated
  tools:
    - ref: agent-server/team-state
      kind: tool
    - ref: agent-server/team-work-list
      kind: tool
    - ref: agent-server/team-work-submit
      kind: tool
  skills: []
  input:
    schema:
      type: object
      properties: {}
      additionalProperties: false
    prompt: "Execute exactly the next legal Team transition for your role."
  session:
    invocation: fresh_per_invocation
    followUps: queued
    binding: reusable
  memory:
    policy: workspace_snapshot
    proposalLimit: 0
  permissions:
    network: read_only
    filesystem: workspace_read
  completion:
    type: executable
    command: "done"
```

Send each YAML document as `{ "source": "<the YAML document>" }` to
`POST /api/v1/agents:import`. Each `201` response returns the IDs needed for
that Agent's publish step:

```json
{
  "result": "created|converged|replayed",
  "agent": { "id": "<agent-definition-id>" },
  "version": {
    "id": "<agent-version-id>",
    "definition_id": "<agent-definition-id>",
    "status": "draft"
  }
}
```

Publish the returned draft version with an empty JSON object `{}`:

```http
POST /api/v1/agent-versions/<agent-version-id>:publish
Idempotency-Key: <unique-publish-key>
```

The `200` response returns the same `version.id`, now with
`status: "published"`. Record the published lead and analyst
`agent-version-id` values for the Team package.

The response ID is the published version ID:

```json
{
  "id": "<published-agent-version-id>",
  "definition_id": "<agent-definition-id>",
  "status": "published"
}
```

### 2. Managed Environment import and publish

The Environment package has this representative shape:

```yaml
apiVersion: agent-server/v1alpha1
kind: ManagedEnvironment
metadata:
  name: <environment-name>
spec:
  adapter: paseo
  provider: opencode
  modelPolicyRef: free-only
  runtimeCellPolicy: per_runtime_session
```

Send `{ "source": "<the YAML document>" }` to
`POST /api/v1/environments:import` with an idempotency key. The `201` response
returns the environment definition and draft version IDs:

```json
{
  "result": "created|converged|replayed",
  "definition": { "id": "<environment-definition-id>" },
  "version": {
    "id": "<environment-version-id>",
    "definition_id": "<environment-definition-id>",
    "status": "draft"
  }
}
```

Publish the returned version:

```http
POST /api/v1/environment-versions/<environment-version-id>:publish
Idempotency-Key: <unique-publish-key>
```

The `200` response returns `id: <environment-version-id>` with
`status: "published"`. Use that published ID in the Team package.

The response ID is the published version ID:

```json
{
  "id": "<published-environment-version-id>",
  "definition_id": "<environment-definition-id>",
  "status": "published"
}
```

### 3. Managed Team import and publish

The Team package references the published Agent version IDs and Environment
version ID returned above:

```yaml
apiVersion: agent-server/v1alpha1
kind: ManagedTeam
metadata:
  name: <team-name>
spec:
  environmentVersionId: <published-environment-version-id>
  lead:
    name: <lead-name>
    agentVersionId: <published-lead-agent-version-id>
  roster:
    - name: <member-name>
      agentVersionId: <published-member-agent-version-id>
  coordination:
    taskAssignment: lead_or_self_claim
```

Send `{ "source": "<the YAML document>" }` to
`POST /api/v1/teams:import` with an idempotency key. The `201` response returns
the Team definition ID and draft version ID:

```json
{
  "result": "created|converged|replayed",
  "team": { "id": "<team-definition-id>" },
  "version": {
    "id": "<team-version-id>",
    "definition_id": "<team-definition-id>",
    "status": "draft",
    "environment_version_id": "<published-environment-version-id>"
  }
}
```

Publish it with an empty JSON object `{}`:

```http
POST /api/v1/team-versions/<team-version-id>:publish
Idempotency-Key: <unique-publish-key>
```

The `200` response returns the same version ID with
`status: "published"`. Publication verifies that every referenced Agent
version and the referenced Environment version are published in the same
owner scope.

The response carries the published Team lineage:

```json
{
  "id": "<published-team-version-id>",
  "definition_id": "<team-definition-id>",
  "status": "published",
  "environment_version_id": "<published-environment-version-id>"
}
```

When the Team-backed WorkRun executes these packages, the lead reads the
board, creates exactly one Team Work assigned to `analyst` with subject
`Return smoke marker` and the instruction to submit exactly
`AGENT_TEAM_SMOKE_MEMBER_OK`, then stops that control turn. The analyst reads
the board and submits that marker exactly once. The lead then accepts the
completed Work and calls `team_finish` exactly once after every Work is
accepted and no active attempt remains. These are the canonical Team tool
mutations represented by the two packages above; the client still uses the
public Work and WorkRun routes below to create and monitor the outer Product
Work lifecycle.

### 4. Create the Work

Create a Work with the Team IDs from the previous step:

```http
POST /api/v1/works
Content-Type: application/json
```

```json
{
  "definition_id": "<team-definition-id>",
  "definition_version_id": "<published-team-version-id>",
  "title": "<work-title>"
}
```

The body is strict; `workspace_id` and other owner fields are not accepted.
The `201` response contains the Work ID and confirms the pinned lineage:

```json
{
  "work": {
    "id": "<work-id>",
    "definition_id": "<team-definition-id>",
    "definition_version_id": "<published-team-version-id>"
  }
}
```

### 5. Start the WorkRun

```http
POST /api/v1/works/<work-id>/runs
Content-Type: application/json
```

```json
{
  "trigger_kind": "manual",
  "trigger_ref": "<bounded-trigger-reference>"
}
```

`trigger_ref` is optional in the request; the server supplies the stored
trigger reference when omitted. The `202` response returns the WorkRun ID and
the admitted root Task ID:

```json
{
  "work_run": {
    "id": "<work-run-id>",
    "work_id": "<work-id>",
    "definition_version_id": "<published-team-version-id>",
    "trigger_kind": "manual",
    "bound_at": "<iso-datetime>"
  },
  "execution_receipt": {
    "reused": false,
    "source_refs": { "task_id": "<root-task-id>" }
  }
}
```

### 6. Poll the WorkRun projection

Poll the owner-scoped projection using both IDs returned by the start
response:

```http
GET /api/v1/works/<work-id>/runs/<work-run-id>
```

A successful `200` response has a `work` object and a detailed `work_run`
object. The stable fields needed to continue the flow are:

```json
{
  "work": {
    "id": "<work-id>",
    "definition_id": "<team-definition-id>",
    "definition_version_id": "<published-team-version-id>"
  },
  "work_run": {
    "id": "<work-run-id>",
    "work_id": "<work-id>",
    "definition_version_id": "<published-team-version-id>",
    "product_state": "running|needs_you|complete|problem|not_captured",
    "result_capture_status": "present|not_present|redacted|not_captured"
  },
  "projection_status": "internally_anchored"
}
```

Continue polling while `product_state` is `running`. Immediately after a
WorkRun is started, `GET /api/v1/works/<work-id>/runs/<work-run-id>` may return
`503 projection_unavailable` while the projection catches up. Treat that exact
503 as temporary: retry the same GET with bounded backoff until a client-chosen
deadline, then report the deadline as an unavailable projection rather than
assuming the Work failed. Once a `200` projection is available,
`needs_you` indicates a completion-approval attention state; `complete`,
`problem`, and `not_captured` are terminal product outcomes for this
projection. The response also includes bounded `work_items`, `actors`, and
`messages` identity collections; it does not expose prompts, credentials,
local paths, or raw provider payloads.

### 7. Retrieve the trace

After polling, retrieve the trace with the same Work and WorkRun IDs:

```http
GET /api/v1/works/<work-id>/runs/<work-run-id>/trace
```

The `200` response repeats the `work` and `work_run` IDs and includes
`runs`, `events`, `edges`, `mcp_activities`, and `timeline_coverage`. The
timeline coverage is explicitly MCP dispatch/confirmation only; it is not a
claim of complete provider execution history. `projection_status` remains
`internally_anchored` for a successful projection.

The trace can contain both orchestration records and provider-execution
records. An orchestration/root record coordinates the Team but does not itself
call a model, so its `provider` and `usage` can both be `null`. That is not a
missing execution or a failed Work. To report provider usage, read each
trace-run `source_refs.run_id` through `GET /api/v1/runs/<run-id>`, then
aggregate only non-null `usage` objects from records with a real runtime. In
particular, clients must not dereference `usage` on every trace record: skip
`null` entries before adding `input_tokens`, `cached_input_tokens`,
`output_tokens`, and `total_cost_usd`.

At minimum, the trace response preserves the same identity (abridged):

```json
{
  "work": { "id": "<work-id>" },
  "work_run": { "id": "<work-run-id>", "work_id": "<work-id>" },
  "projection_status": "internally_anchored",
  "runs": [],
  "events": [],
  "edges": [],
  "mcp_activities": [],
  "timeline_coverage": {
    "scope": "mcp_dispatch_and_confirmation",
    "completeness": "mcp_only",
    "excluded_execution": [
      "direct_shell",
      "direct_file_edit",
      "other_non_mcp_execution"
    ]
  }
}
```

## Write-route idempotency in this lifecycle

This table is scoped to the exact lifecycle above. Use a distinct key per
registry operation. Idempotency is owner-scoped, and a same-key replay must
use the same request fingerprint.

| Route | Required header | Same key + same request | Same key + different request | Header policy |
| --- | --- | --- | --- | --- |
| `POST /api/v1/agents:import` | `Idempotency-Key` required | Replays the original `201` result and IDs | `409 idempotency_conflict` | Required |
| `POST /api/v1/agent-versions/{versionId}:publish` | `Idempotency-Key` required | Replays the published version result | `409 idempotency_conflict` | Required |
| `POST /api/v1/environments:import` | `Idempotency-Key` required | Replays the original `201` result and IDs | `409 idempotency_conflict` | Required |
| `POST /api/v1/environment-versions/{versionId}:publish` | `Idempotency-Key` required | Replays the published version result | `409 idempotency_conflict` | Required |
| `POST /api/v1/teams:import` | `Idempotency-Key` required | Replays the original `201` result and IDs | `409 idempotency_conflict` | Required |
| `POST /api/v1/team-versions/{versionId}:publish` | `Idempotency-Key` required | Replays the published version result | `409 idempotency_conflict` | Required |
| `POST /api/v1/works` | Must be absent | No public replay semantics | Not applicable | Server rejects the header with `400 invalid_request` |
| `POST /api/v1/works/{workId}/runs` | Must be absent | No public replay semantics | Not applicable | Server rejects the header with `400 invalid_request` |
| `POST /api/v1/runs` (optional compatibility route) | Optional | Replays an accepted compatibility Run | `409 idempotency_conflict` | See [Run compatibility API](run-api.md) |

The Work exception is deliberate. Work creation and WorkRun start do not offer
public idempotency or replay semantics. Accepting `Idempotency-Key` on those
commands would imply a replay contract the server does not provide, so the
server rejects the header rather than silently ignoring it. This is the
implemented `400 invalid_request` behavior, not a new Work idempotency API.

## Authentication and credentials

All routes in this lifecycle require the enabled service-account bearer
authentication. The bearer token is resolved by the server from the enabled
service-account configuration represented by `SERVICE_ACCOUNTS_JSON`; the
caller does not submit tenant, principal, workspace, or policy authority in a
request body. The authenticated binding supplies the owner scope used for
authorization and replay scoping.

| Configuration or header | Responsibility in this lifecycle |
| --- | --- |
| `Authorization: Bearer ...` | API authentication. The bearer comes from an enabled service-account entry in `SERVICE_ACCOUNTS_JSON`. |
| `SERVICE_ACCOUNTS_JSON` | Server-side service-account configuration that enables the bearer and binds its owner scope. |
| `PASEO_PROVIDER` | Runtime/provider injection. It is not bearer authentication and is not caller authority. |
| `PASEO_MODEL` | Runtime/provider injection. It is not bearer authentication and is not caller authority. |

Do not treat provider/model settings as credentials, and do not put bearer
tokens, provider credentials, raw provider errors, or local credential paths in
package source, request bodies, responses, or ordinary logs.

## Team lookup and safe errors

There is no owner-scoped Team-definition list endpoint. For a new definition,
use the `team.id` and draft `version.id` returned by
`POST /api/v1/teams:import`, then publish that version. For an already-known
Team definition, use `GET /api/v1/teams/{id}/versions` to list its versions and
select the required version. This is also why no error-text change is made to
reference a hypothetical Team list route: there is no truthful owner-scoped
`X` list endpoint to reference.

Representative safe status mappings for this lifecycle are:

| Status | Code | Meaning |
| --- | --- | --- |
| `401` | `unauthorized` | Missing or invalid enabled service-account bearer. |
| `400` | `invalid_request` | Malformed/strictly invalid body, path, query, or a supplied `Idempotency-Key` on a Work write. |
| `400` | `invalid_work_definition` | Work definition/version is not a valid published Team lineage for the authenticated owner scope. |
| `400` | `invalid_idempotency_key` | Required registry key is missing, blank, or too long. |
| `400` | package validation code | Managed Agent, Environment, or Team YAML is invalid. |
| `404` | `agent_not_found`, `environment_version_not_found`, `team_not_found`, `work_not_found`, or `work_run_not_found` | Missing or foreign owner-scoped resource, without existence disclosure. |
| `409` | `idempotency_conflict` | A required registry key was reused for a different request in the same owner scope. |
| `409` | `work_identity_conflict`, `workspace_scope_unavailable`, `pending_expired`, or `work_run_binding_conflict` | Implemented Work/WorkRun conflict or admission condition. |
| `503` | `projection_unavailable` | The WorkRun projection is temporarily unavailable; retry the same WorkRun GET with bounded backoff until the client deadline. This is not a Work failure. |
| `500` | `projection_invalid` | The persisted WorkRun projection cannot be represented safely. |

Error bodies use the common safe envelope and include a request ID:

```json
{
  "error": {
    "code": "safe_code",
    "message": "safe human-readable message",
    "request_id": "<request-id>"
  }
}
```

Raw YAML, prompts, bearer tokens, credentials, local paths, provider wire
objects, and database errors are not public response fields.
