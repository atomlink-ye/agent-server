# Workspace and Artifact Store component

## Product Workspace

A Product Workspace is a long-lived research boundary containing members, source snapshots, context, files, memory proposals, Artifact series, and sensitivity policy. It is not the same object as a Paseo Workspace, although an execution placement may bind a scoped directory to one.

## Baseline state

Local scripts create an ignored `.local/agent-workspace` or per-smoke directory. The Paseo adapter opens it once and reuses the returned Workspace ID. It contains no product ACL, source snapshot, Artifact manifest, retrieval index, or runtime-readable agent memory.

This phase adds a narrow durable workspace-memory governance baseline in PostgreSQL:

- create and list owner-scoped memory proposals;
- retain optional `source_task_id` and `source_session_id` provenance;
- review pending proposals as `accept`, `edit_and_accept`, or `reject`;
- materialize accepted proposals into accepted memory entries;
- list accepted entries for the authenticated owner scope.

## API-first Memory resource MVE

The canonical future Memory direction is now the PostgreSQL-backed
`Product Workspace → Memory Store → stable Memory → immutable Memory Version`
model. The authenticated Store/Memory API verifies exact tenant/principal
ownership, supports normalized relative paths, UTF-8 content up to 65,536 bytes,
and uses atomic SHA-256 compare-and-swap updates. Identical content is a no-op;
reverts append a new immutable Version. PostgreSQL enforces the current pointer,
Version predecessor/operation shape, byte size, and Version immutability.

The built-in `agent-server/memory-api` Skill is API guidance loaded into native
create-time Runtime Bootstrap. It does not provide an Agent HTTP client or
credentials. CLI, MCP/native HTTP, Session resource attachment, public Version
history, and filesystem projection remain deferred.

Phase E extends the Product Workspace path with one workspace-owned immutable
entry per accepted proposal, monotonic immutable snapshots, deterministic
`MEMORY.md` rendering, a manifest and SHA-256 content hash, and authenticated
entry/snapshot/detail/rebuild routes. Local projection verifies both files before
atomic publication; public responses never expose the configured local path.
Legacy principal-private entries remain on the prior routes and are excluded
from Product Workspace snapshots.

The proposal/review, accepted-entry snapshot, and Lark paths remain implemented
legacy compatibility. They are not authority for the new Store/Memory/Version
API and are not physically removed in this MVE.

Phase F consumes only a pinned ready snapshot. A Fresh ProductSession uses an
explicit published AgentVersion; its first admitted Task stores the selected
snapshot ID and hash. Execution verifies that exact local projection and builds
the minimum context in order: fixed runtime header, published instructions,
current Task input, then pinned `MEMORY.md`. No previous session history or
Workspace scan is read, and the final assistant Message is persisted. Missing
or mismatched pinned content fails closed without latest-snapshot substitution
or local-path exposure.

Accepted entries are records of reviewed memory, not an implemented retrieval system. No embedding generation, vector search, ranking, context assembly, runtime prompt injection, or automatic agent recall happens in this component yet. Owner scope remains derived from configured service-account bindings until user identity and shared Workspace ACLs land.

Phase G adds a default-off deterministic policy boundary. `disabled` persists
nothing, `proposal` delegates to the unchanged manual proposal path, and
`auto_safe` can accept only the exact category allowlist and trusted source
kinds when every conservative predicate passes. Secret/PII/action/instruction,
conflict, untrusted, and uncertain candidates fail closed. Policy traces carry
only mode, decision, category, source, reason codes, and policy version. The
gardener emits duplicate, supersession, and explicit-expiry suggestions only;
it never mutates entries, snapshots, or history.

## V1 filesystem boundary

Each leaf Run receives read-only input snapshots and a Run-scoped writable scratch/candidate area. It cannot see another tenant, sibling mutable directory, host socket, control database credential, vault token, cloud metadata credential, or raw user token. Joins read registered child output, not arbitrary sibling files.

## Artifact responsibilities

- Store immutable candidate, partial, and final Artifact versions.
- Register files, sources, evidence, producer Invokable version, Task, Run, and node path.
- Finalize by creating a new version and series event, never by mutating an old manifest.
- Preserve root Team lineage through child retries and supersession.
- Authorize every preview and download before generating a short-lived URL or stream.

Artifact processing outside a worker uses a separate service capability and frozen input; it cannot forge a worker activation or change Run state.
