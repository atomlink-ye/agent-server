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

## Deterministic policy minimum

The memory policy modes are `disabled` (the default), `proposal`, and
`auto_safe`. The manual proposal/review HTTP routes remain unchanged. Auto-safe
uses only `terminology`, `output_preference`, `project_constraint`, and
`confirmed_workflow_procedure`, with `current_user_message` or
`structured_system` sources; `untrusted` and `unknown` fail closed. Secret/key,
PII, sensitive action, instruction-marker, conflict, and uncertain candidates
are rejected conservatively. The safe decision trace contains only `mode`,
`decision`, `category`, `source`, `reasonCodes`, and `policyVersion`.

The proposal-only gardener suggests exact normalized duplicates,
same-category supersession candidates, and explicit expiry metadata. It never
mutates durable memory or snapshot history. Auto-safe is not enabled by this
minimum and no model-based gardening is provided.

## Lark command/Card/Doc review compatibility boundary

The fixed Lark canary is an adapter over this canonical state machine, not a
second Memory store. A successful source Run may produce one review notification.
Verified Card callbacks, Bot-owned Doc controls, and Thread commands authorize
the existing proposal review. For long proposals, the Doc body is the editable
draft; unresolved comments/replies are read, synthesized into one immutable
Preview/hash, and a separate `Accept Preview` accepts exactly that persisted
content. Resolved comments are not active instructions, incomplete reads fail
closed, and raw comments/replies are not durably retained. Thread command remains
the fallback, and success is reported only after the ready snapshot is
hash-verified. The fixed compatibility tuple is not canonical Lark identity or
production readiness. Preview successor lease fencing, retry/fencing races,
multi-node, crash recovery, and performance hardening remain deferred to Task 14.
