---
status: active
owner: orchestrator
created_at: 2026-08-06
updated_at: 2026-08-06
authority: execution-plan
---

# Team communications Wave 2

## Outcome

Make Team control deliveries visibly attributable without treating prompt text
as authority, move stable Team protocol and roster context into the native
create-time system prompt, and add a reproducible rework scenario that captures
the known frozen-member-catalog failure for a later wave.

## Context and authority

The authoritative brief is
`tasks/active/agent-server-implementation-20260722/BRIEF-wave2-comms-and-prompt.md`.
The accepted design is
`tasks/active/agent-server-implementation-20260722/DESIGN-2026-08-06-team-comms-and-prompt-optimization.md`,
limited to recommendations A, B, G, and the config/seed-only part of E. The
implementation baseline is `97d9c15` on `agent/team-comms-wave2`.

This is a product-implementation `prove` slice. The first real path is the
scripted second-attempt delivery, whose expected observation is
`Runtime grant allowed tools exceed catalog.` The failure is required evidence,
not authorization to fix the member catalog.

## Scope

- Add `AGENT_TEAMS_V2_SMOKE_REWORK=1` to the existing Team smoke harness. In
  that mode the Lead creates two Work items, receives two completed first
  attempts, requests substantive changes on one, and drives a second delivery
  before accepting both and finishing if the runtime permits it.
- Capture the first rework-mode sandbox result before changing product code.
- Build Team create-time system text from only role, fixed roster, and static
  text. Move the stable Lead control protocol and authority warning there.
- Keep goal, board, policy limits, allowed commands, eligible targets, and a
  short permanent-protocol anchor in every Lead user turn. Move direct,
  work-attempt, and Lead turn-kind guidance from `systemPrompt` to user turns.
- Prefix assignment, direct, rework, and Lead deliveries with the bracketed
  `[agent-server · team:... · to:... · kind:... · from:... · seq:...]`
  envelope and state that authoritative current state is available through
  agent-server tools.
- Use server-derived TeamRun, recipient, sender, kind, and sequence values only;
  preserve capability enforcement exclusively in catalog/grant/tool checks.
- Give scripted fixture roster names and the root Task wording readable demo
  language without changing package schemas or public contracts.
- Update existing stale smoke expectations and relevant runtime/component
  documentation only; author no new tests or fixture files.

## Non-goals

- No member catalog-superset/V6 fix, even when the rework scenario fails.
- No park/wait tool, message-list tool, member message-send capability, or new
  messaging API.
- No literal `<system>` tag, positive human-message marker, text-derived
  authority, provider-specific formatting, or provider-neutral port rename.
- No change to `managed-environment-package.ts`, provider literals, dependency,
  migration, durable-state model, public API/event/schema, tenant/security
  boundary, credentials, or execution isolation.
- No one-off manual rework stimulus and no new unit, integration, contract,
  deterministic E2E, evaluation, or fixture tests.
- Do not fix the known 5000 ms contract-suite timeout flake.

## Work breakdown

- [ ] Add the rework harness switch in `Makefile` and
      `scripts/smoke/agent-teams-v2-main-flow.mjs`, including poor-but-completed
      first submission, substantive Lead feedback, second delivery, and
      mode-specific evidence checks.
- [ ] Commit the G-only harness change, push it with `sandbox-ctl push --mode
      git`, run the scripted rework smoke, and record the literal expected red
      output (or report immediately if it does not fail).
- [ ] Add a small provider-neutral Team delivery-envelope formatter and apply it
      to assignment/direct/rework prompts in
      `src/application/teams/team-wake-reconciler.ts` and Lead user turns in
      `src/application/runs/execute-run.ts`.
- [ ] Add a pure Team system-prompt builder in
      `src/application/runs/execute-run.ts` whose inputs are only role, fixed
      roster, and static text; relocate stable protocol/roster/authority prose
      and move all turn-kind guidance to user prompts.
- [ ] Polish scripted roster names and root Task goal wording, then update
      existing smoke assertions for the new prompts and envelope evidence.
- [ ] Synchronize `docs/components/orchestration-kernel.md`,
      `docs/components/paseo-runtime-adapter.md`, and
      `docs/contracts/runtime-contract.md` where current prompt/delivery wording
      would otherwise become stale.
- [ ] Review the complete diff for scoped provider neutrality, absence of
      text-derived authority, no Human-Gate change, no new tests, and no V6 fix.

## Verification

- [ ] `sandbox-ctl push --mode git` after each committed evidence boundary.
- [ ] `sandbox-ctl exec --timeout 15m -- bash -lc
      'AGENT_TEAMS_V2_SMOKE_RUNTIME=scripted AGENT_TEAMS_V2_SMOKE_REWORK=1 make
      agent-teams-v2-smoke'` captures the expected V6 red run before the A/B/E
      implementation and is rerun afterward for the final literal result.
- [ ] `sandbox-ctl exec -- bash -lc 'make ci'` completes, or any failure is
      classified by literal reproduction on unmodified `97d9c15`; the known
      contract timeout remains an environment result.
- [ ] `sandbox-ctl exec --timeout 15m -- bash -lc
      'AGENT_TEAMS_V2_SMOKE_RUNTIME=scripted make agent-teams-v2-smoke'` prints
      `RESULT_PASS` and preserves the owner-provided baseline cardinality and
      persistent-Lead/Workspace markers.
- [ ] A literal sandbox grep/query command proves zero control-protocol strings
      in Lead user deliveries and exactly one in the create-time Team Lead
      `systemPrompt`.
- [ ] A literal sandbox event/delivered-prompt query proves assignment, direct,
      rework, and Lead deliveries begin with the requested bracketed envelope.
- [ ] `sandbox-ctl exec --timeout 15m -- bash -lc 'make paseo-smoke'` completes
      with its literal result.
- [ ] `git diff --check`, scoped diff review, and final `git status --short`
      confirm repository hygiene.

## Documentation impact

- [ ] Product/Feature: confirm the baseline classification remains accurate;
      no status or product-scope change is expected.
- [ ] Component/Contract: record Team create-time static protocol, turn-scoped
      state/guidance, and display-only provenance envelopes in the existing
      orchestration/runtime documents.
- [ ] ADR/Runbook: confirm no new architectural decision or operator runbook is
      required; the harness switch remains an existing smoke option.

## Decisions and discoveries

- The accepted design is already approved; no alternative prompt marker is in
  scope. The envelope is deliberately bracketed and spoofable display framing,
  while MCP tools remain the sole authority boundary.
- `TeamMessage.sequence` supplies assignment/direct/rework sequence numbers;
  `Task.teamSequence` supplies Lead turn numbers. Short TeamRun identity is the
  first eight characters, matching existing Workspace display practice.
- A work-attempt message with `attemptNo > 1` is the rework delivery kind. Its
  sender is resolved from the persisted `senderMemberRunId`, never from text.
- The existing smoke script is the requested reproducible harness and may have
  stale assertions updated; no separate test artifact will be created.

## Risks and recovery

- The expected rework red result may terminalize through a safe normalized
  runtime error rather than print the internal exception at top level; retain
  the literal markers and database/runtime diagnostics that expose the cause.
- Prompt relocation can accidentally leave the protocol in continuation user
  turns or omit it from the first create. Acceptance inspects delivered prompts
  and create input separately rather than inferring from source grep alone.
- Envelope formatting must never become an authorization predicate. Diff review
  will reject any parser or grant path that matches envelope text.
- If a failure appears outside the expected V6 result, rerun the identical
  command on an unmodified `97d9c15` sandbox state. Continue for reproduced
  environment failures; stop only for a non-baseline regression.
- Any discovered migration, published schema/public API, credential, durable
  state, tenant/security, dependency, or isolation change is a Human Gate and
  stops the task before that change.
- Recovery is commit-by-commit revert; this wave has no migration or durable
  data repair.

## Validation evidence

No implementation validation has run yet. The owner-provided `97d9c15`
baseline is `RESULT_PASS`, one persistent Lead RuntimeSession/provider
Agent/Workspace across four turns, one TeamRun Paseo Workspace across three
bound RuntimeSessions, and cardinality `team_members=3`, `work_items=2`,
`attempts=2`, `direct_messages=1`.

## Completion checklist

- [ ] G expected-red artifact and all A/B/E changes are committed.
- [ ] Every requested acceptance command and literal output is recorded.
- [ ] Expected V6 failure and baseline-reproduced environment results are
      reported without being misclassified as Wave 2 regressions.
- [ ] No Human Gate, out-of-scope feature, new test, generated evidence,
      credential, or local absolute path is committed.
- [ ] All plan items are resolved, the plan is moved to `completed/`, and
      `status: completed` is committed.

## Current blocker

None.

## Next exact command

Use `apply_patch` to add `AGENT_TEAMS_V2_SMOKE_REWORK=1` handling to `Makefile`
and `scripts/smoke/agent-teams-v2-main-flow.mjs` without changing runtime catalog
behavior.

## Cleanup state

The worktree is clean at `97d9c15`. The provisioned remote sandbox is reported
synced and clean. No local or remote process was started by this plan.
