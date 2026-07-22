---
status: active
owner: gpt-5.4
created_at: 2026-07-22
updated_at: 2026-07-22
authority: design-spec
---

# Sequential Team MVP Design

## Summary

Sequential Team MVP is the first real Agents & Teams slice for Agent Server. It introduces durable Agent and Team definitions, immutable published versions, a Task-first public invocation route, and a control-plane Team coordinator that executes a published sequential Team graph by materializing child Tasks and child Runs while keeping Paseo as a leaf-agent runtime only.

This phase is intentionally stronger than definition-only registry work, but still narrower than Team V1. It does not add parallel fan-out, joins, approvals, retries, cancellation, reconcile, artifacts, review loops, schedules, or dynamic delegation.

## Context and authority

- Product direction: `docs/product.md`
- Feature ledger: `docs/features.md`
- Control-plane boundary: `docs/components/control-plane.md`
- Kernel boundary: `docs/components/orchestration-kernel.md`
- Domain model: `docs/architecture/domain-model.md`
- Current compatibility API: `docs/contracts/run-api.md`
- Human Gate rules: `docs/agents/human-gates-and-handoff.md`
- External product requirements: `/Volumes/AgentsWorkspace/orgs/0xdtech/docs/agent-server/项目文档/enterprise-research-agent-platform-v1-spec`
- External Team model anchor: `.../decisions/team-as-node-v1-design.md`
- External API/resource anchor: `.../contracts/api-and-resource-contracts.md`
- External Session/Task/Run anchor: `.../components/session-task-run.md`

The user explicitly chose the Agents & Teams feature line, approved the Sequential Team MVP direction, requested autonomous completion, and asked that work proceed in a fresh worktree.

## Problem

The repository currently proves durable Task/Run admission, authenticated owner-scoped Run compatibility routes, and fenced leaf runtime execution. It does not yet expose durable Agent or Team product objects, published Invokable versions, canonical public Task invocation, Team graph validation, or Team execution. That leaves the product without its core reusable control-plane abstraction even though the surrounding kernel seam now exists.

## Goals

1. Add durable Agent and Team definition resources with immutable published versions.
2. Unify published Agent and Team versions under one Invokable reference model.
3. Add a new public `POST /api/v1/tasks:invoke` route that returns canonical `task_id` and keeps Task as the only invocation identity.
4. Add public read routes for `GET /api/v1/tasks/{id}` and `GET /api/v1/tasks/{id}/tree`.
5. Add publish-time Team validation and compilation for a sequential-only Team subset.
6. Execute a published sequential Team in the control plane by materializing child Tasks/child Runs while keeping the runtime leaf-agent only.
7. Preserve `/api/v1/runs` as a compatibility route and keep the current authenticated owner-scoped behavior intact.

## Non-goals

- Parallel fan-out, join nodes, approval nodes, review loops, or dynamic delegation.
- Full Team V1 waiting/resume/reconcile semantics across multiple worker activations.
- Retry, cancel, unknown, budget exhaustion, or root-lane queue policy changes.
- End-user OIDC, shared workspace ACLs, or credential/tool approval policy.
- Artifacts, evidence lineage, Web console, Lark channels, schedules, or triggers.
- Runtime graph mutation, Team-wide shared Paseo sessions, or sibling runtime-session sharing.

## Chosen approach

### 1. Product-definition model

Add durable Agent and Team definitions plus immutable published versions:

- `AgentDefinition` / `AgentVersion`
- `TeamDefinition` / `TeamVersion`

Each version belongs to one definition and one tenant/owner scope. Draft versions are writable only until publish. Published versions are immutable. Agent and Team versions are both addressable through one logical Invokable reference:

- `kind: 'agent' | 'team'`
- `definitionId`
- `versionId`

For this phase, owner scope remains the same service-account-derived `(tenant, workspace, principal)` baseline already used by the authenticated compatibility API.

### 2. AgentVersion execution shape

The existing runtime can only execute a prompt. Therefore the executable AgentVersion shape in this phase is intentionally small:

- stable metadata (`name`, `description`)
- immutable `instructions`

Invocation input is normalized to text. Agent execution constructs one leaf prompt from the AgentVersion instructions plus the Task input snapshot. This keeps the phase aligned with the current leaf runtime without pretending that tool policy, memory policy, or richer structured execution are already implemented.

### 3. TeamVersion shape

This phase supports only a sequential Team subset. A TeamVersion still stores a graph-like definition, but publish-time validation rejects anything outside the MVP subset:

- all nodes are `invoke`
- every node references a published AgentVersion in the same tenant
- exactly one entry node
- every step has at most one outgoing `success` edge
- no branching, no fan-in, no loops, no join, no approval
- one required final-output node

The compiler turns that definition into a compiled linear execution plan with stable node order and stable `nodePath` values.

### 4. Canonical Task invocation

Add `POST /api/v1/tasks:invoke` as the new public canonical entrypoint.

It accepts:

- an Invokable reference
- task input
- optional `workspace_id`

`workspace_id`, when provided, must match the authenticated service-account workspace for this phase. Omitted `workspace_id` resolves to the authenticated workspace. The route persists a canonical root Task using the same authoritative access-context snapshot rules as the existing compatibility API.

The response returns `202` with `task_id` and no competing invocation identifier.

### 5. Team execution model

When the claimed root Run belongs to a published AgentVersion, execution remains a direct leaf runtime call.

When the claimed root Run belongs to a published TeamVersion, the control plane executes the compiled sequential plan inside the Team Run activation:

1. mark the root Task active
2. for each compiled Team step:
   - materialize a child Task with `parentTaskId`, `parentRunId`, `nodePath`, `logicalStepKey`, and child Invokable reference
   - create a child Run attempt
   - synchronously claim/start that child Run under fenced control-plane authority
   - execute the referenced AgentVersion through the same leaf runtime port
   - persist the child terminal state
3. derive the next step input from the prior child result text
4. complete the Team Run and root Task from the final-output child result

This keeps Team coordination in the control plane, creates durable child genealogy, and preserves the rule that only leaf Agent execution crosses the runtime boundary.

### 6. Tree/read model

`GET /api/v1/tasks/{id}` returns:

- `task_id`
- task status
- Invokable reference
- root/parent genealogy
- latest Run summary
- root result/error summary when present

`GET /api/v1/tasks/{id}/tree` returns the root plus all descendant Tasks ordered by `nodePath` and creation order, with each node’s latest Run summary. The MVP tree is read-only and does not attempt to expose future join/approval/budget semantics.

## Alternatives considered

### 1. Registry-only foundation

Pros: safest contract addition; minimal orchestration risk.

Cons: still no Team execution, so it undershoots the user’s request for a more aggressive new feature slice.

Rejected because the user explicitly approved a more aggressive Agents & Teams increment.

### 2. Sequential Team MVP with publish/read/invoke

Pros: first real Team capability; preserves Task-first identity and leaf-only runtime boundary; remains bounded enough for one phase.

Cons: requires new public routes, version registry, task-tree reads, and child Task persistence.

Chosen because it is the narrowest slice that creates a real Team feature line.

### 3. Static parallel/join Team MVP

Pros: closer to long-term Team semantics.

Cons: sharply increases concurrency, resume, and correctness complexity before the kernel proves child-task orchestration.

Rejected as too aggressive for the next phase.

## Architecture

### New domain and persistence

- add definition/version domain types for Agent and Team
- extend Task snapshots with child genealogy and Invokable metadata needed for tree reads and child materialization
- add persistence tables for definitions, versions, and compiled Team plans

### New application seams

- definition/version creation services
- publish services for AgentVersion and TeamVersion
- Team compiler/validator for the sequential-only subset
- Task invocation service for canonical public admission
- Task read/tree query service
- Team execution coordinator for claimed Team Runs

### Execution boundary

- runtime remains `AgentRuntimePort`
- Team execution never creates a Team-wide Paseo session
- child Agent steps call the same leaf runtime adapter one step at a time

## Error handling

- unknown or unpublished Invokable reference: `404 invokable_not_found`
- invalid Team graph at publish time: `422 invalid_team_graph`
- cross-workspace invoke mismatch: `403 workspace_scope_mismatch`
- same idempotency key with different request fingerprint on Task invoke: `409 idempotency_conflict`
- root or child runtime execution failure: stable `failed` Task/Run states with safe messages only

## Human Gate record

This phase adds a new public Task API surface and new durable Team/Agent definition state. That is a public-API and durable-state boundary change. The user explicitly approved the Sequential Team MVP direction, approved autonomous execution, and asked that docs and code both be completed in a new worktree. The repo documentation and ADRs must record the intentionally narrow subset so the repository does not overclaim Team V1.

## Verification approach

Minimum evidence for this phase:

- unit tests for new definition/version domain rules and sequential Team compiler validation
- contract tests for Agent/Team publish routes and Task invoke/read/tree routes
- integration tests for definition persistence, child-task genealogy, and sequential Team execution in PostgreSQL
- e2e update that proves the current `/api/v1/runs` compatibility path still works
- deterministic gate: `make test-unit`, `make test-contract`, `make test-integration`, `make e2e-smoke`, `make ci`

External runtime smoke is not required unless the leaf runtime contract changes materially. This phase should stay above the runtime adapter and reuse the current leaf execution contract.

## Expected documentation impact

- README baseline map and limitations
- Features ledger for Agents/Teams and Channels/API status
- Control Plane and Orchestration Kernel component docs
- Run/Task contract docs plus new Agent/Team contract material
- one new ADR for Sequential Team MVP scope and semantics
