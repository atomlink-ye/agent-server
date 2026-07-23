# Managed Workspace Memory Phase E/F minimum

Accepted proposals create one immutable workspace-owned entry. Entries render in
`accepted_at ASC, entry_id ASC` order into canonical `MEMORY.md`; snapshot
versions are monotonic per tenant/workspace. Each snapshot also stores a stable
manifest and SHA-256 rendered-content hash. Local projection writes a temporary
directory, verifies the hash, atomically renames it, and only then updates the
`latest-ready` pointer. Projection failures remain `failed` and publish no
ready pointer.

The routes are authenticated with the existing service-account contract:

- `GET /api/v1/workspace-memory/proposals/:proposalId`
- `GET /api/v1/workspaces/:workspaceId/memory/entries`
- `GET /api/v1/workspaces/:workspaceId/memory/snapshots`
- `GET /api/v1/workspaces/:workspaceId/memory/snapshots/:snapshotId`
- `POST /api/v1/workspaces/:workspaceId/memory/snapshots:rebuild`

Foreign workspace requests are hidden as `404`; missing credentials return
`401`. Legacy principal-private entries are not included in these snapshots.

The public API exposes entry and snapshot identifiers, hashes, versions, and
projection status only. It never exposes the configured local filesystem root.
Legacy principal-private proposal and entry routes remain separate and are not
included in these workspace snapshots.

## Fresh Session minimum

`POST /api/v1/sessions` creates a Fresh ProductSession for an owner-visible
Workspace and an explicitly published AgentVersion. On the first message,
admission selects the latest ready snapshot for that tenant and Product
Workspace and stores its exact snapshot ID and content hash on the durable Task.
Execution never re-resolves the latest snapshot. It reads the pinned snapshot
through verified local FileStore access; missing files or ID/hash/content
mismatches fail closed without exposing a local path or substituting a newer
snapshot.

The implemented minimum context order is exactly:

1. fixed runtime contract header;
2. published AgentVersion instructions;
3. current Task input;
4. pinned verified `MEMORY.md`, when present.

No old ProductSession history, full Workspace scan, embeddings/RAG, tool or
skill summaries, or provider-native mount is part of this contract. A
successful run persists the final assistant Message in the ProductSession.
