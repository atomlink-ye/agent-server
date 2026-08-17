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
GET /api/v1/works?order=updated_desc&limit=100
GET /api/v1/works/{work_id}
GET /api/v1/works/{work_id}/runs
GET /api/v1/works/{work_id}/runs?order=created_desc&limit=100
```

Omitting `order` preserves the original compatibility ordering. Work-first consumers should request `updated_desc` for Work and `created_desc` for WorkRun so the first page is latest-first without scanning the entire history. Pagination remains cursor/seek based; pass `next_cursor` back as `cursor` with the same ordering.

To read the exact Definition used by a current or historical WorkRun, use its `definition_version_id` with:

```text
GET /api/v1/work-definition-versions/{definition_version_id}
```

`GET /api/v1/works/{work_id}/definition` is retained as a compatibility-only Team-shaped read and is not the canonical Product Definition contract.

The Product projection remains the recommended read model for Web clients and SDK helpers.

## Start a Run

See [Run](run.md). The WorkRun pins the current immutable Definition version and its resolved resource manifest before provider execution is admitted.
