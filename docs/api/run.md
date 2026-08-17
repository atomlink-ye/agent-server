# Developer API: Run

A Product `WorkRun` is one execution occurrence of a durable `Work`.

## Start

```http
POST /api/v1/works/{work_id}/runs
Authorization: Bearer <token>
Content-Type: application/json

{
  "trigger_kind": "manual",
  "input": {
    "symbol": "AAPL"
  }
}
```

For Product-authored Work Definitions, `input` is validated against the exact immutable Definition version that the Work references.

Before technical Task/provider admission, Agent Server:

```text
resolve exact Definition version
-> validate Product input
-> persist immutable WorkRun input snapshot/fingerprint
-> pin resolved composition manifest
-> render deterministic participant input
-> admit technical Task
```

Invalid input therefore fails before provider execution.

## Observe

```text
GET /api/v1/works/{work_id}/runs/{work_run_id}
GET /api/v1/works/{work_id}/runs/{work_run_id}/trace
```

Polling the Product projection is the canonical MVE observation path. A separate SSE surface is intentionally deferred because the current Web/SDK golden path can observe bounded runs through the existing product projection without creating a second event protocol.

## Input privacy

The exact input snapshot is persisted as an internal replay/debug fact. Normal Product WorkRun responses and list responses do not echo it. This avoids accidentally turning routine run reads into a sensitive-input exposure surface.

## Result and trace

The Product projection exposes the WorkRun state and result summary. Run Trace aggregates execution evidence and may expose technical IDs only under `source_refs`; clients must not use those IDs as Product routing or UI identity.
