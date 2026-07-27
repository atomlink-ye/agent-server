---
name: agent-server/memory-api
description: Read and update authorized Agent Server Memory resources through the management API.
---

# Agent Server Memory API

Guidance marker: MEMORY_API_SKILL_V1

The Agent Server Memory API models a Product Workspace's Memory Store, stable
Memory resources, and immutable Memory Versions. Use the exact HTTP method and
path below when describing a request:

- Create a Store: `POST /api/v1/memory-stores` with `workspace_id`, `name`, and
  optional `description`.
- List Stores: `GET /api/v1/memory-stores?workspace_id=<uuid>`.
- Read a Store: `GET /api/v1/memory-stores/{memory_store_id}`.
- Create a Memory: `POST /api/v1/memory-stores/{memory_store_id}/memories`
  with relative POSIX `path` and non-empty UTF-8 `content`.
- List Memories: `GET /api/v1/memory-stores/{memory_store_id}/memories`.
- Read a Memory: `GET /api/v1/memory-stores/{memory_store_id}/memories/{memory_id}`.
- Replace a Memory: `POST /api/v1/memory-stores/{memory_store_id}/memories/{memory_id}`
  with `content` and a `precondition` of
  `{ "type": "content_sha256", "content_sha256": "<64 lowercase hexadecimal characters>" }`.

Updates use compare-and-swap. A stale hash returns `409 memory_precondition_failed`
and does not create a Version. Identical content is a successful no-op; a
different replacement creates a new immutable Version. Responses identify the
current Memory Version, monotonic version, SHA-256 hash, and content size.

Every call requires an authorized bearer supplied by approved tooling. Never
invent, request, expose, or echo credentials. If no authorized HTTP tool or
client is available, describe the exact request and its precondition, but do
not claim that the request executed or that Memory was read.
