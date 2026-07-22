# Credential and Tool Gateway component

## Purpose

The gateway converts a model-requested Tool Operation into an authorized, auditable, secret-safe call. Agents reference Tool and Credential Profiles; they never receive raw tokens or enumerate credentials.

## V1 responsibilities

- Validate the workload capability audience, tenant, Task, Run, attempt, activation, fence, principal, tool, credential policy hash, expiry, and revocation generation.
- Resolve a Credential Profile only within the current principal/Workspace policy.
- Re-evaluate authorization, approval, credential state, and policy generation on every operation.
- Apply risk, side-effect, repeatability, approval, scope, and idempotency policy.
- Return sanitized data, provenance, warning/redaction metadata, and a receipt suitable for recovery.
- Ensure child capability is an intersection of parent capability and child policy.

Sensitive-read, export, privilege-changing, write, destructive, or non-repeatable operations cannot be configured as silently unrestricted. The decision is deny, durable approval, or narrower scope.

## Baseline state

Not implemented. The live smoke tells OpenCode not to use tools and disables Paseo MCP injection. No production or user credential is required. Adding a real tool before broker and policy enforcement is a Human Gate.
