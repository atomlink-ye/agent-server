# Agentic Team Project Web API contract

This is the fixed local/single-operator Agentic Team Project BFF contract. The
Next.js service is same-origin and server-only: it owns the Agent Server bearer
and the browser receives no upstream authentication material. The BFF binds
every flow to `WEB_WORKSPACE_ID`, `WEB_AGENTIC_TEAM_VERSION_ID`, and
`WEB_ENVIRONMENT_VERSION_ID`. Missing or invalid bindings fail closed. The
browser never calls `/api/v1`.

## Routes

All responses include `Cache-Control: no-store`. Mutating routes require an
`Origin` whose host exactly matches `Host` and `Content-Type: application/json`.

| Method | Path                                                                                 | Success | Request                                   | Response                                   |
| ------ | ------------------------------------------------------------------------------------ | ------- | ----------------------------------------- | ------------------------------------------ |
| `POST` | `/api/team-project/runs`                                                             | `202`   | Exactly `{}`; maximum body 32 bytes       | `{ "root_task_id": "<uuid>" }`             |
| `GET`  | `/api/team-project?task=<rootTaskId>`                                                | `200`   | Optional owner-checked root Task UUID     | Bounded Project projection described below |
| `GET`  | `/api/team-project/sessions/{teamMemberRunId}?task=<rootTaskId>`                     | `200`   | Owner-checked TeamMemberRun and root Task | Read-only Agent Session projection         |
| `GET`  | `/api/team-project/sessions/{teamMemberRunId}/runs/{runId}/events?task=<rootTaskId>` | `200`   | Owner-checked session Run                 | Historical safe Run event replay           |
| `GET`  | `/api/team-project/runs/{runId}/events?task=<rootTaskId>`                            | `200`   | Owner-checked Project Run                 | Project Run SSE stream                     |

Launch returns only the root Task ID. It invokes the fixed-roster Team with
server-configured Workspace, TeamVersion, EnvironmentVersion, and fixture
inputs; callers cannot choose Project, Team, workspace, model, prompt, or
provider. Without `task`, the Project route returns the latest owner-scoped
Project; with `task`, it requires the root created by this entry point.

The upstream Agent Server projection is `GET /api/v1/team-runs:project` with
`root_task_id`. It is called only by the server-side BFF.

## Project and Agent Session projections

The Project and Agent Session projections are rebuilt from durable upstream
state. They may contain only bounded Project, TeamRun, TeamMemberRun, WorkItem,
attempt, turn, and safe event fields. They never contain bearer credentials,
RuntimeSession IDs, prompts, raw upstream errors, or raw provider payloads.

The Project response includes the three fixed-roster Agent Sessions. A session
is read-only and its turns are ordered by Team sequence; assignment and rework
feedback may appear as bounded context. Historical event replay uses the same
safe event projection as normal Chat. ProductSession Chat is unchanged.

The Project projection may contain fields equivalent to:

```json
{
  "root_task_id": "<uuid>",
  "status": "<bounded status>",
  "tasks": [
    {
      "task_id": "<uuid>",
      "parent_task_id": "<uuid>|null",
      "status": "<bounded status>",
      "latest_run_status": "<bounded status>|null"
    }
  ],
  "team_run": { "status": "<bounded status>", "phase": "<bounded phase>" },
  "members": [
    { "name": "<bounded>", "role": "<bounded>", "status": "<bounded>" }
  ],
  "work_items": [
    {
      "subject": "<bounded>",
      "status": "<bounded>",
      "owner_name": "<bounded>|null",
      "completion_summary": "<bounded>|null",
      "truncated": false
    }
  ],
  "report": { "text": "<bounded>", "truncated": false },
  "attempts": [
    {
      "work_item_id": "<uuid>",
      "attempt_no": 1,
      "status": "queued|running|completed|failed",
      "feedback": "<bounded>|null",
      "result_summary": "<bounded>|null"
    }
  ],
  "sessions": [
    {
      "team_member_run_id": "<uuid>",
      "name": "<bounded>",
      "role": "lead|member",
      "status": "queued|running|completed|failed"
    }
  ]
}
```

`team_run` and `report` may be `null` while the run is incomplete. The fixed
Verifier may be present as a queued session when it has not run; the BFF does
not fabricate a result.

## Safe errors

`400 invalid_request` covers malformed JSON, wrong content type, unknown fields,
or a non-exact launch body. Malformed or foreign Task, TeamMemberRun, and Run
IDs return `404 not_found` to preserve concealment. `403 forbidden` covers
missing or mismatched same-origin headers. `413 request_too_large` covers
bounded-body overflow. `502 upstream_unavailable` covers normalized upstream
failures, and `503 web_configuration_missing` indicates missing fixed local
bindings. No raw upstream error, database detail, prompt, credential, local
path, provider/runtime ID, or raw event payload is returned.

This contract is not a production authentication boundary. It is approved only
for trusted local single-operator use; multi-user or production deployment
requires a new authentication Human Gate.
