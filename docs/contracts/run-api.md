# Run compatibility API contract

`/api/v1/runs` is the implemented HTTP surface. Internally, `POST /api/v1/runs` admits a canonical root Task plus its first Run in PostgreSQL; the Run resource remains the compatibility representation returned over HTTP.

## Create

```http
POST /api/v1/runs
Content-Type: application/json
Idempotency-Key: client-generated-key   ; optional

{"prompt":"Reply with exactly: BASELINE_OK"}
```

The decoded body is limited to 64 KiB, `prompt` must be non-empty, and unknown fields are rejected. A caller-supplied `model` is invalid. Runtime readiness is checked before accepting new work.

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

If the same `Idempotency-Key` is replayed with the same body after acceptance, the route returns `202` with the original `run_id`, even if runtime readiness later turns false. The same key with a different body returns `409 idempotency_conflict`.

## Get

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

Relevant codes are `invalid_json`, `invalid_request`, `request_too_large`, `runtime_unavailable`, `idempotency_conflict`, `run_not_found`, `route_not_found`, and `internal_error`.

## Future public Task routes

Public Task routes are not implemented in this phase. When they are added, they must expose the same canonical Task admission already used internally instead of introducing a competing invocation identity.
