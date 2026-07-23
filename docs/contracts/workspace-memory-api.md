# Workspace memory API contract

`/api/v1/workspace-memory/*` is the implemented governance-only memory surface. All routes require `Authorization: Bearer <token>` and are scoped to the authenticated service-account owner scope. Cross-owner reads or reviews are hidden as not found.

This API persists proposals, review decisions, accepted entries, and source provenance. It does **not** provide agent memory, retrieval, embeddings, vector search, ranking, runtime context injection, or automatic prompt mutation.

## Create proposal

```http
POST /api/v1/workspace-memory/proposals
Authorization: Bearer configured-token
Content-Type: application/json

{
  "content": "Remember that ACME prefers weekly summaries.",
  "category": "preference",
  "source_task_id": "uuid",
  "source_session_id": "session-optional"
}
```

The decoded body is limited to 64 KiB. `content` and `category` are required non-empty strings; `category` is limited to 256 characters. `source_task_id` is optional and, when present, must be a Task visible to the authenticated owner scope. `source_session_id` is optional and limited to 512 characters. Unknown fields are rejected.

```http
HTTP/1.1 201 Created
```

```json
{
  "proposal": {
    "proposal_id": "uuid",
    "content": "Remember that ACME prefers weekly summaries.",
    "category": "preference",
    "source_task_id": "uuid",
    "source_session_id": "session-optional",
    "status": "pending",
    "review_outcome": null,
    "reviewed_content": null,
    "reviewed_at": null,
    "created_at": "2026-07-23T00:00:00.000Z",
    "updated_at": "2026-07-23T00:00:00.000Z"
  },
  "links": { "self": "/api/v1/workspace-memory/proposals/uuid" }
}
```

The `self` link is an identity link for the proposal. This phase does not implement `GET /api/v1/workspace-memory/proposals/{proposal_id}`.

## List proposals

```http
GET /api/v1/workspace-memory/proposals
Authorization: Bearer configured-token
```

```json
{
  "proposals": [
    {
      "proposal_id": "uuid",
      "content": "Remember that ACME prefers weekly summaries.",
      "category": "preference",
      "source_task_id": null,
      "source_session_id": null,
      "status": "pending",
      "review_outcome": null,
      "reviewed_content": null,
      "reviewed_at": null,
      "created_at": "2026-07-23T00:00:00.000Z",
      "updated_at": "2026-07-23T00:00:00.000Z"
    }
  ]
}
```

The list is owner-scoped and newest first.

## Review proposal

```http
POST /api/v1/workspace-memory/proposals/{proposal_id}/review
Authorization: Bearer configured-token
Content-Type: application/json

{ "action": "edit_and_accept", "content": "ACME prefers weekly executive summaries." }
```

`proposal_id` must be a UUID. Malformed proposal IDs return `400 invalid_request` with the safe message `proposal_id must be a valid UUID.`

The body must be one of:

- `{ "action": "accept" }`
- `{ "action": "edit_and_accept", "content": "non-empty accepted content" }`
- `{ "action": "reject" }`

Only `edit_and_accept` accepts `content`; `accept` and `reject` reject extra content. The decoded body is limited to 64 KiB.

```json
{
  "proposal": {
    "proposal_id": "uuid",
    "content": "Remember that ACME prefers weekly summaries.",
    "category": "preference",
    "source_task_id": null,
    "source_session_id": null,
    "status": "accepted",
    "review_outcome": "edit_and_accept",
    "reviewed_content": "ACME prefers weekly executive summaries.",
    "reviewed_at": "2026-07-23T00:00:01.000Z",
    "created_at": "2026-07-23T00:00:00.000Z",
    "updated_at": "2026-07-23T00:00:01.000Z"
  },
  "entry": {
    "entry_id": "uuid",
    "proposal_id": "uuid",
    "content": "ACME prefers weekly executive summaries.",
    "category": "preference",
    "source_task_id": null,
    "source_session_id": null,
    "review_outcome": "edit_and_accept",
    "accepted_at": "2026-07-23T00:00:01.000Z"
  }
}
```

For `reject`, the response has `proposal.status: "rejected"`, `review_outcome: "reject"`, and `entry: null`. A proposal can be reviewed only once; reviewing an accepted or rejected proposal returns `409 memory_proposal_already_reviewed`.

## List accepted entries

```http
GET /api/v1/workspace-memory/entries
Authorization: Bearer configured-token
```

```json
{
  "entries": [
    {
      "entry_id": "uuid",
      "proposal_id": "uuid",
      "content": "ACME prefers weekly executive summaries.",
      "category": "preference",
      "source_task_id": null,
      "source_session_id": null,
      "review_outcome": "edit_and_accept",
      "accepted_at": "2026-07-23T00:00:01.000Z"
    }
  ]
}
```

The list is owner-scoped and newest first. Rejected proposals never create entries.

## Errors

All errors use the common envelope:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "safe public message",
    "request_id": "uuid"
  }
}
```

Relevant codes are `unauthorized`, `invalid_json`, `invalid_request`, `request_too_large`, `task_not_found`, `memory_proposal_not_found`, `memory_proposal_already_reviewed`, `route_not_found`, and `internal_error`.

`request_too_large` is returned as `413` when the declared or actual decoded request body exceeds 64 KiB. Invalid create bodies return `400 invalid_request` with the safe public message `Non-empty content and category are required and no unknown fields are allowed.` Invalid review bodies return `400 invalid_request` with the safe public message `Review action must be accept, edit_and_accept, or reject with valid content only when editing.`
