# Work Definition API

Status: MVE / Slice A (`validate` only)

This contract is the first Product API authoring boundary for Composition-first Work. It intentionally exposes product intent and does not expose Agent/Environment/Team registry choreography.

## Author document

```yaml
apiVersion: agentserver.dev/v1alpha1
kind: WorkDefinition
metadata:
  name: earnings-research
  description: Earnings research work
spec:
  kind: single_agent
  agent_version_id: 11111111-1111-4111-8111-111111111111
  environment_version_id: 22222222-2222-4222-8222-222222222222
  memory_version_ids: []
```

`metadata.name` is currently required to already use lowercase kebab-case. Resource references are immutable version UUIDs. Collaboration uses `spec.kind: collaboration` plus `team_version_id` instead of `agent_version_id`.

## Validate

```http
POST /api/v1/work-definitions:validate
Authorization: Bearer <service-account-token>
Content-Type: application/json

{
  "source": "<YAML>"
}
```

Valid response:

```json
{
  "valid": true,
  "fingerprint": "sha256:...",
  "metadata": {
    "normalized_name": "earnings-research"
  },
  "diagnostics": []
}
```

Invalid author source returns `422` with path-aware diagnostics:

```json
{
  "valid": false,
  "diagnostics": [
    {
      "path": "$.spec.agent_version_id",
      "code": "invalid_invalid_format",
      "message": "must be a canonical UUID",
      "severity": "error"
    }
  ]
}
```

Malformed request envelopes remain normal `400 invalid_request` API errors.

## Semantics

Validation is deterministic and side-effect free. The fingerprint is computed from the canonical parsed author document rather than YAML formatting, so equivalent YAML produces the same fingerprint.

This endpoint validates only the authoring contract. It does **not** resolve whether referenced immutable Agent/Team/Environment/Memory versions exist. Resource resolution, convergence, immutable publication, and idempotency belong to the next `apply` slice.

## Non-goals for Slice A

- no Work Definition persistence;
- no registry materialization;
- no execution or provider call;
- no plan/resolve endpoint;
- no draft lifecycle;
- no OpenAPI/SDK generator.
