# Work Definition API

Status: MVE Product API contract

This contract is the public authoring boundary for Composition-first Work. It exposes Product intent (`Definition -> Work -> Run`) and deliberately hides Agent Server registry choreography, internal Team materialization, Task, TeamRun, RuntimeSession, and provider identities.

## Author document

Single Agent:

```yaml
apiVersion: agentserver.dev/v1alpha1
kind: WorkDefinition
metadata:
  name: earnings-research
  description: Research one earnings event.
spec:
  kind: single_agent
  agent_version_id: 11111111-1111-4111-8111-111111111111
  environment_version_id: 22222222-2222-4222-8222-222222222222
  memory_version_ids: []
  input_schema:
    type: object
    properties:
      symbol:
        type: string
        min_length: 1
        max_length: 12
    required: [symbol]
    additional_properties: false
```

Bounded collaboration:

```yaml
apiVersion: agentserver.dev/v1alpha1
kind: WorkDefinition
metadata:
  name: investment-review
spec:
  kind: collaboration
  lead:
    name: lead
    agent_version_id: 11111111-1111-4111-8111-111111111111
  members:
    - name: risk
      agent_version_id: 33333333-3333-4333-8333-333333333333
  environment_version_id: 22222222-2222-4222-8222-222222222222
  memory_version_ids: []
  input_schema:
    type: object
    properties:
      question:
        type: string
    required: [question]
    additional_properties: false
```

The author never supplies a Team ID. For collaboration, `apply` materializes the immutable internal execution binding from the declared lead/member Agent versions. That Team lineage remains an implementation detail and is not a primary Product API field.

`metadata.name` uses lowercase kebab-case. Agent, Environment, and Memory references are immutable version UUIDs. The MVE input schema is deliberately bounded and JSON-Schema-like rather than claiming full JSON Schema support: object input with string/number/integer/boolean properties, required keys, simple bounds/enums, and `additional_properties`.

## Validate

```http
POST /api/v1/work-definitions:validate
Authorization: Bearer <service-account-token>
Content-Type: application/json

{"source":"<YAML>"}
```

Validation is side-effect free. It performs no registry write, Work/Task creation, or provider execution.

```json
{
  "valid": true,
  "fingerprint": "sha256:...",
  "metadata": { "normalized_name": "earnings-research" },
  "diagnostics": []
}
```

Invalid author source returns `422` with safe, source-oriented diagnostics:

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

The fingerprint is computed from canonical parsed author intent, not YAML whitespace or key formatting.

## Plan

```http
POST /api/v1/work-definitions:plan
Authorization: Bearer <service-account-token>
Content-Type: application/json

{"source":"<YAML>"}
```

`plan` is also side-effect free. It resolves immutable references and returns an author-facing summary of participants, Skills, domain Tools, Environment/Memory refs, required runtime capabilities, and platform capabilities. Missing/unpublished/cross-owner refs fail before `apply`.

It is not an execution DAG and does not create Team/Work/Task resources.

## Apply

```http
POST /api/v1/work-definitions:apply
Authorization: Bearer <service-account-token>
Idempotency-Key: <stable-client-key>
Content-Type: application/json

{"source":"<YAML>"}
```

Successful `apply` performs:

```text
validate
-> resolve immutable refs
-> materialize/converge internal collaboration binding when required
-> publish immutable WorkDefinitionVersion
-> resolve composition IR
-> persist resolved composition fingerprint
-> record idempotency result
```

Response:

```json
{
  "result": "created",
  "definition": {
    "id": "...",
    "normalized_name": "earnings-research",
    "description": "Research one earnings event.",
    "latest_version_id": "..."
  },
  "version": {
    "id": "...",
    "definition_id": "...",
    "status": "published",
    "fingerprint": "sha256:...",
    "source": {
      "apiVersion": "agentserver.dev/v1alpha1",
      "kind": "WorkDefinition",
      "metadata": {},
      "spec": {}
    },
    "resolved": { "resource_manifest_fingerprint": "sha256:..." }
  },
  "resolved": { "resource_manifest_fingerprint": "sha256:..." }
}
```

Semantics:

- same source + same `Idempotency-Key` -> `replayed`;
- same canonical source + another key -> `converged` to the same immutable version;
- changed author intent -> a new immutable version under the same Definition identity;
- reusing an idempotency key with a different source -> `409 idempotency_conflict`;
- published versions are immutable at the database boundary.

There is no Product draft/publish ceremony in the MVE. Successful apply publishes the immutable version directly.

## Reads

```http
GET /api/v1/work-definitions/{definition_id}
GET /api/v1/work-definitions/{definition_id}/versions?limit=20&cursor=...
GET /api/v1/work-definition-versions/{version_id}
```

Owner reads may return the normalized author source. Product responses do not return internal Team IDs, Task IDs, TeamRun IDs, RuntimeSession IDs, or provider transport data.

## DefinitionVersion -> Work -> Run

Create a durable Work from the immutable Product Definition version:

```http
POST /api/v1/works

{
  "definition_id": "<definition-id>",
  "definition_version_id": "<version-id>",
  "title": "Weekly earnings review"
}
```

Start a Run with typed input:

```http
POST /api/v1/works/{work_id}/runs

{
  "trigger_kind": "manual",
  "input": {"symbol": "AAPL"}
}
```

Before technical Task/provider admission the server:

1. loads the exact Product Definition version input contract;
2. validates the bounded object input;
3. persists an immutable input snapshot/fingerprint on the WorkRun;
4. renders a deterministic execution prompt for the participant;
5. pins the resolved composition manifest;
6. only then admits the technical Task.

Invalid input returns `422 input_validation_failed` with a safe source path and does not invoke the provider. The input snapshot is available for internal replay/debug but intentionally omitted from normal Product WorkRun responses.

## Observation

Use the existing Product projection endpoints:

```http
GET /api/v1/works/{work_id}/runs/{work_run_id}
GET /api/v1/works/{work_id}/runs/{work_run_id}/trace
```

The Product client should reason about Work/WorkRun/Product state. Technical Task/Run identities are limited to explicit `source_refs` for audit/debug.

## Explicit non-goals

- OIDC/SCIM or public SaaS user auth;
- arbitrary secret-management API;
- marketplace/registry sharing;
- webhook/schedule/trigger ecosystem;
- complete OpenAPI-generated multi-language SDKs;
- generalized DAG/nested Team/dynamic roster;
- production billing/quotas/multi-region;
- a second execution plane.
