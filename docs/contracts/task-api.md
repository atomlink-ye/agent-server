# Task API contract

`/api/v1/tasks:invoke` is the canonical public invocation route. `GET /api/v1/tasks/{task_id}` and `GET /api/v1/tasks/{task_id}/tree` are the canonical owner-scoped read routes. All three routes require `Authorization: Bearer <token>`.

## Invoke

```http
POST /api/v1/tasks:invoke
Authorization: Bearer configured-token
Content-Type: application/json
Idempotency-Key: client-generated-key   ; optional

{
  "invokable": {
    "kind": "agent",
    "version_id": "uuid"
  },
  "input": {
    "text": "Reply with exactly: TASK_OK"
  },
  "workspace_id": "workspace_main"
}
```

The decoded body is limited to 64 KiB. `invokable.kind` must be `agent|team`. `invokable.version_id` must be a published version in the authenticated owner scope `(tenant, workspace, principal)` because this phase has no shared ACLs yet. `input.text` must be non-empty. Unknown fields are rejected. `workspace_id` is optional; when present in this phase, it must exactly match the authenticated service-account workspace.

Unlike the Run compatibility route, Task invoke does **not** pre-check runtime readiness before accepting work.

```http
HTTP/1.1 202 Accepted
```

```json
{
  "task_id": "uuid",
  "status": "queued",
  "links": {
    "self": "/api/v1/tasks/uuid",
    "tree": "/api/v1/tasks/uuid/tree"
  }
}
```

If the same `Idempotency-Key` is replayed by the same authenticated owner scope with the same canonical request body, the route returns `202` with the original `task_id`. The same owner scope and key with a different canonical body returns `409 idempotency_conflict`. The same key used by a different authenticated owner scope is independent work, not a conflict.

## Get task

```http
GET /api/v1/tasks/{task_id}
Authorization: Bearer configured-token
```

```json
{
  "task_id": "uuid",
  "status": "completed",
  "invokable": {
    "kind": "team",
    "version_id": "uuid"
  },
  "root_task_id": "uuid",
  "parent_task_id": null,
  "parent_run_id": null,
  "latest_run": {
    "run_id": "uuid",
    "attempt": 1,
    "status": "succeeded",
    "created_at": "2026-07-22T00:00:00.000Z",
    "updated_at": "2026-07-22T00:00:01.000Z"
  },
  "result": { "text": "FINAL_STEP_OK" },
  "error": null,
  "created_at": "2026-07-22T00:00:00.000Z",
  "updated_at": "2026-07-22T00:00:01.000Z"
}
```

Task status is `queued|active|completed|failed|cancelled`. `latest_run`, `result`, and `error` are nullable. Reads are owner-scoped to the authenticated service-account binding; mismatched owner scope returns `404 task_not_found`. The input prompt is never returned.

This phase adds no public cancel route even though `cancelled` remains part of the Task status enum.

## Get task tree

```http
GET /api/v1/tasks/{task_id}/tree
Authorization: Bearer configured-token
```

```json
{
  "root_task_id": "uuid",
  "tasks": [
    {
      "task_id": "root-uuid",
      "status": "completed",
      "invokable": { "kind": "team", "version_id": "uuid" },
      "root_task_id": "root-uuid",
      "parent_task_id": null,
      "parent_run_id": null,
      "latest_run": {
        "run_id": "uuid",
        "attempt": 1,
        "status": "succeeded",
        "created_at": "2026-07-22T00:00:00.000Z",
        "updated_at": "2026-07-22T00:00:01.000Z"
      },
      "result": { "text": "FINAL_STEP_OK" },
      "error": null,
      "created_at": "2026-07-22T00:00:00.000Z",
      "updated_at": "2026-07-22T00:00:01.000Z"
    }
  ]
}
```

The response contains the root Task plus all descendants visible to the authenticated owner. Results are ordered root first, then descendants by stored `nodePath` and creation order. In the sequential Team MVP, child Tasks are read-only lineage records created by the control-plane coordinator.

## Errors

Relevant codes are `unauthorized`, `invalid_json`, `invalid_request`, `request_too_large`, `workspace_scope_mismatch`, `invokable_not_found`, `idempotency_conflict`, `task_not_found`, `route_not_found`, and `internal_error`.

## Sequential Team MVP boundary

Task invoke can target either a published `agent` version or a published `team` version. Team execution is intentionally sequential-only in this phase: invoke nodes only, one linear success chain, one final-output node, no join, no approval, no retry, no reconcile, and no shared Team-wide runtime session.
