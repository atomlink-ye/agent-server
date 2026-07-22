# ADR 0004: Authenticated service-account admission boundary

- Status: accepted
- Date: 2026-07-22

## Context

Durable Kernel A made Task/Run admission persistent but left the compatibility API fully anonymous. The repository roadmap places tenant, identity, Workspace ACL, service accounts, audit, and credential control in Phase 2. The control-plane and security docs also forbid an identity placeholder that appears secure without real enforcement.

The first Phase 2 slice needs to create a real ingress boundary without prematurely claiming end-user OIDC, credential broker, approval, or execution-isolation support.

## Decision

The first identity-control implementation authenticates the existing `/api/v1/runs` compatibility API with bearer tokens that map to configured service-account bindings. The server, not the caller, resolves authoritative `tenantId`, `workspaceId`, `principalType`, `principalId`, and `policySnapshotVersion` from that binding.

Root Task admission persists those resolved facts. Idempotency is scoped by `(ingress, tenantId, workspaceId, principalType, principalId, idempotencyKey)` and explicitly does not include `policyVersion`. Run reads are owner-scoped by exact match on `(tenantId, workspaceId, principalType, principalId)` so a caller outside the stored scope receives the same not-found response shape as an absent run.

Phase 2A keeps the current prompt-only request body and does not let the caller choose tenant, effective principal, or workspace. It also does not introduce OIDC users, credential brokering, approvals, public Task APIs, or execution-cell isolation.

## Consequences

The compatibility API becomes an authenticated API and gains one generic `401 unauthorized` behavior for missing, malformed, unknown, or disabled bearer tokens. Persisted Task/admission data now carries control-plane identity snapshot facts needed for later policy and audit expansion. This remains bootstrap ingress enforcement, not a durable identity registry, token lifecycle system, audit subsystem, or enterprise-safe credential/execution isolation story. Customer data and production credentials remain out of scope until later Phase 2 work lands.
