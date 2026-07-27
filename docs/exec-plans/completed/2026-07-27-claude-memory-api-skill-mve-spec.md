---
status: completed
owner: orchestrator
created_at: 2026-07-27
updated_at: 2026-07-27
authority: design-spec
---

# Claude-inspired Memory API and built-in Skill MVE — Design Spec

## Outcome

Provide the first canonical API-first Memory resource model:

```text
Product Workspace
  → Memory Store
    → stable Memory
      → immutable Memory Version
```

An authenticated caller can create a Store, create and read Memory V1, replace
the same Memory through SHA-256 compare-and-swap, and read Memory V2 while V1
remains immutable. A published managed Agent that references the built-in
`agent-server/memory-api` Skill receives the Skill body in its native Runtime
Bootstrap and can accurately describe how an authorized client should call the
API.

This MVE does not claim that the Agent can execute the HTTP request. CLI, native
tool/MCP registration, scoped Runtime credentials, and Session resource
attachment are separate follow-up work.

## Authority and stage

- Explicit user decision on 2026-07-27: prioritize the complete Claude Managed
  Agents Memory resource shape, implement the required API first, defer CLI, and
  add one loadable Skill that teaches managed Agents the API.
- Repository authority: `AGENTS.md`, `docs/features.md`, Components, Contracts,
  and the paired completed Exec Plan.
- External reference: Claude Managed Agents beta Memory Store, Memory, and
  immutable Memory Version model retrieved on 2026-07-27. Agent Server adapts
  the model to its explicit Product Workspace and Task/Run ownership model; it
  does not claim wire compatibility.
- Delivery stage: `Prove`. One real PostgreSQL/API path and one real
  Paseo/OpenCode Skill-loading path are primary evidence.

## Public management API

All routes require existing service-account bearer authentication. Effective
tenant and principal come from the authenticated access context. Foreign or
missing Product Workspace, Store, Memory, and Version resources use the same
safe `404` semantics.

### Memory Stores

```http
POST /api/v1/memory-stores
GET  /api/v1/memory-stores?workspace_id=<uuid>
GET  /api/v1/memory-stores/{memory_store_id}
```

Create request:

```json
{
  "workspace_id": "uuid",
  "name": "Primary memory",
  "description": "Accepted project context"
}
```

`name` is required and bounded to 255 characters. `description` is optional and
bounded to 4096 characters. Store IDs are stable UUIDs. Archive/delete and
metadata mutation are deferred.

### Memories

```http
POST /api/v1/memory-stores/{memory_store_id}/memories
GET  /api/v1/memory-stores/{memory_store_id}/memories
GET  /api/v1/memory-stores/{memory_store_id}/memories/{memory_id}
POST /api/v1/memory-stores/{memory_store_id}/memories/{memory_id}
```

Create request:

```json
{
  "path": "project/context.md",
  "content": "Project codename is MEMORY_MVE_V1."
}
```

Update request:

```json
{
  "content": "Project codename is MEMORY_MVE_V2.",
  "precondition": {
    "type": "content_sha256",
    "content_sha256": "<64 lowercase hexadecimal characters>"
  }
}
```

Rules:

- `path` is a normalized relative POSIX path and immutable in this MVE;
- reject absolute paths, empty or `.`/`..` segments, backslashes, NUL, and paths
  longer than 512 characters;
- path uniqueness is bytewise within one Store;
- content is non-empty UTF-8 text, bounded to 64 KiB;
- Memory ID is stable while every non-no-op replacement appends one immutable
  Version;
- update takes a row lock and compares the current content SHA-256;
- stale precondition returns `409 memory_precondition_failed` without creating a
  Version;
- identical content is a successful no-op returning the current representation;
- reverting to old content creates a new Version because it is a new state
  transition;
- responses expose current `memory_version_id`, monotonic version,
  `content_sha256`, and `content_size_bytes`.

Public Version history/list/redact routes are deferred. The durable Version
model is implemented now because it is required for correct create/update
semantics and evidence.

## Durable model

Migration `0017_claude_memory_api_skill_mve.sql` adds:

### `memory_stores`

- stable UUID `id`;
- exact `tenant_id`, Product `workspace_id`, `principal_type`, `principal_id`;
- `name`, optional `description`, timestamps;
- composite foreign key to the exact owned Product Workspace.

### `memories`

- stable UUID `id`;
- `memory_store_id`;
- normalized immutable `path`;
- non-null preallocated `current_version_id`; creation inserts the Version ID
  into the Memory row before inserting the Version and relies on the deferred
  composite same-Memory foreign key until transaction commit;
- timestamps;
- unique `(memory_store_id, path)`.

### `memory_versions`

- stable UUID `id`;
- `memory_id`;
- monotonic positive `version`;
- immutable `content`, `content_sha256`, `content_size_bytes`;
- operation `created | modified`;
- optional `previous_version_id`;
- timestamp;
- unique `(memory_id, version)` and a composite relationship proving the
  Memory's current pointer refers to its own Version.

PostgreSQL content is canonical. This MVE does not create a filesystem
projection or reuse the old accepted-entry snapshot tables.

## Application boundaries

- New `MemoryApiRepository` owns Store/Memory/Version persistence.
- Focused use cases expose create/list/get/update behavior without introducing a
  generic Resource Kernel.
- Route schemas use the shared bounded JSON reader and strict Zod contracts.
- Repository queries always join the Store to the authenticated exact owner
  scope before returning or mutating a Memory.
- CAS update and Version append occur in one database transaction.

## Built-in Skill

The canonical Skill artifact is:

```text
skills/agent-server-memory-api/SKILL.md
```

Managed Agent packages already persist `spec.skills[].ref`. The only supported
built-in reference in this MVE is:

```text
agent-server/memory-api
```

At published AgentVersion resolution:

1. retain the persisted Skill references;
2. resolve this exact server-owned reference from the repository Skill file;
3. reject an unknown built-in Skill reference at execution resolution instead
   of silently claiming it loaded;
4. add the resolved Skill body to native create-time Runtime Bootstrap after the
   platform contract and published Agent instructions;
5. do not resend Skill content on continuation.

The Skill documents the management API and safe auth boundary. It explicitly
instructs the Agent not to invent credentials or claim it read Memory when no
authorized HTTP tool/client is available. The real Runtime MVE asks the Agent to
state the exact method/path/precondition contract; it does not ask the Agent to
execute an unavailable tool.

## Legacy Memory boundary

The new API is the canonical future Memory resource model. The proposal/review,
accepted-entry snapshot, Lark Card/Doc, and prompt-injected `MEMORY.md` path is
legacy.

MVE-first stop rule: do not spend the API/Skill slice physically deleting old
migrations, tables, evidence, or Lark code. Do not migrate old accepted entries
automatically. The old path remains present but is not implementation authority
for this API. Full writer/read cutover and destructive cleanup require their own
observed main flow and retention decision.

## Real acceptance path

### API/PostgreSQL

1. Start against a fresh real PostgreSQL 16 database.
2. Create an owner-scoped Product Workspace.
3. Create a Memory Store.
4. Create Memory V1 with a unique nonce.
5. Read V1 and record Store ID, stable Memory ID, Version 1 ID, version number,
   content hash, and size.
6. Replace the same Memory with V2 using V1's hash precondition.
7. Read V2 and prove stable Memory ID plus a new Version ID/hash.
8. Directly inspect PostgreSQL to prove V1 remains immutable and the current
   pointer references V2.
9. Attempt a different update with stale V1 hash and observe `409` with no extra
   Version.
10. Use a foreign service-account scope and observe hidden `404` without a row
    change.

### Skill/Runtime

1. Import and publish one managed Agent package referencing
   `agent-server/memory-api`.
2. Create a Fresh ProductSession with that AgentVersion.
3. Submit one task asking for the exact authenticated Memory read endpoint and
   update precondition format defined only in the Skill.
4. Observe one real Paseo/OpenCode Agent result containing the exact API
   contract and an explicit statement that credentials must be supplied by an
   authorized tool/client.
5. Inspect the provider timeline and durable Task/Run/assistant Message while
   keeping the Skill body and credentials out of ordinary evidence.

## Non-goals

- No CLI, MCP, native HTTP tool, scoped Runtime capability, or Agent-side API
  execution.
- No Session `resources[]` attachment in this slice.
- No Agent `read_write` Memory.
- No public Version history, redaction, rollback, archive, delete, path rename,
  multiple-store composition, or live-session update visibility.
- No filesystem mount/projection, RAG, vector search, Dreams, curation, search,
  retention/GC, multi-node, crash recovery, or production rollout.
- No Skills marketplace, dynamic URL/filesystem Skill references, Skill API, or
  plugin framework.
- No new unit, contract, integration, deterministic E2E, fixture, or evaluation
  cases unless separately requested.

## Stop rules

- Stop on any owner-scope leak, CAS lost update, mutable Version, unsafe path,
  raw credential/prompt exposure, or inability to prove Skill loading.
- If real OpenCode output cannot distinguish loaded Skill guidance from model
  guesswork, strengthen only the evidence prompt/unique marker; do not build CLI
  or tool execution in this slice.
- If existing legacy Memory behavior blocks the new API or Skill path, disable
  only the blocking wiring and record the remainder as deferred cleanup.
