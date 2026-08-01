# Self-learning Web API contract

This is the fixed local/single-operator Project Lab BFF contract. The Next.js
service is same-origin and server-only: it owns the Agent Server bearer and the
browser receives no upstream authentication material. The BFF binds every flow
to configured `WEB_WORKSPACE_ID`, `WEB_SELF_LEARNING_TEAM_VERSION_ID`, and
`WEB_SELF_LEARNING_MEMORY_STORE_ID` values. Missing or invalid bindings fail
closed.

## Routes

All responses include `Cache-Control: no-store`. Mutating routes require an
`Origin` whose host exactly matches `Host` and `Content-Type: application/json`.

| Method | Path                                                                          | Success | Request                             | Response                                                                                                                             |
| ------ | ----------------------------------------------------------------------------- | ------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `POST` | `/api/projects/self-learning/runs`                                            | `202`   | Exactly `{}`; maximum body 32 bytes | `{ "root_task_id": "<uuid>" }`                                                                                                       |
| `GET`  | `/api/projects/self-learning/runs/{rootTaskId}`                               | `200`   | Valid root Task UUID                | Bounded aggregate described below                                                                                                    |
| `POST` | `/api/projects/self-learning/runs/{rootTaskId}/proposals/{proposalId}/review` | `200`   | Strict review body                  | `{ "proposal": { "learning_proposal_id": "<uuid>", "status": "accepted\|rejected", "accepted_memory_version_id": "<uuid>\|null" } }` |

Launch returns only the root Task ID. It invokes the fixed three-member Team
with the configured Memory Store, canonical `research/principles.md` path, and
synthetic fixture inputs; callers cannot choose Project, Team, workspace,
Memory Store, model, prompt, or provider.

## Aggregate

The aggregate is rebuilt from durable upstream state on every GET. It may
contain only these fields:

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
  "activities": [
    {
      "task_id": "<uuid>",
      "tool": "<approved tool>",
      "status": "started|completed|failed"
    }
  ],
  "proposal": {
    "learning_proposal_id": "<uuid>",
    "status": "pending|accepted|rejected",
    "source": {
      "team_run_id": "<uuid>",
      "task_id": "<uuid>",
      "run_id": "<uuid>"
    },
    "target": { "path": "<bounded>", "base_content_sha256": "<sha256>" },
    "proposed_content": "<bounded>",
    "evidence_refs": ["<bounded>"],
    "accepted_memory_version_id": "<uuid>|null"
  },
  "memory_receipt": {
    "path": "<bounded>",
    "version": 2,
    "memory_version_id": "<uuid>",
    "content_sha256": "<sha256>",
    "content": "<bounded>"
  }
}
```

`team_run`, `report`, `proposal`, and `memory_receipt` may be `null` while the
run is incomplete. The BFF strips target Memory IDs from the public proposal
projection and includes a Memory receipt only after accepted-state lineage is
verified. The four approved activity tools are
`synthetic_stock_snapshot`, `synthetic_event_batch`,
`synthetic_analog_summary`, and `learning_proposal_create`, plus the read-only
`agent_server_memory_read` receipt activity.

## Review body and safe errors

The review body is exact and has no unknown fields:

```json
{ "action": "accept" }
{ "action": "reject" }
{ "action": "edit_and_accept", "content": "<1..8192 UTF-8 bytes>" }
```

`400 invalid_request` covers malformed JSON, wrong content type, unknown fields,
or a non-exact body. Malformed UUIDs in a review path, and foreign or missing
roots/proposals, return `404 not_found` to preserve concealment. `403 forbidden` covers
missing or mismatched same-origin headers. `404 not_found` covers invalid or
foreign roots/proposals and hides upstream ownership. `409` returns only
`learning_proposal_not_pending` or `memory_precondition_failed`. `413
request_too_large` covers bounded-body overflow. `502 upstream_unavailable`
covers normalized upstream failures, and `503 web_configuration_missing`
indicates missing fixed local bindings. No raw upstream error, database detail,
prompt, credential, local path, provider/runtime ID, or raw event payload is
returned.

This contract is not a production authentication boundary. It is approved only
for trusted local single-operator use; multi-user or production deployment
requires a new authentication Human Gate.
