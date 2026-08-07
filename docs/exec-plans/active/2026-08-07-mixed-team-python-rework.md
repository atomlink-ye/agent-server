---
status: active
owner: orchestrator
created_at: 2026-08-07
updated_at: 2026-08-07
authority: execution-plan
---

# Mixed-provider Team and Python rework proof

# Outcome

Run one real Agent Teams v2 `TeamRun` in the prepared `agent-server-mixed`
sandbox so Lead, fixer, and reviewer execute under OpenCode, Claude Code, and
Codex respectively in one Paseo workspace. The Team must produce an
approximately 100-line Python file through a rejecting review and at least one
fixer rework attempt, with persisted and machine-written evidence plus a visual
Paseo Web confirmation.

## Context and authority

- Authoritative brief:
  `tasks/active/agent-server-implementation-20260722/BRIEF-mixed-team-and-python-rework.md`
  in the 0xdtech org workspace.
- Repository authorities: `AGENTS.md`, `docs/agents.md`, the Agent Teams v2
  contract, Orchestration Kernel component, Paseo Runtime Adapter component,
  and Runtime contract.
- Baseline: `origin/master@2e6931b` plus `08a6c24`, `330e1d2`, `bb30c8b`, and
  `215aad4` on branch `agent/mixed-team`.
- Predecessor: PR #32 implemented closed-set per-member provider resolution and
  added durable provider query output to the existing Team smoke. This slice
  must prove real execution, not merely policy resolution or scripted runtime.
- Stage: Prove. The brief is the approved design of record; no separate design
  artifact is retained.
- Appetite: one narrow real TeamRun and the exact required supporting commands.
- Real path: sandbox seed -> published Agent/Environment/Team versions -> Task
  admission -> TeamDriver -> three real Paseo provider agents -> shared Paseo
  workspace -> Python artifact -> persisted Run/Work/attempt rows -> Paseo Web.
- Highest unknown: whether all three real provider agents obey the bounded Team
  protocol and complete a forced reject/rework cycle while sharing the intended
  workspace and filesystem artifact.
- Hill status: validated prerequisites; real mixed-provider execution remains
  unproven.

## Scope

- Adapt the existing `.local/seed-team.mjs`; do not create a parallel seed.
- Publish Lead with `free-only`, fixer with `claude/deepseek-v4-flash`, and
  reviewer with `codex/deepseek-v4-flash`.
- Run exactly one primary Work item that asks the fixer to create an
  approximately 100-line Python file in the shared Team workspace.
- Require manager assignment, fixer submission, reviewer rejection, fixer
  correction, manager acceptance, and Team finish. Zero rework is failure.
- Raise the existing bounded `maxAttemptsPerItem` only if the required second
  fixer attempt is otherwise impossible.
- Emit greppable machine-written artifacts containing the TeamRun/root Task
  identity, manifest composition, provider/model execution rows, Work attempt
  and rejecting-review history, and produced Python path/content or digest.
- Use the already prepared stack, model environment, preview proxy, and
  host-rewrite shim; do not re-provision.
- Visually inspect Paseo Web and record the preview URL plus the observed single
  workspace with three readable agent tabs/transcripts.

## Non-goals

- No migration, published schema, public API, credential, durable-state model,
  core dependency, tenant/security boundary, or provider-policy expansion.
- No `@getpaseo/cli` upgrade and no replacement for the existing Host rewrite
  shim.
- No new unit, integration, contract, deterministic E2E, eval, or fixture test
  file.
- No reimplementation of PRs #27 through #32 and no scripted-only claim for the
  mixed-provider acceptance result.
- No generalized team workflow, dynamic roster, retry framework, recovery
  hardening, or UI work.
- No raw `git` command on the sandbox and no sandbox re-provisioning.

## Work breakdown

- [ ] Preserve the sandbox-only seed locally for controlled editing, then give
      a fixer explicit ownership of `.local/seed-team.mjs` only. Require it to
      retain the existing publish/invoke flow while changing the three policy
      refs, Python task prompts, forced rejection/rework sequence, and
      machine-written evidence output.
- [ ] Review the seed diff for exact provider mapping, one Work item, mandatory
      rejecting review followed by a later attempt, safe bounded prompts, no
      embedded credential, and no alternate seed path.
- [ ] Commit each durable repository change locally before syncing it with
      `sandbox-ctl push --mode git`; transfer ignored local seed/evidence only
      through the existing sandbox binding without raw sandbox Git.
- [ ] Start or confirm the prepared Compose stack with
      `PASEO_DEV_WEB_UI=1` and `.local/compose.model.yaml`; preserve the
      `mixed-team-` container prefix and require all three readiness checks.
- [ ] Create a three-hour port `18080` preview and run the existing Host rewrite
      shim from `18080` to Paseo `16767` using the preview hostname.
- [ ] Execute the adapted seed once under real models and wait for terminal
      Team completion; do not substitute the scripted runtime if real execution
      fails.
- [ ] Query persisted rows for the exact TeamRun and write greppable evidence
      proving three distinct executed providers, non-scripted composition, one
      Paseo workspace, the rejecting review, and a later fixer attempt.
- [ ] Verify the produced Python file exists, is approximately 100 lines, and
      reflects the correction requested by reviewer; write its line count and
      SHA-256 digest into the evidence artifact.
- [ ] Open the preview URL and inspect that Lead, fixer, and reviewer appear as
      three tabs beneath one Paseo workspace with readable transcripts.
- [ ] Classify any non-blocking finding as deferred. After one failed diagnosis
      iteration, route further diagnosis to an oracle before changing design.

## Verification

- [ ] `make ci` in `agent-server-mixed` exits 0. If the 5000 ms contract timeout
      flakes, reproduce on the unmodified baseline, report it as environment
      evidence if it reproduces, and continue.
- [ ] `AGENT_TEAMS_V2_SMOKE_RUNTIME=scripted make agent-teams-v2-smoke` exits 0
      with the existing scripted smoke unchanged.
- [ ] `AGENT_TEAMS_V2_SMOKE_RUNTIME=scripted AGENT_TEAMS_V2_SMOKE_REWORK=1 make
      agent-teams-v2-smoke` exits 0 with `attempts=3` and a machine-written
      envelope record containing `kind:rework`.
- [ ] The real run manifest contains `composition.provider_used=true` and a
      `composition.model` other than `scripted`.
- [ ] Durable query output for one TeamRun shows Lead=`opencode`,
      fixer=`claude`, reviewer=`codex`, all three with the expected model, and
      one shared non-empty Paseo workspace ID.
- [ ] Durable Work/attempt/review output shows manager assignment, first fixer
      submit, rejecting review/request-changes, a later fixer attempt/submit,
      acceptance, and terminal Team completion.
- [ ] Machine-written file evidence reports the produced `.py` path, line count
      near 100, and digest; the file content is retained for inspection.
- [ ] Paseo Web visual inspection confirms three agent tabs under one workspace
      and readable role transcripts; record the preview URL and observation.
- [ ] `make paseo-smoke` runs and its exact result is recorded.

## Documentation impact

- [ ] Product/Feature: update only if the observed real mixed-provider Team
      changes the truthful capability ledger rather than serving as evidence
      for the already merged seam.
- [ ] Component/Contract: reconcile any stale provider/runtime description
      discovered by the real run; do not change a public contract without a new
      Human Gate.
- [ ] ADR/Runbook: no ADR or migration runbook is expected. Record the exact
      preview/evidence procedure in this plan unless a durable operations gap
      is discovered.
- [ ] Reconcile the predecessor per-member-provider Active Plan so merged work
      and still-outstanding real-execution evidence are represented truthfully.

## Decisions and discoveries

- The current worktree does not contain `.local/seed-team.mjs` because `.local`
  is ignored; the prepared sandbox contains the existing 139-line seed required
  by the brief. It will be adapted rather than replaced.
- `scripts/smoke/agent-teams-v2-main-flow.mjs` already writes a manifest with
  `composition.provider_used`, emits a durable provider-resolution artifact,
  and contains the scripted rework assertions. Those are supporting/reference
  paths; B and C still require the sandbox seed to execute real models.
- The previous mixed-provider artifact used scripted runtime and therefore did
  not prove provider execution. Policy resolution rows alone are insufficient.
- The required Python task and review semantics are operational evidence for
  this Prove slice, not a new public Team contract.

## Risks and recovery

- Real model behavior is nondeterministic. Keep prompts explicit and bounded;
  fix only blockers that invalidate the required path. Never reinterpret a
  missing predicted transition as success.
- A request to alter a migration, published schema, public API, credential,
  durable-state model, core dependency, or security boundary is a Human Gate:
  stop with facts and options before changing it.
- The provider key is real and billed. Never print, copy into evidence, commit,
  or expose `.local/model.env`.
- Use only `sandbox-ctl push/pull` for synchronization. Exit 75/76 is repaired
  from the local worktree; raw sandbox Git is forbidden.
- Never use `pkill -f` for the Host rewrite proxy. Identify the listener by port
  if replacement is necessary.
- Recovery is ordinary local commits plus the already bound sandbox. Do not
  destructively reset either side.

## Validation evidence

- No acceptance evidence yet. The brief, merged implementation, and sandbox
  readiness are prerequisites, not proof of B or C.

## Completion checklist

- [ ] The real mixed-provider TeamRun and mandatory Python rework flow satisfy
      every acceptance item with machine-written evidence.
- [ ] Required scripted smokes, `make ci`, and `make paseo-smoke` have exact
      recorded results.
- [ ] No Human Gate was crossed without explicit authorization.
- [ ] No credential, raw provider payload, debug code, generated runtime home,
      or unintended file is present in the PR diff.
- [ ] Final oracle review has no unresolved `BLOCKER-NOW` finding.
- [ ] All documentation impact and deferred findings are resolved or
      transferred.
- [ ] Move this plan to `docs/exec-plans/completed/`, set `status: completed`,
      and leave no unchecked boxes.
- [ ] Open exactly one PR covering the complete branch.

## Current blocker

None. The next step is a scoped fixer adaptation of the existing sandbox seed;
no Human Gate is presently implicated.

## Next exact command

Commit this Active Exec Plan locally, then dispatch a fixer with ownership of
`.local/seed-team.mjs` and the check that its dry structural inspection proves
the three exact policy refs plus a forced reject/rework Python workflow.

## Cleanup state

The local worktree was clean before this plan. The prepared sandbox remains
bound at remote path `workspace/mixed-team`; no provisioning or destructive
operation has occurred. The running stack and ignored `.local` files predate
this task.
