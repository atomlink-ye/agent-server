---
status: completed
owner: orchestrator
created_at: 2026-08-06
updated_at: 2026-08-06
authority: execution-plan
---

# Team communications Wave 1

## Outcome

Rename the runtime MCP server without losing safe Tool event names, and place
the Lead plus all members of one TeamRun in one durable Paseo Workspace while
retaining a separate filesystem Cell for every RuntimeSession.

## Context and authority

The accepted design is
`DESIGN-2026-08-06-team-comms-and-prompt-optimization.md`, limited to V10,
V9/F, and its provider-neutral governing constraint. The baseline registers
`agent-server-memory-api` in two coupled locations and creates a managed Paseo
Workspace per RuntimeSession.

## Scope

- Export one runtime MCP server-name constant and consume it at registration
  and safe Tool-name normalization.
- Resolve an existing TeamRun Workspace through durable RuntimeSession state,
  reuse it for new member Agents, and persist that Workspace ID on every member
  RuntimeSession.
- Use a TeamRun-derived Workspace title, member name/role Agent titles, and
  `team_run_id`, `member_name`, and `role` Agent labels.
- Keep `PASEO_WORKSPACE_TITLE` as the non-Team/fallback title.

## Non-goals

- No prompt relocation, delivery envelope, catalog change, rework-scenario
  authoring, messaging, park/wait, provider-neutral port rename, schema change,
  migration, or new test/fixture work.
- Do not change `runtimeCellPolicy`, Cell CWD derivation,
  `AGENT_SERVER_MEMORY_API_SKILL_REF`, or `skills/agent-server-memory-api`.

## Work breakdown

- [x] Rename the MCP server through one exported constant and preserve Tool
      event name normalization.
- [x] Add the durable TeamRun Workspace lookup and reuse it independently of
      the per-session Cell CWD.
- [x] Add the TeamRun Workspace title, per-agent title, and requested labels.
- [x] Review the complete diff against the two-item scope and provider-neutral
      constraint.

## Verification

- [x] Remote scripted `make agent-teams-v2-smoke` prints `RESULT_PASS`, the
      required persistent-Lead assertions, and the required durable cardinality.
- [x] Remote PostgreSQL query prints one distinct non-null Paseo Workspace ID
      for the smoke TeamRun's Lead plus two members.
- [x] Remote emitted-event grep shows `tool_name` after the MCP rename.
- [x] Remote `make paseo-smoke` prints `PASEO_OPENCODE_BASELINE_OK`.
- [x] Remote `make ci` executed. Type/format/docs and 391 unit tests passed;
      `runs.contract.test.ts` hit variable 5000 ms timeouts that the owner
      independently reproduced at unmodified `c9d7c54`, so this is recorded as
      a sandbox environment result rather than a Wave 1 regression.

## Documentation impact

- [x] Product/Feature: no status or product-scope change is required.
- [x] Component/Contract: synchronized the Paseo component and internal Runtime
      contract with shared TeamRun Workspace semantics and Agent metadata.
- [x] ADR/Runbook: no architectural decision or operator-command change is
      required.

## Decisions and discoveries

- `runtime_sessions.paseo_workspace_id` remains the durable home. A TeamRun
  lookup joins member RuntimeSessions and fails closed on conflicting distinct
  Workspace IDs; no table, migration, or package-schema change is needed.
- The Team Lead completes its first control turn before member Work is
  dispatched, so its provider binding establishes the TeamRun Workspace before
  concurrent member Agent creation.
- `TeamRun` does not carry a published Team display name. This wave therefore
  derives the Workspace title from TeamRun identity; configured
  `PASEO_WORKSPACE_TITLE` remains the adapter fallback outside Team execution.
- The runtime-port additions are internal placement/presentation metadata. No
  public HTTP/event/schema, tenant, credential, or isolation contract changes.
- The existing scripted main-flow runtime now honors the create input's durable
  Workspace ID. Its existing evidence output queries `runtime_sessions` and
  emitted `run_events`; no new test or fixture file was added.
- Final review found that a first-turn Lead could dispatch a direct message
  before its post-execution provider binding was durable. The create input now
  carries an optional binding callback; Paseo and the scripted runtime persist
  the Team binding after Agent creation and before the first prompt is sent.
  The previous post-execution bind remains the compatibility fallback.

## Risks and recovery

- A missing Tool-name prefix co-change silently removes `tool_name`; acceptance
  requires emitted-event evidence.
- A Workspace lookup returning multiple IDs fails closed rather than selecting
  one. Recovery is to stop and inspect durable state; repair/migration is out of
  scope.
- Rollback is the commits on `agent/team-comms-wave1`; no data migration exists.

## Validation evidence

- Scripted Team smoke: `RESULT_PASS`; persistent Lead assertions unchanged;
  durable cardinality `team_members=3`, `work_items=2`, `attempts=2`,
  `direct_messages=1`.
- Durable SQL marker: `runtime_sessions=3`, `bound_runtime_sessions=3`,
  `distinct_paseo_workspace_ids=1`.
- Emitted-event SQL marker and standalone grep:
  `tool_name=synthetic_stock_snapshot`.
- Paseo smoke: `PASEO_OPENCODE_BASELINE_OK`, provider `opencode`, model
  `opencode/deepseek-v4-flash-free`, status `succeeded`.
- CI environment observation: check/type/format/docs and unit tests passed;
  contract runner timeouts reproduced on the unmodified baseline and varied by
  rerun. No timeout threshold or test was changed.
- Final and follow-up read-only reviews found no remaining Critical/Important
  issues after early provider binding was persisted before first prompt send.

## Completion checklist

- [x] Requested code and documentation agree.
- [x] All five required remote acceptance commands/artifacts are recorded
      literally.
- [x] No unrelated, generated, credential, or local-path content is committed.
- [x] Plan is completed and moved to `docs/exec-plans/completed/`.

## Current blocker

None.

## Next exact command

Commit the completed plan archive, push the exact committed tree, and verify
the local branch is clean.

## Cleanup state

The implementation commits are pushed and the remote build/test target is
cleanly reproducible. Remote evidence logs remain disposable under `/tmp`; no
runtime, generated, or credential files are committed.
