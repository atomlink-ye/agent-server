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
create-time system prompt, and add a reproducible rework scenario that records
the known frozen-member-catalog behavior for a later wave.

## Context and authority

The authoritative brief is
`tasks/active/agent-server-implementation-20260722/BRIEF-wave2-comms-and-prompt.md`.
The accepted design is
`tasks/active/agent-server-implementation-20260722/DESIGN-2026-08-06-team-comms-and-prompt-optimization.md`,
limited to recommendations A, B, G, and the config/seed-only part of E. The
implementation baseline is `97d9c15` on `agent/team-comms-wave2`.

This is a product-implementation `prove` slice. The G-first harness result did
not reproduce the expected `Runtime grant allowed tools exceed catalog.`
failure before A/B: the first and second member deliveries are both
`work_attempt` turns, so the first turn freezes the full member work catalog.
The known V6 `direct_message` -> `work_attempt` catalog failure remains
unfixed and deferred to a later wave; it is not authorization to change the
member catalog.

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

- [x] Add the rework harness switch in `Makefile` and
      `scripts/smoke/agent-teams-v2-main-flow.mjs`, including poor-but-completed
      first submission, substantive Lead feedback, second delivery, and
      mode-specific evidence checks.
- [x] Commit the G-only harness change, push it with `sandbox-ctl push --mode
git`, run the scripted rework smoke, and record its literal result,
      including an explanation if the known V6 failure does not reproduce.
- [x] Add a small provider-neutral Team delivery-envelope formatter and apply it
      to assignment/direct/rework prompts in
      `src/application/teams/team-wake-reconciler.ts` and Lead user turns in
      `src/application/runs/execute-run.ts`.
- [x] Add a pure Team system-prompt builder in
      `src/application/runs/execute-run.ts` whose inputs are only role, fixed
      roster, and static text; relocate stable protocol/roster/authority prose
      and move all turn-kind guidance to user prompts.
- [x] Polish scripted roster names and root Task goal wording, then update
      existing smoke assertions for the new prompts and envelope evidence.
- [x] Synchronize `docs/components/orchestration-kernel.md`,
      `docs/components/paseo-runtime-adapter.md`, and
      `docs/contracts/runtime-contract.md` where current prompt/delivery wording
      would otherwise become stale.
- [x] Review the complete diff for scoped provider neutrality, absence of
      text-derived authority, no Human-Gate change, no new tests, and no V6 fix.

## Verification

- [x] `sandbox-ctl push --mode git` after each committed evidence boundary.
- [x] `sandbox-ctl exec --timeout 15m -- bash -lc
'AGENT_TEAMS_V2_SMOKE_RUNTIME=scripted AGENT_TEAMS_V2_SMOKE_REWORK=1 make
agent-teams-v2-smoke'` was run first; it passed because both member
      deliveries were `work_attempt` -> `work_attempt` and therefore froze the
      full work catalog. The known `direct_message` -> `work_attempt` V6 case
      remains a later-wave fix. The same command was rerun after A/B/E with the
      final literal result recorded below.
- [ ] `sandbox-ctl exec --timeout 30m -- bash -lc 'make ci'` completes. The
      current attempt failed only on this plan's Prettier formatting, not the
      environment; the known contract timeout remains an environment result.
- [x] `sandbox-ctl exec --timeout 15m -- bash -lc
'AGENT_TEAMS_V2_SMOKE_RUNTIME=scripted make agent-teams-v2-smoke'` prints
      `RESULT_PASS` and preserves the owner-provided baseline cardinality and
      persistent-Lead/Workspace markers.
- [x] A literal sandbox grep/query command proves zero control-protocol strings
      in Lead user deliveries and exactly one in the create-time Team Lead
      `systemPrompt`.
- [x] A literal sandbox event/delivered-prompt query proves assignment, direct,
      rework, and Lead deliveries begin with the requested bracketed envelope.
- [ ] `sandbox-ctl exec --timeout 15m -- bash -lc 'make paseo-smoke'` completes
      with its literal result.
- [x] `git diff --check`, scoped diff review, and final `git status --short`
      confirm repository hygiene.

## Documentation impact

- [x] Product/Feature: confirm the baseline classification remains accurate;
      no status or product-scope change is expected.
- [x] Component/Contract: record Team create-time static protocol, turn-scoped
      state/guidance, and display-only provenance envelopes in the existing
      orchestration/runtime documents.
- [x] ADR/Runbook: confirm no new architectural decision or operator runbook is
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
- The G-first troubleshooting result was a pass, not a V6 reproduction:
  first and second deliveries both use `work_attempt`, freezing the complete
  member work catalog. The reachable `direct_message` -> `work_attempt` V6
  failure remains deferred and unfixed.
- No Human Gate is required: this wave changes prompt placement and display
  provenance only, not public contracts, durable state, credentials, or
  security boundaries. A minor extra roster query on member continuation is
  deferred as non-blocking hardening.

## Risks and recovery

- The G-first run passed because its two member deliveries were both
  `work_attempt`; retain the literal pass markers and keep the reachable
  `direct_message` -> `work_attempt` catalog failure deferred to the later V6
  wave.
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

The G-first rework harness pass is explained by the first and second member
deliveries both being `work_attempt` -> `work_attempt`; the first turn freezes
the full member work catalog. The known `direct_message` -> `work_attempt` V6
failure remains unfixed for a later wave.

The final first-flow scripted smoke was run with:

```text
sandbox-ctl exec --timeout 15m -- bash -lc 'AGENT_TEAMS_V2_SMOKE_RUNTIME=scripted make agent-teams-v2-smoke'
```

Relevant literal output:

```text
{"marker":"TEAM_PROMPT_CHANNEL_EVIDENCE","at":"2026-08-06T14:55:24.260Z","lead_create_system_protocol_occurrences":1,"lead_user_protocol_occurrences":0,"control_plane_delivery_count":7,"first_envelope_lines":["[agent-server · team:e28bea2d · to:research-lead · kind:lead_turn · from:agent-server · seq:1]","[agent-server · team:e28bea2d · to:risk-reviewer · kind:wake · from:research-lead · seq:2]","[agent-server · team:e28bea2d · to:opportunity-analyst · kind:wake · from:research-lead · seq:1]","[agent-server · team:e28bea2d · to:research-lead · kind:lead_turn · from:agent-server · seq:2]","[agent-server · team:e28bea2d · to:research-lead · kind:lead_turn · from:agent-server · seq:3]","[agent-server · team:e28bea2d · to:risk-reviewer · kind:direct · from:research-lead · seq:3]","[agent-server · team:e28bea2d · to:research-lead · kind:lead_turn · from:agent-server · seq:4]"]}
{"marker":"RESULT_PASS","at":"2026-08-06T14:55:24.260Z","expected":{"terminal":true,"direct":true,"dependency":true,"replay":true},"actual":{"terminal":true,"direct":true,"dependency":true,"replay":true},"durable_cardinality":{"team_members":3,"work_items":2,"attempts":2,"team_messages":3,"direct_messages":1,"lead_turns":4,"member_attempt_runs":2}}
```

Owner baseline values preserved in that run:

```text
{"marker":"PERSISTENT_LEAD_ACCEPTANCE","lead_runtime_session_distinct":1,"lead_provider_agent_distinct":1,"lead_paseo_workspace_distinct":1,"lead_task_count":4,"lead_run_count":4,"lead_context_epoch_count":4,"max_nonterminal_lead_turns":1,"lead_provider_create":1,"lead_prompt_sends_or_continues":4,"lead_creating_task_matches_first":true,"lead_catalog_exact_eight":true}
```

The durable TeamRun Workspace query remained:

```text
{"marker":"TEAM_RUN_PASEO_WORKSPACE_DURABLE_QUERY","runtime_sessions":3,"bound_runtime_sessions":3,"distinct_paseo_workspace_ids":1}
```

The final rework-mode scripted smoke was run with:

```text
sandbox-ctl exec --timeout 15m -- bash -lc 'AGENT_TEAMS_V2_SMOKE_RUNTIME=scripted AGENT_TEAMS_V2_SMOKE_REWORK=1 make agent-teams-v2-smoke'
```

Relevant literal output:

```text
{"marker":"CONTROL_PLANE_ENVELOPE_DELIVERED","at":"2026-08-06T14:59:14.771Z","first_envelope_line":"[agent-server · team:a038ae6d · to:opportunity-analyst · kind:rework · from:research-lead · seq:3]","kind":"rework","recipient":"opportunity-analyst","sender":"research-lead","sequence":3}
{"marker":"TEAM_PROMPT_CHANNEL_EVIDENCE","at":"2026-08-06T14:59:15.812Z","lead_create_system_protocol_occurrences":1,"lead_user_protocol_occurrences":0,"control_plane_delivery_count":7,"first_envelope_lines":["[agent-server · team:a038ae6d · to:research-lead · kind:lead_turn · from:agent-server · seq:1]","[agent-server · team:a038ae6d · to:opportunity-analyst · kind:wake · from:research-lead · seq:1]","[agent-server · team:a038ae6d · to:risk-reviewer · kind:wake · from:research-lead · seq:2]","[agent-server · team:a038ae6d · to:research-lead · kind:lead_turn · from:agent-server · seq:2]","[agent-server · team:a038ae6d · to:opportunity-analyst · kind:rework · from:research-lead · seq:3]","[agent-server · team:a038ae6d · to:research-lead · kind:lead_turn · from:agent-server · seq:3]","[agent-server · team:a038ae6d · to:research-lead · kind:lead_turn · from:agent-server · seq:4]"]}
{"marker":"RESULT_PASS","at":"2026-08-06T14:59:15.814Z","expected":{"terminal":true,"direct":false,"dependency":true,"replay":true},"actual":{"terminal":true,"direct":false,"dependency":true,"replay":true},"durable_cardinality":{"team_members":3,"work_items":2,"attempts":3,"team_messages":3,"direct_messages":0,"lead_turns":4,"member_attempt_runs":3}}
```

The prior CI attempt failed on plan formatting. Its literal command and
relevant failure were:

```text
sandbox-ctl exec --timeout 30m -- bash -lc 'make ci'
[warn] docs/exec-plans/active/2026-08-06-team-comms-wave2.md
[warn] Code style issues found in the above file. Run Prettier with --write to fix.
```

This was a formatting-only exit, not an environment failure. Final sandbox
`make ci` and `make paseo-smoke` remain outstanding; local docs/plan checks and
`git diff --check` are run after this update.

## Completion checklist

- [x] G harness and all A/B/E changes are committed; the G-first result was a
      pass, with the reachable V6 failure explicitly deferred.
- [x] Every requested acceptance command and literal output available so far
      is recorded.
- [x] The G-first pass explanation and known later-wave V6 result are reported
      without misclassifying either as a Wave 2 regression.
- [x] No Human Gate, out-of-scope feature, new test, generated evidence,
      credential, or local absolute path is committed.
- [ ] All plan items are resolved, the plan is moved to `completed/`, and
      `status: completed` is committed.

## Current blocker

Final sandbox `make ci` and `make paseo-smoke` remain pending; the current CI
attempt failed only on this plan's Prettier formatting.

## Next exact command

Run the final sandbox `make ci` and `make paseo-smoke` after the formatting and
docs checks pass; leave this plan active until those results are recorded.

## Cleanup state

The implementation and documentation changes are committed in the active
worktree. No migration, durable-data repair, or generated evidence is part of
this wave.
