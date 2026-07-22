# Workspace and Artifact Store component

## Product Workspace

A Product Workspace is a long-lived research boundary containing members, source snapshots, context, files, memory proposals, Artifact series, and sensitivity policy. It is not the same object as a Paseo Workspace, although an execution placement may bind a scoped directory to one.

## Baseline state

Local scripts create an ignored `.local/agent-workspace` or per-smoke directory. The Paseo adapter opens it once and reuses the returned Workspace ID. It contains no product ACL, source snapshot, Artifact manifest, or durable memory.

## V1 filesystem boundary

Each leaf Run receives read-only input snapshots and a Run-scoped writable scratch/candidate area. It cannot see another tenant, sibling mutable directory, host socket, control database credential, vault token, cloud metadata credential, or raw user token. Joins read registered child output, not arbitrary sibling files.

## Artifact responsibilities

- Store immutable candidate, partial, and final Artifact versions.
- Register files, sources, evidence, producer Invokable version, Task, Run, and node path.
- Finalize by creating a new version and series event, never by mutating an old manifest.
- Preserve root Team lineage through child retries and supersession.
- Authorize every preview and download before generating a short-lived URL or stream.

Artifact processing outside a worker uses a separate service capability and frozen input; it cannot forge a worker activation or change Run state.
