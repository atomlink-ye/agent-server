# Health API contract

## Liveness

```http
GET /health/live
```

Returns `200` when the HTTP process can serve requests:

```json
{ "status": "ok", "service": "agent-server", "version": "0.1.0" }
```

Liveness does not call Paseo or a model and must not fail because a dependency is unavailable.

## Readiness

```http
GET /health/ready
```

The baseline requires three checks: `paseo_websocket`, `paseo_workspace`, and `opencode_model`. All ready returns `200`; any failure returns `503`.

```json
{
  "status": "not_ready",
  "service": "agent-server",
  "checks": [
    {
      "name": "paseo_websocket",
      "status": "not_ready",
      "detail": "safe diagnostic"
    },
    { "name": "paseo_workspace", "status": "not_ready" },
    { "name": "opencode_model", "status": "not_ready" }
  ]
}
```

Details must not contain credentials, prompts, private file content, or raw provider responses. Readiness reports cached initialization state; startup attempts initialization asynchronously so the HTTP process can still expose diagnostics.
