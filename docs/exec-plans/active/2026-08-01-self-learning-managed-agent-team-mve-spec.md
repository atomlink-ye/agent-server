---
status: active
owner: orchestrator
created_at: 2026-08-01
updated_at: 2026-08-01
authority: approved-design
---

# Self-Learning Managed Agent Team MVE Specification

## Outcome

Prove one small, real, user-visible path from a local `AgentProject` starter to
two independent Collaborative Team runs and a human-controlled learning loop:

```text
AgentProject init
  -> validate / plan / apply / reapply
  -> local Project Lock
  -> logical Team reference
  -> real root Task/Run and Collaborative TeamRun
  -> real MemberRun/WorkItem execution through Paseo/OpenCode
  -> synthetic market MCP tools
  -> report + LearningProposal
  -> human accept/reject
  -> canonical Memory Version
  -> independent second-run Memory read
```

This is an MVE of the current `agent-server` control plane, not a greenfield
V1 and not a claim that the complete V1 platform is implemented.

## Authority and decisions

Authority is the current worktree's repository instructions, product and
feature ledgers, Team and Memory contracts, current implementation patterns,
and the approved 2026-08-01 roadmap. The old external V1 conclusion that this
must be a new repository is superseded by the owner: `agent-server` is the
implementation baseline, but this MVE is not the complete V1 platform. The
external roadmap remains a planning input and is not an implementation fact
source.

Approved decisions carried by this spec:

1. `agent-server/v1alpha1` is the local `AgentProject` contract. It permits
   file references only, uses a local Project Lock, has no server Project
   registry, accepts no secrets, and operates within one authenticated
   Workspace/Principal scope.
2. `LearningProposal` is a new lightweight durable object over the canonical
   Memory Store / Memory Version API. Memory content remains the sole content
   authority; the implementation must not dual-write the legacy Workspace
   Memory Proposal system.
3. The fixed starter is a self-learning market-research Team: one dynamic
   Lead plus two fixed members, synthetic domain data, and a report clearly
   labelled `synthetic demo only`.
4. The primary acceptance signal is the real main-flow E2E. Existing checks
   are supporting signals; no new unit, contract, integration, deterministic
   E2E, or evaluation suites are introduced by this MVE.

## Scope and user contract

The local CLI/project surface is:

```text
agentctl init --template self-learning-market-research ./demo
cd ./demo
agentctl validate
agentctl plan
agentctl apply
agentctl apply                 # no-op/reuse convergence
agentctl run team://self-learning-research --scenario fixture://...
agentctl watch <root-task-id>
agentctl learning list
agentctl learning accept <proposal-id>
```

The manifest uses `apiVersion: agent-server/v1alpha1`, `kind: AgentProject`,
metadata, and typed top-level sections: `workspace`, `toolProfiles`, `skills`,
`environments`, `agents`, `teams`, `memoryStores`, `entrypoints`, and
`defaultEntrypoint`. The Project contract and Apply support all of these typed
sections, but the Phase 1 MVE starter intentionally uses empty `toolProfiles`,
`skills`, and `memoryStores`; its acceptance path is only Workspace,
Environment, three Agents, and Team. Real Skill, ToolProfile, and Memory Store
starter/projection consumption is deferred to Phase 2 as an explicit MVE scope
cut, not missing implementation. Users do not manually
copy AgentVersion, EnvironmentVersion, TeamVersion, Workspace, Memory Store,
RuntimeSession, Runtime Cell, provider, or bearer-token identifiers.

The Lock records the manifest fingerprint, resolved published resource IDs,
Skill digests, Workspace ID, Memory Store ID, and entrypoint bindings. It is a
validated cache/evidence record, not a second source of truth. It never
records bearer tokens, provider keys, Runtime MCP credentials, prompts, or
unbounded/absolute local paths.

## Architecture and components

### Project composition

The Project parser accepts only the approved `v1alpha1` shape and normalizes
relative paths against the manifest directory. Resource references are
resolved as typed logical refs such as `agent://research-lead`,
`team://self-learning-research`, `memory://research-memory`, and
`environment://paseo-opencode-free`. Plan resolves dependencies without
writing. Apply is **Workspace-first**: it first creates or resolves the
Workspace under the authenticated owner, then ensures every subsequent
Environment, Agent, Team, Memory Store, and seed operation uses that same
authenticated Workspace/Principal scope. This is an explicit MVE boundary,
not a redesign of the repository's owner-scope model. After Workspace
resolution, Apply reuses existing typed APIs in this order:

```text
Workspace -> Skills -> Environment -> Agents -> Team -> Memory Store/seed -> Lock
```

For the Phase 1 MVE, the effective order is `Workspace -> Environment ->
Agents -> Team -> Lock`; empty Skill, ToolProfile, and Memory Store sections
produce no deferred-resource records.

Apply is intentionally not an atomic rollback controller. It reports completed
steps and fails safely at the first invalid step. A second apply must converge
to Reuse/No-op and must not create duplicate versions or seed versions for
identical content. Existing `scripts/dev/web-bootstrap.mjs` becomes a future
compatibility caller of the same engine rather than a second implementation.

### Team execution

The Project binds a logical Team ref to the current published Collaborative
Team version. The Team coordinator remains the control-plane owner of
TeamRun, MemberRun, WorkItem, self-claim, joins, and finalization. The Lead
prompt is generated from the persisted roster; it must not assume member names.
Lead finalization is permitted only after exactly one completed, member-owned
WorkItem exists per roster member, every member Task is completed, and every
latest member Run is succeeded. Each member uses its normal,
independent RuntimeSession/Runtime Cell path and the shared immutable
EnvironmentVersion; no Team-wide provider session is introduced.

The current Team contract remains the bounded Collaborative Team subset. This
MVE does not redesign ownership scope, add dynamic roster/nested Team/Room/DM,
or replace the existing sequential/DAG compatibility paths beyond authority
alignment needed for the approved Collaborative Team flow.

### Starter tools and memory

The synthetic MCP profile exposes bounded tools for stock snapshot, event
batch, analog/pre-backtest summary, and LearningProposal creation. Tool calls
are real MCP/runtime calls with deterministic fixture responses; only the
domain data and computation are mocked. Every response carries `synthetic`,
`data_as_of`, bounded content, and fixture source refs. No network or real
market source is used.

Runtime may propose learning but cannot write Memory directly. A proposal
contains its source TeamRun/Task/Run, target Memory path, proposed content,
evidence refs, status, and accepted Memory Version ID. Human acceptance (or
edit-and-accept) performs a canonical Memory update using the current content
SHA as CAS. Reject leaves Memory unchanged. A stale CAS returns a conflict
without overwriting newer content. The second run explicitly reads the
accepted path through the authorized Memory read tool/API and reports the
principle it used; it may not rely on hidden first-run conversation history.

## Data flow

```text
Manifest files
  -> parser + dependency planner (no writes)
  -> authenticated Workspace create/resolve
  -> same Workspace/Principal scope for all resource operations
  -> Skills -> Environment -> Agents -> Team
  -> Memory Store + CAS seed
  -> sanitized Project Lock
  -> logical entrypoint resolves published TeamVersion
  -> root Task/Run -> TeamRun
  -> Lead WorkItems -> two MemberRuns -> real runtime/MCP calls
  -> bounded final report -> LearningProposal
  -> human review -> Memory Store current Version (CAS)
  -> independent second TeamRun -> Memory Read -> report evidence
```

The optional Web Project Lab is a thin observer/launcher over these APIs. Its
BFF keeps the service bearer server-side and exposes only safe TeamRun,
MemberRun, WorkItem, tool-activity, report, and proposal data. The CLI remains
the authoritative MVE creation path; Web is not a second hidden manifest
store.

## Public and durable contracts

The Project contract is a new local CLI/file contract, not a server-side
Project CRUD API. Existing authenticated Task/Run/Team routes are reused for
execution and inspection. New LearningProposal routes/commands, if required
by the selected surface, must use the common safe error envelope and the same
authenticated owner scope. No caller-supplied tenant, principal, Workspace,
or source ownership may widen authorization.

Expected durable relationships are:

```text
Project Lock -> published resource versions + Workspace + Memory Store
LearningProposal -> source TeamRun/Task/Run + target Memory path + evidence
accepted proposal -> immutable Memory Version via CAS
```

The exact schema/API shape is an implementation task and must be recorded in
the execution plan before migration or public route work. It must preserve
stable Memory IDs, immutable Versions, monotonic versioning, no-op semantics,
and stale-hash conflict behavior from `docs/contracts/memory-api.md`.

## Errors and safety

- Invalid YAML, unsupported apiVersion/kind, unknown fields, absolute paths,
  missing files, duplicate logical refs, cycles, missing references, or
  unsupported tools fail during validate/plan before any write.
- Cross-owner or foreign resources remain hidden as not found; effective
  tenant/principal scope is derived from authentication.
- Apply failures identify the completed prefix and do not pretend the process
  was atomic. A later apply is the recovery path.
- Published resource versions and Memory Versions are immutable. Project Lock
  replacement is explicit and fingerprinted; no silent resource drift is
  accepted.
- Tool output, report text, proposal content, and Web projections are bounded
  and sanitized. Prompts, credentials, provider IDs/raw errors, local paths,
  Runtime Cell details, and secret-bearing tool results do not enter ordinary
  responses, browser state, or evidence.
- Synthetic reports must visibly state `synthetic demo only` and cannot be
  presented as real market data, investment advice, or precise backtesting.
- Team failure is fail-fast for this MVE. No retry, cancel propagation,
  crash recovery, restart/resume, reconcile, multi-node, or partial-success
  claim is made.

## Approved Human Gates

The following fixed boundaries are explicitly owner-approved. They do not
re-block implementation merely because the current slice uses them. Re-open
the relevant gate only if implementation proposes to cross or change one of
these boundaries; passing checks do not authorize crossing a gate:

1. **Public contract gate:** approval is required before changing or adding
   the `agent-server/v1alpha1` Project contract, logical ref semantics, public
   LearningProposal routes/commands, Task/Run/Team invocation behavior, or
   Web/BFF contract.
2. **Durable state gate:** approval is required before adding or changing
   Project Lock persistence semantics, LearningProposal records, source-run
   lineage, Memory Store/Memory Version relationships, or any terminal state.
3. **Migration gate:** approval is required before creating, ordering, or
   changing a PostgreSQL migration, immutable-state trigger, index, or data
   backfill. Migrations are forward-only in the MVE plan; do not improvise
   destructive rollback.
4. **Security gate:** approval is required for owner/tenant scope, bearer or
   capability credentials, Runtime/MCP grants, BFF token handling, secret
   storage, tool permissions, or any response/evidence redaction boundary.

The approved boundaries also include: local file references only; same
Workspace/Principal scope; no server Project registry; no secrets in a Lock;
Memory as the sole content fact source; no dual-write to legacy Workspace
Memory Proposal; and no direct Runtime Memory write.

## Acceptance

The final real E2E must start from fresh PostgreSQL and demonstrate:

1. `init -> validate -> plan -> apply -> reapply` succeeds without manual UUID
   copying; the second apply is No-op/Reuse.
2. Lock and evidence contain no secret, provider key, bearer token, absolute
   path, or unsafe runtime detail.
3. Published Environment, three Agents, Team, and Workspace are present in the
   same authenticated owner scope. Phase 1 intentionally creates no Skill,
   ToolProfile, Memory Store, or seed Memory records; those are Phase 2.
4. A logical Team ref launches a real root Task/Run, Collaborative TeamRun,
   Lead, two MemberRuns, and WorkItems through real HTTP and durable APIs.
5. Both members complete successfully before Lead finalization; each performs a
   real synthetic MCP tool call; final report has all six required sections
   and the synthetic disclaimer.
6. A proposal links to the source TeamRun/Run and is visible for review.
7. Human accept creates a new canonical Memory Version; CAS conflict evidence
   does not overwrite newer content; reject leaves Memory unchanged.
8. An independent second TeamRun reads the accepted Memory Version and states
   which accepted principle it applied, without first-run session history.
9. The same path is inspectable after refresh through the thin Web surface,
   while the browser never receives the service token or unsafe details.

Evidence is sanitized and includes the manifest/Lock, plan summary, resource
fingerprint map, root Task tree, TeamRun/member/work-item summary, tool
receipts, report, proposal, accepted Memory Version, and second-run read event.

## Non-goals

No server/remote/multi-user Project registry, dynamic roster, nested Team,
Room/DM, Artifact Service, scheduler/proactive monitor, real dPro or market
data, real backtest, investment recommendation, semantic retrieval, automatic
learning, auto-accept, Memory merge/gardener, production credential broker,
multi-node/crash recovery/retry/cancel propagation, broad performance work,
or exhaustive test suites.
