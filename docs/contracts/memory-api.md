# Memory Store / Memory API contract

This is the canonical API-first Memory resource contract for the MVE. It is
separate from the legacy proposal, accepted-entry, snapshot, and Lark routes.
All routes require an enabled service-account bearer token. The effective tenant
and principal come from authentication; callers cannot choose them.

## Resources and scope

The resource hierarchy is:

```text
Product Workspace → Memory Store → stable Memory → immutable Memory Version
```

Store creation and listing use the requested Product Workspace UUID. The server
verifies that Workspace belongs to the authenticated tenant and principal. Read
and Memory operations scope the stable Store ID through the authenticated tenant
and principal; a foreign or missing resource is indistinguishable and returns
`404 not_found`.

## Store routes

| Method | Path                                        | Success |
| ------ | ------------------------------------------- | ------- |
| `POST` | `/api/v1/memory-stores`                     | `201`   |
| `GET`  | `/api/v1/memory-stores?workspace_id=<uuid>` | `200`   |
| `GET`  | `/api/v1/memory-stores/{memory_store_id}`   | `200`   |

Create accepts exactly:

```json
{
  "workspace_id": "uuid",
  "name": "Primary memory",
  "description": "Accepted project context"
}
```

`name` is required, trimmed, and 1–255 characters. `description` is optional
and is limited to 4096 characters. Unknown fields are rejected. Store IDs are
stable UUIDs; Store metadata is otherwise immutable in this MVE.

Successful create/read responses use `{ "memory_store": ... }`; list uses
`{ "memory_stores": [...] }`:

```json
{
  "memory_store": {
    "memory_store_id": "uuid",
    "workspace_id": "uuid",
    "name": "Primary memory",
    "description": "Accepted project context",
    "created_at": "2026-07-27T00:00:00.000Z",
    "updated_at": "2026-07-27T00:00:00.000Z"
  }
}
```

## Memory routes

| Method | Path                                                           | Success |
| ------ | -------------------------------------------------------------- | ------- |
| `POST` | `/api/v1/memory-stores/{memory_store_id}/memories`             | `201`   |
| `GET`  | `/api/v1/memory-stores/{memory_store_id}/memories`             | `200`   |
| `GET`  | `/api/v1/memory-stores/{memory_store_id}/memories/{memory_id}` | `200`   |
| `POST` | `/api/v1/memory-stores/{memory_store_id}/memories/{memory_id}` | `200`   |

Create accepts exactly:

```json
{ "path": "project/context.md", "content": "Project context." }
```

Update accepts exactly:

```json
{
  "content": "Replacement context.",
  "precondition": {
    "type": "content_sha256",
    "content_sha256": "<64 lowercase hexadecimal characters>"
  }
}
```

Responses are flat current-Version representations inside a `memory` wrapper:

```json
{
  "memory": {
    "memory_id": "uuid",
    "memory_store_id": "uuid",
    "path": "project/context.md",
    "memory_version_id": "uuid",
    "version": 1,
    "content_sha256": "<64 lowercase hexadecimal characters>",
    "content_size_bytes": 16,
    "content": "Project context.",
    "created_at": "2026-07-27T00:00:00.000Z",
    "updated_at": "2026-07-27T00:00:00.000Z"
  }
}
```

List uses `{ "memories": [...] }`. There are no public Version history,
redaction, rollback, archive, delete, or path-rename routes in this MVE.

## Invariants and limits

- Paths are normalized relative POSIX paths, at most 512 characters. Absolute
  paths, backslashes, NUL, empty segments, `.` segments, and `..` segments are
  rejected.
- Content is non-empty UTF-8 text and at most 65,536 bytes. NUL and unpaired
  UTF-16 surrogates are rejected; valid surrogate pairs are accepted.
- The bounded JSON request envelope is 70 KiB, while the independent content
  maximum remains 65,536 bytes.
- SHA-256 values are lowercase hexadecimal and sizes are UTF-8 byte sizes.
- Memory IDs remain stable. Each changed update appends one immutable Version
  with a monotonic number and predecessor; Version 1 is `created`, later
  Versions are `modified`.
- The current pointer is non-null, belongs to the same Memory, and is updated
  atomically with Version insertion under a row lock.
- A stale hash returns `409 memory_precondition_failed` without a new Version.
- Identical content is a successful no-op retaining the current Version ID.
- Reverting to older content is a new Version transition, not mutation of the
  historical Version.

PostgreSQL enforces the pointer relationship, operation/predecessor shape,
content byte size, and immutable Version rows. The migration's immutable
trigger is `memory_versions_immutable_trg` backed by
`prevent_memory_version_mutation()`.

## Errors and authentication

Errors use the common envelope with `error.code`, safe `error.message`, and
`request_id`. Relevant mappings are:

- `401 unauthorized` for missing or invalid service-account bearer auth;
- `400 invalid_request` for malformed UUIDs, strict-schema violations, invalid
  paths/content, malformed preconditions, or oversized content values;
- `404 not_found` for missing or foreign Workspaces, Stores, and Memories;
- `409 memory_path_conflict` for a duplicate `(memory_store_id, path)`;
- `409 memory_precondition_failed` for a stale content hash;
- `413 request_too_large` for a request envelope over 70 KiB.

Raw database errors, credentials, prompts, local paths, and provider errors are
not public responses or normal request evidence.

## Agent boundary

The built-in `agent-server/memory-api` Skill teaches this contract during
native create-time Runtime Bootstrap. The current MVE does **not** provide an
Agent-side HTTP client, CLI, MCP/native HTTP tool, scoped Runtime credential or
capability. A managed Agent may describe the API but must not invent
credentials or claim to have read or changed Memory without an authorized
client/tool.
