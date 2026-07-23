# ADR 0006: Workspace Memory Proposal MVP boundary

- Status: accepted
- Date: 2026-07-23

## Context

The baseline already proves service-account owner scope, canonical Task/Run persistence, published Agent/Team invocation, and a reusable Paseo Workspace seam. Product Workspace memory still needed a first durable slice, but treating that slice as agent memory would overclaim V1 and couple governance, retrieval, and runtime prompt assembly too early.

Memory also has authority and audit requirements: a proposed fact or preference must preserve who proposed it, where it came from, who reviewed it, whether it was edited, and whether it was rejected. Those records are useful before any retrieval system exists.

## Decision

Implement a Workspace Memory Proposal MVP with these boundaries:

1. Expose authenticated service-account routes for creating and listing proposals, reviewing a pending proposal, and listing accepted entries.
2. Persist proposal content, category, optional Task/session provenance, review outcome, reviewed content for edits, and accepted entries in PostgreSQL.
3. Derive owner scope from the configured service-account binding, matching the current Task/Run baseline, instead of adding user identity or shared Workspace ACLs in this phase.
4. Keep accepted entries separate from runtime context assembly. Agents do not retrieve accepted entries automatically, and the runtime adapter does not inject them into prompts.
5. Do not add embeddings, vector search, ranking, retrieval policy, context-window assembly, or agent recall semantics in this phase.

## Consequences

Agent Server now has a narrow but durable memory governance loop: proposals can be reviewed into accepted entries with provenance. This creates auditable source material for a future retrieval/context subsystem without making the current runtime behavior implicit or hard to inspect.

Separating governance from retrieval keeps public API semantics stable while future work decides indexing, ranking, freshness, sensitivity, context budgeting, and runtime injection rules. It also avoids giving leaf agents authority to silently mutate long-lived memory.

Owner scope remains service-account based for now because end-user OIDC, canonical users, roles, and shared Workspace ACLs are not implemented. Moving memory ownership to user/workspace membership is future V1 work and will require contract, authorization, and migration review.
