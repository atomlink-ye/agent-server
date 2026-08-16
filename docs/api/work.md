# Developer API: Work

`Work` is the durable Product object created from one immutable `WorkDefinitionVersion`.

A caller should reason about:

```text
Definition = what the Work is
Work       = durable instance/objective
Run        = one execution occurrence
```

Technical Task, Run, TeamRun, MemberRun, RuntimeSession, and Paseo identities are not Product identity. They may appear only in explicit `source_refs` for audit/debug.

## Create

```http
POST /api/v1/works
Authorization: Bearer <token>
Content-Type: application/json

{
  "definition_id": "<definition-id>",
  "definition_version_id": "<immutable-version-id>",
  "title": "Weekly portfolio review"
}
```

The Definition version must be resolvable inside the authenticated owner/workspace scope. Product-authored single-Agent and bounded-collaboration Definitions use the same Work lifecycle.

## Read and list

```text
GET /api/v1/works
GET /api/v1/works/{work_id}
GET /api/v1/works/{work_id}/definition
GET /api/v1/works/{work_id}/runs
```

The Product projection remains the recommended read model for Web clients and SDK helpers.

## Start a Run

See [Run](run.md). The WorkRun pins the current immutable Definition version and its resolved resource manifest before provider execution is admitted.
