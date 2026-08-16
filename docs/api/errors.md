# Developer API: Errors

Developer API errors follow the existing Agent Server safe HTTP envelope. Internal database, Team, Task, RuntimeSession, Paseo, stack, and provider transport details are not returned as authoring diagnostics.

## Request errors

Malformed JSON, missing required request fields, invalid path UUIDs, or unsupported query parameters return `400 invalid_request` (or a more specific existing safe list/cursor code).

## Definition authoring diagnostics

`validate`, `plan`, and `apply` return source-oriented diagnostics for invalid author intent:

```json
{
  "valid": false,
  "diagnostics": [
    {
      "path": "$.spec.agent_version_id",
      "code": "invalid_reference",
      "message": "Referenced Agent version was not found or is not published in this owner scope.",
      "severity": "error"
    }
  ]
}
```

Typical statuses/codes:

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `invalid_request` | malformed request envelope/path |
| 409 | `idempotency_conflict` | apply key reused with a different source |
| 404 | `work_definition_not_found` | owner-safe Definition/Version miss |
| 422 | diagnostic code | invalid Work Definition source or immutable reference |

## Run input

A Product WorkRun input that does not satisfy its immutable Definition contract returns:

```json
{
  "error": {
    "code": "input_validation_failed",
    "message": "The WorkRun input does not match the Work Definition input schema.",
    "request_id": "...",
    "path": "$.input.symbol"
  }
}
```

The provider is not invoked on this failure path.

## Owner-safe reads

Product Definition/Work reads preserve the existing owner/workspace boundary. A resource outside the authenticated scope is surfaced as an ordinary not-found condition; the API does not reveal another owner’s resource metadata.

## Retry guidance

- validation/reference errors: correct the author source; do not blindly retry;
- apply transport failure: retry with the **same** `Idempotency-Key` and exact source;
- idempotency conflict: use a new key only if the caller intentionally submits different source;
- run input failure: correct the Product input before starting another run;
- runtime terminal failures: inspect Product state and Run Trace rather than guessing from transport status.
