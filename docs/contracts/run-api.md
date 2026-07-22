# Run and Task API contract

## Baseline create

```http
POST /api/v1/runs
Content-Type: application/json

{"prompt":"Reply with exactly: BASELINE_OK"}
```

The decoded body is limited to 64 KiB, `prompt` must be non-empty, and unknown fields are rejected. A caller-supplied `model` is invalid. Runtime readiness is checked before acceptance.

```http
HTTP/1.1 202 Accepted
```

```json
{
  "run_id": "uuid",
  "status": "queued",
  "links": { "self": "/api/v1/runs/uuid" }
}
```

## Baseline get

```http
GET /api/v1/runs/{run_id}
```

```json
{
  "run_id": "uuid",
  "status": "succeeded",
  "runtime": {
    "provider": "opencode",
    "model": "opencode/mimo-v2.5-free"
  },
  "result": { "text": "BASELINE_OK" },
  "usage": { "input_tokens": 20, "output_tokens": 4 },
  "error": null,
  "created_at": "2026-07-22T00:00:00.000Z",
  "updated_at": "2026-07-22T00:00:01.000Z"
}
```

Status is `queued|running|succeeded|failed|timed_out`. Runtime/result/usage/error are nullable. The prompt is never returned. Runtime failures use stable codes and safe messages.

## Errors

```json
{
  "error": {
    "code": "runtime_unavailable",
    "message": "The Paseo OpenCode runtime is not ready.",
    "request_id": "uuid"
  }
}
```

Relevant codes are `invalid_json`, `invalid_request`, `request_too_large`, `runtime_unavailable`, `run_not_found`, `route_not_found`, and `internal_error`.

## V1 evolution

The baseline Run route is replaced by canonical Task admission:

```http
POST /api/v1/tasks:invoke
Idempotency-Key: client-generated-key
```

The request identifies an immutable Agent/Team version, Workspace, optional Product Session, typed input, and optional completion contract. Identity, tenant, effective principal, policy, genealogy, attempt, and fence are server-derived. `GET /tasks/{id}`, `/tasks/{id}/tree`, `/runs/{id}`, cancel, retry, and cursor-based events expose durable state. No second node-invocation identity is introduced.
