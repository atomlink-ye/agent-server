# Managed Workspace Memory Phase E

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
