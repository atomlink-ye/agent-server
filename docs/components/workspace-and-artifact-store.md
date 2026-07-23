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

Phase E extends the Product Workspace path with one workspace-owned immutable
entry per accepted proposal, monotonic immutable snapshots, deterministic
`MEMORY.md` rendering, a manifest and SHA-256 content hash, and authenticated
entry/snapshot/detail/rebuild routes. Local projection verifies both files before
atomic publication; public responses never expose the configured local path.
Legacy principal-private entries remain on the prior routes and are excluded
from Product Workspace snapshots.

Accepted entries are records of reviewed memory, not an implemented retrieval system. No embedding generation, vector search, ranking, context assembly, runtime prompt injection, or automatic agent recall happens in this component yet. Owner scope remains derived from configured service-account bindings until user identity and shared Workspace ACLs land.

## V1 filesystem boundary

Each leaf Run receives read-only input snapshots and a Run-scoped writable scratch/candidate area. It cannot see another tenant, sibling mutable directory, host socket, control database credential, vault token, cloud metadata credential, or raw user token. Joins read registered child output, not arbitrary sibling files.

## Artifact responsibilities

- Store immutable candidate, partial, and final Artifact versions.
- Register files, sources, evidence, producer Invokable version, Task, Run, and node path.
- Finalize by creating a new version and series event, never by mutating an old manifest.
- Preserve root Team lineage through child retries and supersession.
- Authorize every preview and download before generating a short-lived URL or stream.

Artifact processing outside a worker uses a separate service capability and frozen input; it cannot forge a worker activation or change Run state.
