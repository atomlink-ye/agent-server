# Developer API: Errors

Developer API errors follow the existing Agent Server safe HTTP envelope. Internal database, Team, Task, RuntimeSession, Paseo, stack, and provider transport details are not returned as authoring diagnostics.

## Stable error codes

This API uses one consistent set of error codes. The table below is the canonical reference; any code not listed here is an internal or transport-layer detail that may change without notice.

| HTTP | Code                        | Meaning                                                                                                  |
| ---- | --------------------------- | -------------------------------------------------------------------------------------------------------- |
| 400  | `invalid_request`           | malformed request envelope, path, or unsupported parameters                                              |
| 409  | `idempotency_conflict`      | apply key reused with a different source                                                                 |
| 404  | `work_definition_not_found` | owner-safe Definition or Version miss                                                                    |
| 422  | `invalid_definition`        | Work Definition source fails structural validation                                                       |
| 422  | `invalid_reference`         | a referenced resource (Agent, Environment, Memory) was not found or is not published in this owner scope |
| 422  | `input_validation_failed`   | WorkRun input does not satisfy the immutable Definition input schema                                     |
| 404  | `work_not_found`            | Work resource not found or outside the authenticated owner scope                                         |
| 404  | `work_run_not_found`        | WorkRun resource not found                                                                               |
| 503  | `projection_unavailable`    | product projection is temporarily unavailable                                                            |

### Roadmap §9 code mapping

Roadmap §9 names four additional codes. This implementation covers their semantics with the codes above:

| Roadmap code             | Covered by                                                            | Notes                                                                                                  |
| ------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `resource_not_found`     | `work_definition_not_found` / `work_not_found` / `work_run_not_found` | each resource kind has its own specific not-found code                                                 |
| `resource_not_published` | `invalid_reference`                                                   | a referenced resource that exists but is not published triggers an authoring diagnostic with this code |
| `unsupported_capability` | `invalid_request`                                                     | requests for capabilities not supported in this API version return `400 invalid_request`               |
| `execution_unavailable`  | `projection_unavailable`                                              | transient execution-plane unavailability surfaces as `503 projection_unavailable`                      |

Do not use the roadmap code names in client code; use the codes in the stable table.

## Request errors

Malformed JSON, missing required request fields, invalid path UUIDs, or unsupported query parameters return `400 invalid_request`.

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

Product Definition/Work reads preserve the existing owner/workspace boundary. A resource outside the authenticated scope is surfaced as an ordinary not-found condition; the API does not reveal another owner's resource metadata.

## Retry guidance

- validation/reference errors: correct the author source; do not blindly retry;
- apply transport failure: retry with the **same** `Idempotency-Key` and exact source;
- idempotency conflict: use a new key only if the caller intentionally submits different source;
- run input failure: correct the Product input before starting another run;
- runtime terminal failures: inspect Product state and Run Trace rather than guessing from transport status.
