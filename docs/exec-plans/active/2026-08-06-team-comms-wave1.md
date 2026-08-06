---
status: active
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

- [ ] Rename the MCP server through one exported constant and preserve Tool
      event name normalization.
- [ ] Add the durable TeamRun Workspace lookup and reuse it independently of
      the per-session Cell CWD.
- [ ] Add the TeamRun Workspace title, per-agent title, and requested labels.
- [ ] Review the complete diff against the two-item scope and provider-neutral
      constraint.

## Verification

- [ ] Remote scripted `make agent-teams-v2-smoke` prints `RESULT_PASS`, the
      required persistent-Lead assertions, and the required durable cardinality.
- [ ] Remote PostgreSQL query prints one distinct non-null Paseo Workspace ID
      for the smoke TeamRun's Lead plus two members.
- [ ] Remote emitted-event grep shows `tool_name` after the MCP rename.
- [ ] Remote `make paseo-smoke` prints `PASEO_OPENCODE_BASELINE_OK`.
- [ ] Remote `make ci` passes.

## Documentation impact

- [ ] Product/Feature: confirm no status or product-scope change is required.
- [ ] Component/Contract: synchronize the Paseo component and internal Runtime
      contract with shared TeamRun Workspace semantics and Agent metadata.
- [ ] ADR/Runbook: confirm no architectural decision or operator-command change
      is required.

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

Pending remote execution.

## Completion checklist

- [ ] Requested code and documentation agree.
- [ ] All five required remote acceptance commands/artifacts are recorded
      literally.
- [ ] No unrelated, generated, credential, or local-path content is committed.
- [ ] Plan is completed and moved to `docs/exec-plans/completed/`.

## Current blocker

None.

## Next exact command

Commit and push the early-binding review fix, then rerun the remote scripted
Team smoke and affected acceptance evidence.

## Cleanup state

The local tree contains only the scoped implementation/documentation edits
pending commit. Scratch is restricted to `/tmp`; no runtime, generated, or
credential files are in scope.
