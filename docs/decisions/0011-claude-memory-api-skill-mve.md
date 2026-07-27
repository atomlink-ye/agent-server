# ADR 0011: API-first immutable Memory resources and built-in API Skill

- **Status:** Accepted for the MVE; future canonical direction
- **Date:** 2026-07-27
- **Supersedes:** ADR 0006 for the future Memory resource API

## Decision

Adopt a PostgreSQL-backed hierarchy of Product Workspace → Memory Store →
stable Memory → immutable Memory Version. The management API is authenticated
with existing service-account bearer access and derives tenant/principal scope
from the authenticated context. Product Workspace ownership is checked by
requested UUID plus exact tenant/principal ownership.

Memory content is replaced by SHA-256 compare-and-swap. A stale precondition is
a conflict; identical content is a no-op; a revert appends a new immutable
Version. PostgreSQL owns the canonical content and enforces the current-pointer,
Version-shape, byte-size, and immutability invariants.

The server-owned `agent-server/memory-api` Skill is resolved from the built-in
catalog and included only in native create-time Runtime Bootstrap. It documents
the API and safe authorization boundary. It does not grant an Agent HTTP
execution capability.

## Compatibility boundary

ADR 0006 and the proposal/review, accepted-entry snapshot, and Lark paths remain
implemented legacy compatibility during this MVE. They are not deleted, migrated
automatically, or authority for the new Store/Memory/Version API. Physical
cleanup and writer/read cutover require a separate retention and rollout
decision.

## Deferred work

CLI, MCP/native HTTP tools, scoped Runtime credentials/capabilities, Session
resource attachment, public Version history/redaction/rollback, archive/delete,
path rename, filesystem projection, retrieval, vector search, and a Skills
marketplace remain deferred.

## Evidence

Fresh PostgreSQL migration/reapply, API CAS/no-op/revert/owner-isolation
evidence, immutable-row inspection, and a real Paseo/OpenCode managed-Agent
Skill-loading journey are recorded in the [MVE evidence packet](../evidence/claude-memory-api-skill-mve-evidence-packet.md).
