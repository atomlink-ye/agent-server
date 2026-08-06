---
status: active
owner: orchestrator
created_at: 2026-08-07
updated_at: 2026-08-07
authority: execution-plan
---

# Per-member provider selection

## Outcome

One Agent Teams v2 `TeamRun` runs its Lead with OpenCode, one member with
Claude Code, and one member with Codex inside the TeamRun's single Paseo
workspace. Durable PostgreSQL query output must prove the three bound member
runtime sessions resolved to three different providers.

## Context and authority

- Authoritative task brief:
  `tasks/active/agent-server-implementation-20260722/BRIEF-per-member-provider.md`
  in the 0xdtech org workspace.
- Design of record:
  `tasks/active/agent-server-implementation-20260722/DESIGN-2026-08-06-per-member-provider.md`.
- Repository authorities: `AGENTS.md`, `docs/agents.md`, and
  `docs/agents/exec-plan-protocol.md`.
- Baseline and branch: `origin/master@0fc832b`,
  `agent/per-member-provider`.
- Stage: Prove. The real path is one mixed-provider TeamRun through published
  Agent versions, runtime creation, Paseo, and durable runtime-session state.
- Already landed and out of scope: provider union and provider modes, the three
  provider CLIs in the runner image, one workspace per TeamRun, create-time
  control prompt relocation, and the delivery envelope.

## Scope

- Resolve a Team member's runtime policy only from that member's published
  managed Agent version.
- Centralize the mapping from the published policy reference to provider,
  operator-pinned model, and the already-established provider mode.
- Preserve `free-only` as the existing process-config fallback.
- Widen only the `modelPolicyRef` accepting predicate to a closed exported tuple,
  derived type, and guard. Do not change its field, ordering, or serialization.
- Extend only the `create` branch of `AgentRuntimeExecuteInput` with optional
  per-call provider/model values and forward them through the Paseo adapter.
- Keep continuation bound to the provider Agent created for that member.
- Update the existing Agent Teams v2 smoke fixture and durable query output to
  exercise and print the three resolved providers from terminal Run state
  without adding a new test.

## Non-goals

- No provider field on `TeamSpec`, Lead, or roster members.
- No edit to `managed-environment-package.ts`.
- No migration, new column, durable-state shape change, or fingerprint rewrite.
- No request-body provider/model selector and no automatic paid-model choice.
- No reimplementation of work already landed in PRs 27 through 30.
- No new unit, integration, contract, deterministic E2E, or evaluation test.
- No unrelated hardening, refactor, or provider-specific mode redesign.

## Work breakdown

- [x] Resolve the Human Gate described in `Current blocker` before any product
      code change. On 2026-08-07 the owner explicitly authorized the minimum
      closed-set ManagedAgent predicate widening because no existing field can
      express mixed per-member providers.
- [ ] Widen `BUILT_IN_MODEL_POLICY_REFS` only with the exact Claude and Codex
      policy values needed by this slice; export the tuple-derived type and
      guard following PR #29's approved provider-union shape.
- [ ] Add one application-owned runtime-policy resolver whose input is the
      persisted published Agent `modelPolicyRef`; make unknown/unconfigured paid
      policies fail closed and retain `free-only` process fallback.
- [ ] Return the persisted `modelPolicyRef` from managed Agent version
      resolution without exposing the package or accepting invocation input.
- [ ] Add optional provider/model fields to the `AgentRuntimeExecuteInput`
      `create` branch and pass the resolved values from `ExecuteRun` only when a
      new provider Agent is created.
- [ ] Make `PaseoRuntimeAdapter` select the create-call provider/model when
      present, retain constructor defaults otherwise, and pass the selected
      provider to the existing centralized provider-mode mapping in
      `paseo-client-port.ts`.
- [ ] Update the existing scripted Team smoke data so Lead/member packages use
      three approved policy refs, while retaining the current cardinality and
      rework assertions.
- [ ] Add an existing-smoke durable query joining `team_runs`,
      `team_member_runs`, `tasks`, and terminal `runs.runtime`; require three
      member runtime sessions and print the persisted provider/model pairs with
      Lead=`opencode`, member=`claude`, member=`codex` as the acceptance artifact.
- [ ] Record non-blocking findings in this plan and defer them rather than
      expanding the MVE.

## Verification

- [ ] From this worktree, commit product changes and run
      `sandbox-ctl push --mode git`.
- [ ] In sandbox `agent-server-teams`, run `make ci`; expect exit 0. If it fails,
      reproduce once on unmodified `0fc832b`; classify a reproducing failure as
      environment evidence and continue, otherwise stop.
- [ ] Run
      `AGENT_TEAMS_V2_SMOKE_RUNTIME=scripted make agent-teams-v2-smoke`; expect
      `RESULT_PASS`, `lead_paseo_workspace_distinct=1`,
      `lead_catalog_exact_eight=true`, and durable cardinality
      `team_members=3, work_items=2, attempts=2`.
- [ ] Run
      `AGENT_TEAMS_V2_SMOKE_RUNTIME=scripted AGENT_TEAMS_V2_SMOKE_REWORK=1 make agent-teams-v2-smoke`;
      expect `RESULT_PASS`, `attempts=3`, and an envelope line with
      `kind:rework`.
- [ ] Capture the smoke's machine-written durable query output showing the
      three bound runtime sessions in one TeamRun resolve to distinct
      `opencode`, `claude`, and `codex` providers. Runtime logs are not evidence.
- [ ] Prove an unchanged `free-only` package canonicalizes byte-identically and
      retains its pinned fingerprint across the predicate widening. If any
      existing pinned digest moves, stop before further implementation.
- [ ] Run `make paseo-smoke`; expect `PASEO_OPENCODE_BASELINE_OK` or record the
      exact external prerequisite that prevents it.

## Documentation impact

- [ ] Product/Feature: update only if the mixed-provider Team capability status
      becomes implemented rather than remaining an internal prerequisite.
- [ ] Component/Contract: update the Paseo Runtime Adapter component if its
      documented process-level provider statement becomes stale; do not change
      public HTTP request contracts.
- [ ] ADR/Runbook: no ADR or migration runbook is expected; record a contrary
      discovery before expanding scope.

## Decisions and discoveries

- The roster's existing `agentVersionId` is the per-member identity; provider
  must not be added to the Team package.
- `modelPolicyRef` is persisted in `agent_versions.policy_snapshot` and has no
  runtime consumer on the baseline.
- Terminal `runs.runtime` already persists the actual execution provider and
  model. Joining it through `tasks.team_member_run_id` to
  `team_member_runs.team_run_id` proves the three resolved runtime providers in
  one TeamRun without adding provider columns or inferring execution from logs.
- Per-provider create modes already live in one mapping in
  `src/adapters/paseo/paseo-client-port.ts` and must remain centralized.
- Contrary to the brief and design, the exact baseline does not validate
  `modelPolicyRef` only by type. Since commit `897a610`,
  `src/domain/agents/managed-agent-package.ts` has accepted only the closed
  `BUILT_IN_MODEL_POLICY_REFS = ['free-only']` allowlist. Consequently no
  Claude/Codex policy ref can be imported and published today.
- `docs/contracts.md` also publishes the closed behavior: "The built-in runtime
  model policy is `free-only`; callers cannot select a concrete or paid model."
- Human Gate crossed on 2026-08-07 under delegated owner authority. The owner
  determined there is no no-gate path: `spec.runtime.provider` is only the
  `paseo` adapter, TeamSpec's environment is team-wide, and process-global
  `PASEO_PROVIDER` cannot represent a mixed TeamRun. Authorization is limited to
  widening the accepted `modelPolicyRef` values as a closed set, following PR
  #29, with no key/field/serialization change and no existing fingerprint churn.
- The design of record contains the incorrect premise that `modelPolicyRef` is
  an open string validated only by type. The owner will correct that design; the
  current code, contract, this gate decision, and this plan govern execution.

## Risks and recovery

- Widening `BUILT_IN_MODEL_POLICY_REFS` changes the accepted published
  ManagedAgent package contract. The Human Gate authorizes only the smallest
  closed-set accepting-predicate change. An open string, field/key change,
  migration, or existing fingerprint change exceeds that authority and stops
  execution.
- A literal provider/model grammar would let a package publisher name arbitrary
  paid models. Prefer an operator-controlled named-policy mapping if the Human
  Gate authorizes new refs; unknown refs must fail closed.
- Do not edit `managed-environment-package.ts` or create a migration. Encountering
  either need stops execution immediately.
- Preserve recovery through ordinary commits; do not rewrite or destructively
  reset the worktree.

## Validation evidence

- Baseline inspected at `0fc832b`; worktree was clean before this plan.
- `git blame` attributes the closed `modelPolicyRef` validator to `897a610`
  (`Managed single-agent scenario v1 (#6)`); the same allowlist exists at both
  the design baseline `97d9c15` and required baseline `0fc832b`.
- `runs.runtime` is existing durable JSONB state and contains the normalized
  execution `{provider, model}` pair; no migration is needed for acceptance.
- Before the gate decision, no product code, schema, migration, fixture, or test
  had been changed; only the committed Active Exec Plan existed.

## Completion checklist

- [x] Human Gate resolved in writing.
- [ ] All implementation and verification items are complete or explicitly
      transferred.
- [ ] No request-selected provider/model path, migration, published Team schema
      change, credential, debug output, or generated evidence remains.
- [ ] Documentation impact is resolved.
- [ ] Move this plan to `docs/exec-plans/completed/`, set `status: completed`,
      update evidence, and leave no unchecked boxes.

## Current blocker

None. The ManagedAgent published-contract Human Gate was explicitly crossed on
2026-08-07 under delegated owner authority, within the closed-predicate and
fingerprint-invariance limits recorded above.

## Next exact command

Dispatch a fixer with explicit ownership of the closed policy tuple/guard and
runtime-policy resolver files. Its first required check is canonical JSON plus
fingerprint equality for the unchanged `free-only` fixture before runtime wiring
begins.

## Cleanup state

Clean linked worktree on `agent/per-member-provider`; the initial Active Exec
Plan is committed and this gate-decision update is the only pending change. No
temporary files or generated evidence.
