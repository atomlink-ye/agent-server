---
status: active
owner: gpt-5.4
created_at: 2026-07-23
updated_at: 2026-07-23
authority: design-spec
---

# Workspace Memory Proposal MVP Design

## Summary

Workspace Memory Proposal MVP is the first durable memory-governance slice for Agent Server. It adds workspace-scoped memory proposals, explicit review actions, and accepted workspace memory records as control-plane objects. The phase exposes authenticated owner-scoped HTTP routes for creating and listing proposals, reviewing them with `accept | edit_and_accept | reject`, and listing accepted workspace memory.

This phase intentionally does **not** assemble memory into runtime context, write memory silently, add agent memory, or introduce retrieval/embedding/vector search. Memory remains a proposal-and-review flow, not a hidden prompt mutation path.

## Context and authority

- Product direction: `docs/product.md`
- Feature ledger: `docs/features.md`
- Workspace boundary: `docs/components/workspace-and-artifact-store.md`
- Domain model: `docs/architecture/domain-model.md`
- Existing public contracts: `docs/contracts/task-api.md`, `docs/contracts/run-api.md`
- Human Gate rules: `docs/agents/human-gates-and-handoff.md`
- External product requirements: `/Volumes/AgentsWorkspace/orgs/0xdtech/docs/agent-server/项目文档/enterprise-research-agent-platform-v1-spec`
- External memory anchor: `.../components/agent-workspace-memory.md`
- External user-journey anchor: `.../product/user-journeys.md`
- External ADR anchor: `.../decisions/architecture-decisions.md`

The user explicitly chose Workspace Memory Proposal MVP as the next slice, approved exposing a create-proposal API in this MVP, and asked for autonomous completion in a fresh worktree from `origin/master`.

## Problem

The repository currently proves authenticated owner-scoped invocation, durable Task/Run admission, and one reusable Paseo filesystem workspace. It does not yet model Product Workspace memory as a durable control-plane object. There is no proposal resource, no review action, no accepted workspace-memory record, and no provenance chain that explains who proposed or reviewed a long-lived memory item.

That leaves the documented V1 memory direction unimplemented and risks conflating a reusable Paseo filesystem workspace with product-governed Workspace memory.

## Goals

1. Add a durable workspace-scoped `MemoryProposal` resource.
2. Add a durable workspace-scoped accepted-memory resource (`WorkspaceMemoryEntry`).
3. Expose authenticated owner-scoped HTTP routes for:
   - create proposal
   - list proposals
   - review proposal with `accept | edit_and_accept | reject`
   - list accepted workspace memory
4. Persist provenance facts needed for governance and later context assembly:
   - tenant
   - workspace
   - source task
   - source session when available
   - proposer snapshot
   - reviewer snapshot
   - created/reviewed timestamps
   - review outcome
5. Keep owner/workspace scope server-derived from the current authenticated service-account access context.
6. Update repo docs, contracts, and tests so the repository states the narrow MVP truth clearly.

## Non-goals

- Agent memory.
- Context assembly or automatic runtime prompt injection.
- Semantic retrieval, embeddings, vector search, or ranking.
- Automatic proposal-generation UX.
- Session reset semantics.
- Full Workspace sources/notes/files/artifact delivery.
- End-user OIDC, shared Workspace ACLs, reviewer role models, or canonical human identity.
- Credential broker, approval service, or runtime isolation changes.
- Memory editing/deleting after acceptance.
- Temporary-only review outcomes such as `mark_temporary`.

## Chosen approach

### 1. Workspace-only governance model

This MVP governs **workspace memory only**. It does not add agent-scoped memory records or a shared memory abstraction across scopes.

Two durable resources are added:

- `MemoryProposal`
- `WorkspaceMemoryEntry`

`MemoryProposal` captures the submitted candidate memory plus governance state. `WorkspaceMemoryEntry` captures the accepted memory that is allowed to become future product memory input. Accepting a proposal creates a new entry; rejecting a proposal never creates one.

### 2. Proposal model

`MemoryProposal` stores:

- stable `id`
- owner scope: `tenantId`, `workspaceId`
- original `content`
- `category`
- optional `sourceTaskId`
- optional `sourceSessionId`
- proposer snapshot:
  - `proposerPrincipalType`
  - `proposerPrincipalId`
  - `proposerServiceAccountId`
  - `proposerPolicySnapshotVersion`
- lifecycle state: `pending | accepted | rejected`
- optional review facts:
  - `reviewOutcome = accept | edit_and_accept | reject`
  - `reviewedContent` when edited
  - reviewer snapshot fields matching the proposer snapshot shape
  - `reviewedAt`
- `createdAt`, `updatedAt`

The status stays coarse (`pending | accepted | rejected`). The finer distinction between accepting as-is and accepting after an edit is carried by `reviewOutcome` rather than by additional status values.

### 3. Accepted-memory model

`WorkspaceMemoryEntry` is append-only for this MVP and stores:

- stable `id`
- `proposalId`
- owner scope: `tenantId`, `workspaceId`
- accepted `content`
- `category`
- optional `sourceTaskId`
- optional `sourceSessionId`
- proposer snapshot
- reviewer snapshot
- `reviewOutcome = accept | edit_and_accept`
- `acceptedAt`

The entry is the durable control-plane memory record. The proposal remains the review log that explains how the entry was accepted.

### 4. Auth and scope model

Routes require the existing `Authorization: Bearer <token>` service-account flow.

For this MVP:

- owner scope is always resolved from `ServiceAccountAccessContext`
- callers cannot supply effective tenant/workspace/principal fields
- proposal create/list and entry list are automatically limited to the authenticated owner scope
- proposal review records the **current authenticated principal snapshot** as reviewer

This does **not** claim that user-level reviewer ACLs exist. It records who the server believes the current authenticated principal is within the current baseline model.

### 5. HTTP surface

The MVP adds these routes:

- `POST /api/v1/workspace-memory/proposals`
- `GET /api/v1/workspace-memory/proposals`
- `POST /api/v1/workspace-memory/proposals/{proposal_id}/review`
- `GET /api/v1/workspace-memory/entries`

The scope is deliberately server-derived, so the route path does not expose caller-selected tenant/workspace identifiers.

Create request body:

- `content`
- `category`
- optional `source_task_id`
- optional `source_session_id`

Review request body:

- `action = accept | edit_and_accept | reject`
- optional `content`

`content` is required only for `edit_and_accept`. Supplying edited content for other actions is invalid.

### 6. Source provenance rules

- `source_task_id` is optional.
- When supplied, it must identify a Task visible in the authenticated owner scope; otherwise the API returns `404 task_not_found`.
- `source_session_id` is optional because the current repository does not yet expose a Session resource. It is treated as an opaque recorded reference when present.

This keeps provenance useful without pretending that Session APIs or shared Workspace ACLs already exist.

### 7. Review semantics

- `accept`
  - transitions the proposal from `pending` to `accepted`
  - creates one `WorkspaceMemoryEntry` with the original content
- `edit_and_accept`
  - transitions the proposal from `pending` to `accepted`
  - stores `reviewedContent`
  - creates one `WorkspaceMemoryEntry` with the reviewed content
- `reject`
  - transitions the proposal from `pending` to `rejected`
  - creates no accepted entry

Review is one-shot in this MVP. A non-pending proposal cannot be reviewed again.

### 8. Query model

- proposal list returns all proposals in authenticated owner scope, newest first
- accepted-memory list returns all accepted entries in authenticated owner scope, newest first

This MVP does not add filtering, pagination, search, or full-text matching.

## Alternatives considered

### 1. Internal-only proposal creation

Pros: smallest external contract; least surface area.

Cons: user explicitly asked to expose create-proposal API in this MVP.

Rejected.

### 2. Richer review state machine

Pros: closer to eventual product moderation workflows.

Cons: adds extra statuses, comments, expiry, and revision history before the base durable slice exists.

Rejected as too broad for the MVP.

### 3. Retrieval/context assembly in the same phase

Pros: delivers more visible end-user value immediately.

Cons: merges governance with consumption and risks silent prompt mutation, which the external requirements explicitly avoid.

Rejected.

## Architecture

### Domain and application seams

- new memory domain types and invariants under `src/domain/`
- new application use cases under `src/application/memory/`
- new repository port for proposal/entry persistence
- existing `TaskRepository` reused for source-task existence checks

### Persistence

- one migration adds `memory_proposals` and `workspace_memory_entries`
- proposals and entries are owner-scoped rows
- review acceptance is persisted transactionally so proposal status and accepted entry do not diverge

### Entry-point wiring

- new `src/contracts/workspace-memory.ts`
- new route registration file under `src/entrypoints/api/routes/`
- `createApp(...)` and `bootstrap.ts` wire the route and use cases

## Error handling

- missing/malformed/unknown/disabled token: standard `401 unauthorized`
- invalid JSON or schema mismatch: `400 invalid_json` or `400 invalid_request`
- missing or cross-scope `source_task_id`: `404 task_not_found`
- unknown proposal ID or cross-scope read/review: `404 memory_proposal_not_found`
- reviewing a non-pending proposal: `409 memory_proposal_already_reviewed`
- `edit_and_accept` without edited content: `400 invalid_request`

## Human Gate record

This phase adds a new public API surface and new durable memory-governance state. That is both a public-contract and durable-state boundary change. The user explicitly approved the Workspace Memory Proposal MVP direction, explicitly approved exposing create-proposal API in this MVP, and explicitly asked for autonomous completion from a fresh worktree. The docs and ADR must record the intentionally narrow subset so the repo does not overclaim V1 memory behavior.

## Verification approach

Minimum evidence for this phase:

- unit tests for memory domain invariants and review-action rules
- application tests for create/list/review flows and source-task validation
- contract tests for all four new HTTP routes plus auth/error shapes
- integration tests for PostgreSQL persistence, owner scope, and accepted-entry creation on review
- deterministic gate: `make test-unit`, `make test-contract`, `make test-integration`, `make e2e-smoke`, `make ci`

External runtime smoke is not required because this phase should stay in the control-plane, storage, and HTTP contract layers without changing the Paseo runtime boundary.

## Expected documentation impact

- `README.md` baseline status/limitations
- `docs/features.md`
- `docs/contracts.md`
- new memory contract doc under `docs/contracts/`
- `docs/components/workspace-and-artifact-store.md`
- `docs/product/users-and-journeys.md`
- ADR index and one new ADR for Workspace Memory Proposal MVP
