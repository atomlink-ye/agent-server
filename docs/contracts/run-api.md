# Run compatibility API contract

`/api/v1/runs` remains the implemented compatibility HTTP surface. Both `POST` and `GET` require `Authorization: Bearer <token>`. Internally, `POST /api/v1/runs` admits a canonical root Task plus its first Run in PostgreSQL; the Run resource remains the compatibility representation returned over HTTP even though canonical public invocation now lives on the Task API.

## Create

```http
POST /api/v1/runs
Authorization: Bearer configured-token
Content-Type: application/json
Idempotency-Key: client-generated-key   ; optional

{"prompt":"Reply with exactly: BASELINE_OK"}
```

The decoded body is limited to 64 KiB, `prompt` must be non-empty, and unknown fields are rejected. A caller-supplied `model` is invalid. The caller cannot provide authoritative tenant, workspace, or principal fields. Runtime readiness is checked before accepting new compatibility work.

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

Admission first creates or replays through the transaction-scoped PostgreSQL repository. If the same `Idempotency-Key` is replayed by the same authenticated owner scope with the same body after acceptance, the route returns `202` with the original `run_id`, even if runtime readiness later turns false. The same owner scope and key with a different body returns `409 idempotency_conflict`. The same key used by a different authenticated owner scope is independent work, not a conflict. The real PostgreSQL 16 lane uses an admission `pg.Pool` with max 2 and a separate reader pool with max 2; it proves committed visibility, replay, owner isolation, and the forced same-key unique race.

## Get

```http
GET /api/v1/runs/{run_id}
Authorization: Bearer configured-token
```

```json
{
  "run_id": "uuid",
  "status": "succeeded",
  "runtime": {
    "provider": "opencode",
    "model": "opencode/deepseek-v4-flash-free"
  },
  "result": { "text": "BASELINE_OK" },
  "usage": { "input_tokens": 20, "output_tokens": 4 },
  "error": null,
  "created_at": "2026-07-22T00:00:00.000Z",
  "updated_at": "2026-07-22T00:00:01.000Z"
}
```

Status is `queued|running|waiting_children|succeeded|failed|timed_out|cancelled`. `waiting_children` is reserved for a Run paused on durable child work; Agent Teams v2 uses canonical child Runs for bounded Lead turns, Work attempts, and addressed continuations. Runtime/result/usage/error are nullable. The prompt is never returned. Reads are owner-scoped to the authenticated service account binding; mismatched owner scope returns `404 run_not_found`. Runtime failures use stable codes and safe messages.

## Events and cancellation (minimum Phase D)

`GET /api/v1/runs/{run_id}/events?after=0` returns `{ "events": [...], "next_cursor": number|null }`. Each event has a decimal sequence-string `id`, `run_id`, integer `sequence`, one of `started|output|succeeded|failed|cancelled`, a safe JSON payload, and ISO `created_at`. Prompts, credentials, local paths, provider wire objects, raw provider errors, and model-selection details are not event payloads.

`GET /api/v1/runs/{run_id}/events/stream` is authenticated SSE. It accepts a query cursor or `Last-Event-ID`, replays committed events in order, polls the database, and closes after a terminal event. This is a single-node polling baseline, not a production pub/sub or disconnect-recovery guarantee.

`POST /api/v1/tasks/{task_id}:cancel` returns `{task_id, run_id, status}`, where status is `cancellation_requested|cancelled|terminal`. Queued work terminalizes locally; active work records the request before forwarding one idempotent runtime cancel. Foreign or missing Tasks are hidden with `404`.

If runtime execution succeeds but terminal persistence fails, the application raises the typed `RunCompletionPersistenceError` and creates a safe `RuntimeExecutionReceipt` only in memory. The dispatcher catches the exception and emits a sanitized structured log; there is no durable receipt, operator retrieval, or reconciliation, and the Run may remain `running` until later recovery. This is not reported as `runtime_execution_failed`. Durable receipt storage and a reconciler remain deferred to later recovery work.

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

Relevant codes are `unauthorized`, `invalid_json`, `invalid_request`, `request_too_large`, `runtime_unavailable`, `idempotency_conflict`, `run_not_found`, `route_not_found`, and `internal_error`.

## Relationship to the Task API

`/api/v1/tasks:invoke` is now the canonical public invocation route and returns `task_id` plus Task read links. `/api/v1/runs` is preserved for compatibility callers that still submit prompt-only work and poll by `run_id`. Both paths share the same owner-scoped admission model and persist the same canonical Task/Run state underneath. Compatibility-admitted root Tasks use a reserved UUID invokable-version sentinel so the stored Task shape remains representable by the Task API contract.

Team callers invoke through `/api/v1/tasks:invoke` and inspect the Task tree,
status, and owner-scoped TeamRun reads. Agent Teams v2's TeamDriver materializes
bounded child Runs for Lead turns, Work attempts, and addressed continuations.
Crash recovery, restart/resume, retries, and cancellation propagation are not
claimed.
