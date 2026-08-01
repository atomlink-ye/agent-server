---
status: active
owner: orchestrator
created_at: 2026-08-01
updated_at: 2026-08-01
authority: execution-plan
---

# Self-Learning Managed Agent Team MVE

## Outcome

Deliver the smallest complete current-repository path from a local
`agent-server/v1alpha1` AgentProject to a real Collaborative Team run, a
human-reviewed LearningProposal, a canonical Memory Version, and an
independent second-run recall. The companion design is
`2026-08-01-self-learning-managed-agent-team-mve-spec.md`.

## Context and authority

The implementation baseline is this `agent-server` worktree and its current
Task/Run, Managed Agent/Environment, Collaborative Team, RuntimeSession,
MCP/Skill, Web, and Memory Store/Version seams. The external roadmap supplied
for this task is an approved planning input, not proof of implementation.
The owner has superseded the old greenfield V1 conclusion: `agent-server` is
the implementation baseline, but it is not the complete V1 platform. Existing
`sequential-mvp-v1` and `dag-mve-v1` behavior remains compatibility evidence;
this plan does not redesign those paths.

Required authority includes `AGENTS.md`, `docs/agents.md`,
`docs/agents/exec-plan-protocol.md`, `README.md`, `docs/product.md`,
`docs/features.md`, `docs/contracts/agent-team-api.md`,
`docs/contracts/memory-api.md`, and the legacy Memory contracts. The approved
Human Gates are repeated in the companion Spec and apply to every phase here.

## Scope

- Phase 0: make Collaborative Team correctness and authority wording agree:
  dynamic roster prompt, terminal-member/task/run gate before Lead finalize,
  owner-scope alignment without redesign, repo documentation alignment, and
  synchronization of the external V1 authority wording in the external
  roadmap's README and related architecture/decision documents. The wording
  must state that the owner superseded "new greenfield, not based on
  agent-server"; current `agent-server` is the implementation baseline but
  not complete V1. External history is not rewritten.
- Phase 1: implement local file-only AgentProject parser, typed refs,
  dependency plan, apply, local Lock, init/validate/plan/apply/run/watch, and
  logical Team launch. The Phase 1 MVE uses empty `toolProfiles`, `skills`, and
  `memoryStores` and proves only Workspace, Environment, three Agents, and
  Team. Real Skill/ToolProfile/Memory Store starter and projection consumption
  is explicitly deferred to Phase 2 as an MVE scope cut, not missing
  implementation. No server Project registry, secrets, remote registry, or
  rollback controller.
- Phase 2: add the fixed self-learning market starter, four Skills, synthetic
  fixture pack, three market tools, LearningProposal tool/store/API/review/CAS,
  and independent second-run Memory read.
- Phase 3: add only the thin Project Lab/Team Inspector and BFF projection,
  preserving server-side bearer handling and refresh recovery.
- Final acceptance: fresh PostgreSQL through init/plan/apply/reapply, real
  HTTP Task/Run/TeamRun/Paseo/OpenCode/MCP path, report, human accept, Memory
  Version, and independent second-run recall.

## Non-goals

No crash recovery/retry/cancel propagation/multi-node, remote/server/multi-user
Project registry, dynamic roster/nested Team/Room/DM, Artifact Service,
scheduler/proactive monitor, real dPro/market data/backtest, semantic Memory
retrieval, automatic prompt/Skill/Memory mutation, broad Web builder, or new
unit/contract/integration/deterministic E2E/evaluation tests.

## Work breakdown

### Phase 0 — Team correctness and authority alignment

#### Phase 0A progress (implemented in this worktree)

- Collaborative kickoff now uses the persisted lead and roster names; the
  smoke roster deliberately uses `analyst` and `verifier`.
- Lead finalization now requires exactly one completed, member-owned WorkItem
  per roster member, every corresponding member Task completed, and every
  corresponding latest/current Run succeeded. Existing owner scope and CAS
  transitions are unchanged.
- Root completion no longer depends on the lead calling `team_complete`: the
  finalization child accepts at most 8 items, requires subjects of at most 256
  characters, and rejects empty summaries. Arbitrary summary and aggregate
  prompt character caps were removed after real member output showed that the
  old 2,000-character summary limit blocked valid finalization. After a
  successful persisted terminal Run with non-empty result text, the
  coordinator calls the existing atomic TeamRun/root completion path. A prior
  `team_complete` completion is reloaded under owner scope and is a safe no-op.
- Lead finalization now uses a fresh task-scoped RuntimeSession/provider Agent;
  the lead member's canonical session remains the kickoff team_member session.
- Root cause: the previous coordinator had no `lead_finalize` completion branch,
  and reusing the lead kickoff provider Agent for a second turn could emit
  assistant output without delivering the Paseo/OpenCode idle edge needed to
  persist a terminal finalization Run. Either path could leave TeamRun/root
  active after member work and member Runs were complete.
  Failed, timed-out, or empty-result finalization remains blocked/deferred; no
  retry or reconcile behavior was added.
- Repository authority wording was synchronized in README, Features,
  orchestration component, Agent/Team contract, and domain model. External
  mirrors and other Phase files were not changed.
- Real smoke evidence and supporting-check results are recorded below after
  verification. The external-authority synchronization item remains open.

- [x] Inspect current Collaborative Team kickoff/finalization and make the
      roster prompt dynamic.
- [x] Require exactly one completed, member-owned WorkItem per roster member,
      and all member Tasks to be completed with succeeded latest Runs
      before `lead_finalize`; preserve existing owner scope and compatibility
      behavior.
- [x] Align only the necessary repo status wording for Collaborative Team,
      transitional sequential/DAG behavior, and the MVE baseline after code
      evidence exists.
- [ ] Synchronize the external V1 authority wording in its README and related
      architecture/decision documents: owner-superseded greenfield wording,
      `agent-server` as implementation baseline, and explicit non-equivalence
      to complete V1. Do not rewrite external history.

**Outcome:** a non-`researcher`/`critic` roster can run, and Lead cannot
finalize while member execution remains non-terminal.

### Phase 1 — AgentProject local contract and CLI

- [x] Add the parser/normalizer and strict file-only `v1alpha1` manifest
      contract under `src/domain/projects/`, using typed top-level sections and
      rejecting unknown fields.
- [x] Add typed logical refs, LocalToolProfile semantics, safe manifest-relative
      source normalization, source digests, and a stable SHA-256 project
      fingerprint. Absolute resolved paths do not enter the normalized model,
      Lock, plan, logs, or errors. Native ManagedAgent/ManagedEnvironment/
      ManagedTeam contracts remain unchanged.
- [x] Add typed dependency planning under `src/application/projects/`.
- [x] Add Project Apply orchestration with Workspace-first ordering: resolve
      the authenticated Workspace first, then run Skills, Environment, Agents,
      Team, Memory Store/seed, and Lock entirely inside the same authenticated
      Workspace/Principal scope. This is not an owner-scope redesign. Apply
      never creates or rebinds the Workspace.
- [x] Add local Project Lock with fingerprinted resolved versions and no
      secret/path leakage. Writes are stable sorted JSON using a temp-file
      rename and reject symlink targets.
- [x] Add CLI commands using the current `src/entrypoints/cli/` pattern, or a
      minimal `packages/agentctl/` only if the repository shape requires it:
      `init`, `validate`, `plan`, `apply`, `run`, and `watch`.
- [x] Explicitly defer migration of `web-bootstrap.mjs` to the shared Apply
      Engine. It is not required for the Phase 1 CLI acceptance path and may be
      revisited with the Phase 3 Web slice.

- [x] Phase 1 Task 5: add the controlled `collaborative-team-phase1` starter,
      real Project CLI smoke harness, and executable Make/package targets.
- [x] Phase 1 Task 5 evidence: orchestrator ran
      `make agent-project-phase1-smoke`; only sanitized pass output is recorded here.

**Outcome:** a fresh starter can plan before writing, apply without manual
UUIDs, write a local Lock, and reapply as Reuse/No-op for Workspace,
Environment, three Agents, and Team; a logical Team ref can enter the existing
real Team invocation path. Empty Skill/ToolProfile/Memory Store sections are
the owner-mandated Phase 1 MVE scope cut; their real consumers move to Phase 2.

### Phase 2 — Starter, synthetic tools, and learning loop

- [ ] Add `templates/self-learning-market-research/` with manifest,
      Environment, three Agents, Team, four Skills, seed Memory, and fixtures.
- [ ] Add bounded synthetic market tool adapter/profile and real MCP/runtime
      projection; include provenance and `synthetic` markers.
- [ ] Correct/extend the existing Team starter prompts so Lead is dynamic and
      the two members cover knowledge/opportunity and analog/risk review.
- [ ] Add the lightweight durable LearningProposal model/store/API and
      `learning_proposal_create` tool. Preserve canonical Memory Store as the
      only content fact source; do not dual-write legacy Workspace Memory
      Proposals.
- [ ] Add list/read/accept/edit-and-accept/reject with owner scope and Memory
      content-SHA CAS. Runtime has no direct Memory write capability.
- [ ] Add a follow-up scenario in which a member explicitly reads the
      accepted Memory path and the report identifies the applied principle.

**Outcome:** the fixed starter completes a real synthetic report, produces a
reviewable proposal, creates a new Memory Version only after human acceptance,
and proves recall on an independent second TeamRun.

### Phase 3 — Thin Web observation surface

- [ ] Add only the narrow Project Lab/Team Inspector/learning review views and
      the server-side-token BFF routes needed to start, inspect, review, and
      refresh the MVE path.
- [ ] Reuse existing safe Markdown/activity/timeline patterns; do not add an
      arbitrary Project editor, Room/DM, operator home, or artifact explorer.
- [ ] Ensure refresh can reconstruct Team status/report/proposal without
      exposing bearer, provider, local path, Runtime Cell, or raw provider
      details.

**Outcome:** the primary CLI/API path is observable from the thin Web surface
and survives refresh without becoming a second configuration authority.

### Final real E2E

- [ ] Run the golden path against fresh PostgreSQL: `init -> plan -> apply ->
reapply -> real Team Task/Run -> TeamRun/member/work-item completion ->
real Paseo/OpenCode -> synthetic MCP -> report -> human accept -> Memory
Version -> independent second-run read -> Web refresh/view`.
- [ ] Retain only sanitized evidence: manifest/Lock, plan summary, resource
      fingerprints, root tree, TeamRun/member/work-item summary, tool receipts,
      report, proposal, accepted Version, second-run read, and Web capture.

## Probable file map

These are implementation hypotheses based on current repository patterns, not
claims that the files already exist:

```text
src/domain/projects/agent-project.ts
src/domain/projects/resource-ref.ts
src/domain/projects/project-lock.ts
src/application/projects/plan-agent-project.ts
src/application/projects/apply-agent-project.ts
src/application/projects/project-resource-resolver.ts
src/domain/learning/learning-proposal.ts
src/application/learning/propose-learning.ts
src/application/learning/review-learning.ts
src/infrastructure/postgres/postgres-learning-proposal-repository.ts
src/entrypoints/api/routes/learning-proposals.ts
src/entrypoints/cli/{init,validate,plan,apply,run,watch,learning}.ts
src/adapters/demo-market/fixture-store.ts
src/adapters/demo-market/mock-market-tools.ts
src/infrastructure/extensions/runtime-mcp-server.ts
templates/self-learning-market-research/{agent-project.yaml,environment.yaml}
templates/self-learning-market-research/{agents,teams,skills,memory,fixtures}/
apps/web/app/projects/
apps/web/components/projects/
scripts/dev/web-bootstrap.mjs
scripts/smoke/managed-project-main-flow.mjs
```

Existing current patterns to reuse include `src/domain/teams/`,
`src/infrastructure/postgres/postgres-collaborative-team-repository.ts`,
`src/infrastructure/postgres/postgres-memory-api-repository.ts`,
`src/contracts/teams.ts`, `src/contracts/memory-api.ts`,
`src/infrastructure/extensions/runtime-mcp-server.ts`,
`scripts/smoke/collaborative-team-main-flow.mjs`, and
`scripts/dev/web-bootstrap.mjs`.

## Verification

- [ ] Run the final real E2E first once prerequisites exist; it is the primary
      acceptance signal and must use real Paseo/OpenCode, not a fake runtime.
- [ ] Run only the narrow supporting documentation and Exec Plan checks under
      Node `24.18.0`: `pnpm check:docs` and `pnpm check:exec-plans`.
- [ ] Run `git diff --check` and inspect the complete expected implementation
      diff for the active phase. At planning time, the initial diff is limited
      to these two planning documents; later implementation must not be
      rejected merely because the expected source, migration, CLI, Web, or
      evidence files also appear. Do not run broad test suites or author test
      files unless explicitly requested.

## Documentation impact

- [ ] Update `README.md` only after implementation evidence exists, to state
      the Project/Team/learning MVE boundary truthfully.
- [ ] Update `docs/features.md` and relevant Team, Memory, Task/Run,
      architecture/component, and operations contracts only for observed
      behavior; retain explicit baseline/deferred wording.
- [ ] Add or update a focused real-E2E evidence/runbook reference if the
      implementation creates one; do not rewrite external history.

## Decisions and discoveries

- Current `agent-server` is the implementation baseline; the external
  greenfield conclusion is superseded by the owner; this does not make the
  current repository the complete V1 platform.
- Project Apply is Workspace-first. All later resource operations must remain
  in the same authenticated Workspace/Principal scope; this is a fixed MVE
  boundary, not an owner-scope redesign.
- AgentProject is deliberately local and file-reference-only. The Lock is the
  durable local resolution record, not a server Project registry.
- The final owner/Oracle-authorized object model uses typed top-level sections,
  rather than a flat resource registry. LocalToolProfile contains only tool refs and has no
  IDs, versions, credentials, command, environment, or MCP configuration.
- Workspace is resolve-first and represented locally as `workspace://default`.
  Lock is validated cache/evidence; it is not authoritative project content.
- Phase 1 Task 2 uses explicit Agent/Team renderers: YAML is parsed structurally,
  project Skill and ToolProfile refs are expanded before native parsing, and Team
  refs render through deterministic UUID sentinels in plan mode. The planner is
  pure and emits the fixed Workspace-first topology with explicit desired
  operations; it does not predict remote Create/Reuse outcomes.
- LearningProposal is deliberately separate from legacy Workspace Memory
  Proposal routes, but it must point to and update the canonical Memory API;
  there is one Memory content fact source, not two stores.
- Team correctness is a prerequisite to the Project starter: finalization must
  wait for exactly one completed, member-owned WorkItem per roster member,
  completed member Tasks, and succeeded latest Runs, while roster prompts are
  generated from the actual Team definition.
- The roadmap's proposed file map is treated as probable only. Before coding,
  locate the existing entrypoint, registry, migration, and Web patterns and
  adjust the map without broadening scope.
- Phase 1 final review identified two non-blocking boundary improvements that
  are explicitly deferred under the owner-approved MVE rule: remove Team tools
  from the Lead finalization runtime grant, and make Skill registry
  configuration lazy when a Project has no Skills. The observed Phase 1 path
  completed successfully with the current boundaries; revisit these only when
  a later phase needs them or real evidence promotes them to blockers.

## Risks and recovery

- **Partial Apply:** record the completed prefix and rerun Apply. Do not claim
  atomic rollback or delete published immutable resources. Use fingerprinted
  reuse/no-op behavior to converge.
- **Migration failure:** stop the isolated environment, preserve sanitized
  diagnostics, discard only the disposable database through normal cleanup,
  and fix forward in a new migration/isolated database. Never hand-edit a
  retained evidence database.
- **CAS conflict:** return the safe conflict, reread the current Memory Version,
  and require human review again; never overwrite or auto-merge.
- **Team/provider failure:** fail the root path with normalized safe error
  details; do not show a fabricated report or retry outside the approved MVE.
- **Scope/security regression:** the fixed public-contract, durable-state,
  migration, and security boundaries are already owner-approved. Stop and
  re-open the relevant Human Gate only when implementation crosses one of
  those approved boundaries; passing smoke does not authorize a boundary
  change.

## Validation evidence

Phase 0A evidence: code inspection confirmed roster-derived kickoff text, the
WorkItem/member Task/latest Run success gate, bounded automatic plain-text lead-finalize
completion through the existing atomic control-plane path. The real
Collaborative Team smoke and supporting checks are recorded here after
verification. No Project, Memory, Web, or external mirror behavior is claimed.

Phase 1 Task 2 evidence: explicit structural Agent and Team renderers and the
pure fixed-topology Project planner are present. Type, format, documentation,
Exec Plan, and whitespace checks passed under the available Node runtime.
CLI is included in the completed Phase 1 path; web-bootstrap remains deferred.

Phase 1 Task 3 evidence: Apply now resolves the authenticated Workspace first,
then performs the ordered Environment, Agent, Team, and Lock work required by
the Phase 1 MVE through an explicit typed port. Skill registration and Memory
Store/seed support remain available in the contract but are deferred consumers.
The HTTP adapter uses the existing authenticated routes and bounded
deterministic idempotency keys. The local Lock is sanitized, sorted, and
atomically replaced. CLI and the real Project E2E are covered by the later
Phase 1 evidence; web-bootstrap remains deferred.

Phase 1 Task 3 blocker-fix evidence: Skill registration now verifies the
normalized source digest before publishing registry state; Memory seeds use
the normalized source snapshot and verify its fingerprint; Memory Store
resolution always lists the authenticated workspace and rejects stale-lock,
ambiguity, and description drift. Apply failures expose only a safe code and
immutable completed prefix. Lock parsing validates typed values and
cross-references, and lock writes report Create/Update/NoOp from canonical
bytes. The HTTP adapter validates response contracts at its boundary. The
Phase 1 Project E2E and CLI behavior are covered below; web-bootstrap remains
deferred.

Phase 1 Task 5 implementation: the controlled
`templates/collaborative-team-phase1/` starter and
`scripts/smoke/agent-project-phase1-main-flow.mjs` now exercise init,
validate, deterministic plan, apply/reapply Lock stability, and the real Team
entrypoint. The starter keeps the typed Skill/ToolProfile/Memory Store sections
empty; Phase 1 smoke resource convergence covers only Workspace, Environment,
three Agents, and Team.

Phase 1 completion evidence (2026-08-01): manual staged full-chain checks,
including a 5-second watch, passed first. The paid full smoke then passed within
the 3-minute timeout using `opencode-go/deepseek-v4-flash` (actual root
completion: 77 seconds). Evidence included root `completed`, four child tasks,
TeamRun `succeeded`, two completed WorkItems, non-empty finalization text, three
runtime sessions, and byte-stable Lock/reapply convergence. `pnpm check:types`
and `git diff --check` also passed. Debugging first isolated an overlong
completion summary blocked by the old 2,000-character limit and a SQL reference
to the nonexistent `runtime.status` column; after those fixes, stepwise
diagnosis preceded the successful overall smoke.

## Completion checklist

- [ ] The companion Spec and this Plan agree on scope, gates, non-goals, and
      acceptance.
- [x] All implemented Phase 1 outcomes have real evidence recorded.
- [ ] Final real E2E passes with sanitized evidence.
- [x] Supporting checks and `git diff --check` results are recorded.
- [x] Typed dependency planning, deterministic no-write render planning,
      Apply, Lock, and CLI are implemented and covered by the Phase 1 evidence.
- [ ] Documentation impact is resolved and deferred work is explicitly
      transferred.
- [ ] This plan and its companion Spec are moved together to `completed/`,
      status is set to `completed`, and no unchecked items remain.

## Current blocker

Phase 1 is complete and verified. The next step is Phase 2: the real
Skill/ToolProfile/Memory Store starter and projection consumers, synthetic
tools, and the learning loop. Any change to the approved public contract,
durable state, migration, or security boundary still requires its Human Gate.

## Next exact command

Before starting Phase 2, run under Node `24.18.0` after any additional
documentation edits:

```bash
pnpm check:docs && pnpm check:exec-plans
```

The first Phase 2 action is a focused inspection of the existing Skill,
ToolProfile, Memory Store, runtime MCP projection, and canonical Memory API
seams. Shape only the smallest synthetic report -> proposal -> human accept ->
independent recall path; do not begin with hardening or broad abstractions.

## Cleanup state

Phase 1 implementation and sanitized evidence are present in this worktree.
Create the verified Phase 1 commit before Phase 2 begins. Keep the Spec and Plan
in `docs/exec-plans/active/` until the multi-phase outcome and final real E2E are
complete; archive them together only after all remaining checkboxes are
resolved.
