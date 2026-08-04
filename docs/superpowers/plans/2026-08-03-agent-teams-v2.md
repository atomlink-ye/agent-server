# Agent Teams v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver one durable Agent Teams v2 runtime and destructively remove the old Team modes after the v2 main chain passes.

**Architecture:** Keep the Task/Run kernel, stable TeamMemberRun and RuntimeSession continuation, shared dependency-aware Work Board, owner fencing, Run Events, registry, and safe BFF. Add context-bound commands, TeamMessage addressed wake, one scheduler/reconciler, narrow gates, and safe Web projection.

**Delivery:** One branch, one eventual PR, four independent phase commits. Phase commits are the only commit boundaries in this plan.

**Validation policy:** The real main-flow E2E is primary. Existing focused checks are supporting evidence. Do not add unit, contract, integration, deterministic E2E, eval, or fixture tests.

---

## Phase 1 — loose inner loop

### Task 1.1 — Establish context and canonical tool policy

**Create**

- `src/application/teams/team-driver.ts`
- `src/application/teams/team-tool-context.ts`
- `src/application/teams/team-command-service.ts`
- `src/application/teams/team-policy-evaluator.ts`

**Modify**

- `src/application/teams/team-tools.ts`
- `src/adapters/team-mcp/team-mcp-tools.ts`
- `src/application/extensions/runtime-tool-grant-service.ts`
- `src/application/agents/built-in-skills.ts`
- `src/infrastructure/extensions/local-runtime-extension-binder.ts`
- `src/entrypoints/mcp/direct-memory-mcp.ts`
- `src/infrastructure/postgres/postgres-collaborative-team-repository.ts`
- `src/application/tasks/execute-team-task.ts`
- `src/bootstrap.ts`

**Delete:** none in this task.

**Steps**

- [ ] Read the existing Team tool registration, grant, command, and bootstrap
      symbols before changing them; preserve their current ports and owner fencing.
- [ ] Add context resolution from the authenticated owner, active TeamRun,
      TeamMemberRun, RuntimeSession, current Task/Run, WorkItem, Attempt, limits, and
      dependency state. The model does not submit IDs, revision, or hash.
- [ ] Make TeamDriver the Phase 1 canonical root Team activation, Lead/member turn
      scheduler, and final-completion facade. Make `execute-team-task.ts` call only
      TeamDriver; keep `execute-run.ts` as leaf member Run execution.
- [ ] Define the Phase 1 canonical tool family as the current-turn legal subset
      of Lead-only `team_work_create`, `team_work_request_changes`,
      `team_work_accept`, `team_finish`, and Member-only `team_state`,
      `team_work_list`, `team_work_checkpoint`, `team_work_submit`.
- [ ] Register only the canonical v2 tools; do not register
      `team_message_send` in Phase 1.
- [ ] Grant Members only `team_state`, `team_work_list`,
      `team_work_checkpoint`, and `team_work_submit`. Grant the Lead
      `team_work_request_changes`, `team_work_accept`, and `team_finish` only when
      the current policy permits them. Members do not receive request-changes,
      accept, or finish capabilities in Phase 1.
- [ ] Make prompt context and runtime grants derive from the same policy result;
      reject stale, cross-member, and cross-owner context without partial mutation.
- [ ] Define `assignee` as a stable published-roster logical name/key, with role
      only for display/validation. Resolve it uniquely within the owner-scoped
      TeamRun roster to a TeamMemberRun; return typed errors for ambiguity or absence.
      Never accept an internal member UUID or treat `assignee` as authorization.
- [ ] Read existing RuntimeSession/providerAgentId continuation and grant symbols.
      Reuse the stable RuntimeSession bearer/grant and providerAgentId across
      Tasks; do not mint a new token per Task or rebuild Provider Agent/MCP session.
      Stable fields are owner scope, TeamMemberRun, and RuntimeSession; Turn-boundary
      refresh may atomically update taskId, runId, allowedTools, and contextEpoch.
- [ ] Before refresh require old Run terminal, no in-flight Team tool, and no other
      active member Task; refresh before `runtime.execute(continue)`. Do not refresh
      only allowedTools while retaining stale Task/Run bindings.
- [ ] Bind local extensions through
      `src/infrastructure/extensions/local-runtime-extension-binder.ts` and update
      `src/entrypoints/mcp/direct-memory-mcp.ts`: remove Team actor
      `productSessionId` fallback; without all of `teamMemberRunId`, `taskId`, and
      `runId`, register no mutation tools.
- [ ] Require every mutation repository call to validate Run.taskId,
      Task.teamMemberRunId, TeamRun/root identity, current non-terminal state, and
      current fence. Generate command hash/id server-side and read revision in the
      transaction. Each MCP call re-resolves bearer/current grant rather than using
      initialize-cached actor/context; stale epoch/context is a typed zero-write
      error. Also check owner scope, single active Task, policy/action, and
      Work/Attempt ownership/state.

**Focused checks and observation**

- [ ] Run `make check`; observe that existing type, format, documentation, and
      Exec Plan checks pass without adding tests.

### Task 1.2 — Implement the member-scoped execution loop

**Create:** none.

**Modify**

- `src/application/runs/execute-run.ts`
- `src/application/teams/agentic-team-executor.ts`
- `src/application/teams/team-tools.ts`
- `src/bootstrap.ts`
- `templates/self-learning-market-research/agents/lead.yaml`
- `templates/self-learning-market-research/agents/opportunity-analyst.yaml`
- `templates/self-learning-market-research/agents/analog-risk-reviewer.yaml`

**Delete after replacement smoke:**

- `src/application/teams/agentic-team-executor.ts`

**Steps**

- [ ] Read the existing RuntimeSession selection and Team executor symbols, then
      move the required logic into TeamDriver and remove the old executor reference;
      do not maintain both executors as long-lived paths.
- [ ] Allow one Lead Turn to issue multiple legal canonical commands, while the
      server resolves all target identities from context.
- [ ] Give members real domain tools for checkpoint and submit; create writes Work
      `pending` plus Attempt `queued`, materialization/claim uses existing
      `in_progress`, and member submit sets Attempt `completed` while leaving Work
      `in_progress` for Lead review. Only the Lead may request changes (next
      immutable queued Attempt plus feedback), accept, or finish.
- [ ] Map checkpoint to a safe durable RunEvent and Team projection fact on the
      current Run; use existing enums and schema without a migration.
- [ ] Confirm Phase 1 creates no migration and uses existing `pending` then
      `in_progress` Work states, `queued`/`running`/`completed` Attempt states, and
      existing TeamRun/TeamMemberRun enums.
- [ ] Preserve root Task/Run, TeamMemberRun, Run Event, and safe error semantics;
      do not add a durable outer scheduler, message table, migration, or second queue;
      TeamDriver performs the in-process turn sequencing.

**Focused checks and observation**

- [ ] Run `make test-integration`; observe existing focused Team/runtime
      behavior remains valid for the v2 schema.

### Task 1.2a — Make descendant submission authoritative

**Modify**

- `src/application/teams/team-driver.ts:118-132`
- `scripts/smoke/agentic-team-chat-main-flow.mjs:149-174,1637-1652`
- `templates/collaborative-team-phase1/agents/analyst.yaml`
- `templates/collaborative-team-phase1/agents/verifier.yaml`
- `templates/collaborative-team-phase1/agents/lead.yaml`
- `templates/self-learning-market-research/agents/opportunity-analyst.yaml`
- `templates/self-learning-market-research/agents/analog-risk-reviewer.yaml`
- `templates/self-learning-market-research/agents/lead.yaml`

**Steps**

- [ ] Preserve a Team-protocol submission even when the outer runtime later
      errors or times out. Replace the member terminal condition with the
      status-only fence below; do not derive completion from runtime text:

  ```ts
  if (attempt.status !== 'completed' && attempt.status !== 'failed') {
    await this.executions.updateAttemptStatus(
      attempt.id,
      'failed',
      null,
      owner,
    );
  }
  ```

- [ ] Restore recursive OpenCode work in the smoke container by removing the
      `task: 'deny'` and `tools: { task: false }` diagnostic restrictions. Keep
      build mode non-interactive with the user-approved configuration:

  ```js
  agent: {
    build: {
      permission: 'allow',
    },
  },
  ```

- [ ] Update inline and source member instructions to state the same protocol:
      the member may spawn subagents freely; descendants share the member's Team
      identity and MCP context; subagents should return domain findings to the
      outer member; the outer member should normally checkpoint and submit the
      final result; a descendant may submit if needed; no domain output, idle
      state, or plain runtime text completes Work without `team_work_submit`.

- [ ] Keep the existing bounded evidence rubric and deterministic rework shape,
      but remove instructions that prohibit task/subagents. After any successful
      descendant or parent submit, instruct the execution tree not to repeat Team
      mutations. Do not add automatic submission or a synthetic evidence path.

- [ ] Run non-provider checks:

  ```bash
  pnpm check:types
  pnpm check:format
  make check
  git diff --check
  ```

  Observe OpenCode config parsing with build permission `allow`, the `task` tool
  available, canonical member MCP tools present, and no secret values printed.

- [ ] Run one bounded retained real smoke through Task 1.3. Accept descendant or
      parent checkpoint/submit receipts as the same member identity. Observe that
      a submitted Attempt remains `completed` even if its outer Run later errors
      or times out, then Lead review/rework/accept/finish reaches root success.

### Task 1.3 — Extend the existing real smoke harness

**Create:** none.

**Modify**

- `scripts/smoke/agentic-team-chat-main-flow.mjs`
- `package.json`
- `Makefile`

**Delete:** none in this task.

**Steps**

- [ ] Read the existing smoke entrypoint and retain its environment allowlist,
      redaction, polling, and retained-state behavior.
- [ ] Extend that same harness stepwise to observe canonical tool grants, a real
      Lead multi-command turn, member domain work, checkpoint/submit and Lead
      request-changes, and same-member RuntimeSession continuation. Observe that the member
      lacks the Lead-only grant and Lead request-changes creates a new queued
      immutable Attempt.
- [ ] Debug with short timeouts and retained state. Fix only blockers to this
      Phase 1 golden path; do not make a synthetic evidence provider the acceptance
      path.
- [ ] Do not rename the harness in Phase 1; Phase 3 performs the rename/convergence.

**Focused checks and observation**

- [ ] Run the existing `make agentic-team-chat-smoke` command with the approved
      model and redacted authorized secret; observe the real inner loop and record
      retained IDs without printing credentials.

### Phase 1 boundary

- [ ] Commit only at phase end after Tasks 1.1–1.3 and their observations:
      `git add src/application/teams/team-driver.ts src/application/teams/team-tool-context.ts src/application/teams/team-command-service.ts src/application/teams/team-policy-evaluator.ts src/application/teams/team-tools.ts src/adapters/team-mcp/team-mcp-tools.ts src/application/extensions/runtime-tool-grant-service.ts src/application/agents/built-in-skills.ts src/infrastructure/extensions/local-runtime-extension-binder.ts src/entrypoints/mcp/direct-memory-mcp.ts src/infrastructure/postgres/postgres-collaborative-team-repository.ts src/application/tasks/execute-team-task.ts src/application/runs/execute-run.ts src/bootstrap.ts templates/self-learning-market-research/agents/lead.yaml templates/self-learning-market-research/agents/opportunity-analyst.yaml templates/self-learning-market-research/agents/analog-risk-reviewer.yaml scripts/smoke/agentic-team-chat-main-flow.mjs package.json Makefile && git add -u -- src/application/teams/agentic-team-executor.ts && git commit -m "Build Agent Teams v2 inner loop"`.

## Phase 2 — durable outer loop

### Task 2.1 — Add TeamMessage and durable repository operations

**Create**

- `src/domain/teams/team-message.ts`
- `src/application/ports/team-message-repository.ts`
- `src/infrastructure/postgres/postgres-team-message-repository.ts`
- `src/infrastructure/postgres/migrations/0024_agent_team_messages.sql`

**Modify**

- `src/infrastructure/postgres/postgres-collaborative-team-repository.ts`
- `src/application/ports/team-execution-repository.ts`
- `src/contracts/teams.ts`

**Delete:** none in this task.

**Steps**

- [ ] Read existing message/event, repository, migration, owner-scope, and
      `run_dispatches` symbols before implementing the approved SQL shape.
- [ ] Add addressed, owner-scoped, ordered TeamMessage persistence with safe kind,
      sender/recipient TeamMemberRun IDs, related WorkItem/Attempt references, and
      delivery/read facts.
- [ ] Create the required forward-only TeamMessage migration. It is a durable-state
      Human Gate. Preserve migrations `0003`, `0019`, `0020`, and `0023`.
- [ ] Do not create a `TeamTurnRequest` domain, table, or port. If canonical
      Message plus queued Task later fails the retained flow, stop at the Human Gate
      and choose the smallest separately approved primitive.
- [ ] Enforce `Message persisted = queued`, unique
      `dedup_key=member:<memberRunId>:wake:<reason/source>`, and immutable input
      Message ID recording.

**Focused checks and observation**

- [ ] Run the existing Postgres/domain focused command selected from current
      Makefile targets after reading them; observe migration and owner-scope behavior
      without adding tests.

### Task 2.2 — Reconcile messages through canonical queued Tasks

**Create**

- `src/application/teams/team-turn-scheduler.ts`
- `src/application/teams/team-wake-reconciler.ts`
- `src/application/teams/team-context-projector.ts`

**Modify**

- `src/application/runs/complete-run.ts`
- `src/infrastructure/postgres/postgres-collaborative-team-repository.ts`
- `src/bootstrap.ts`
- `src/infrastructure/postgres/postgres-run-dispatcher.ts`
- `src/contracts/teams.ts`
- `src/entrypoints/api/routes/team-runs.ts`
- `apps/web/lib/agentic-team-bff.ts`

**Delete:** none in this task.

**Steps**

- [ ] Read `CompleteRun`, queued Task admission, `run_dispatches`, and dispatcher
      claim symbols before wiring the reconciler.
- [ ] Make Message, dependency transition, gate resolution, and terminal facts
      produce canonical queued Task wake through the existing dispatcher. Coalesce
      redundant wakes and fence continuation by owner and TeamMemberRun.
- [ ] Materialize a Task in one transaction that atomically binds
      `consumed_by_task_id` and immutable input Message IDs. Allow at most one active
      Task per member. If Task creation fails, leave Message `queued`.
- [ ] Rebuild work from queued Messages; after Run terminal prove consumption via
      the bound Task/Run, never provider-delivered state.
- [ ] Keep `CompleteRun` limited to terminal facts and durable wake; do not turn it
      into a semantic Team state machine.
- [ ] Record scheduler pause/resume evidence and reconstruct pending wake from
      durable state; do not claim full Agent Server restart recovery.

**Focused checks and observation**

- [ ] Run `make check`; observe the existing checks pass and no second worker or
      queue is introduced.

### Task 2.3 — Prove durable wake on the retained harness

**Create:** none.

**Modify**

- `scripts/smoke/agentic-team-chat-main-flow.mjs`
- `package.json` or `Makefile` only if an existing command needs the new phase
  switches; do not create the final renamed command yet

**Delete:** none in this task.

**Steps**

- [ ] Extend the existing harness to observe addressed Message, canonical queued
      Task, `run_dispatches`, dispatcher claim, idle/wake, and scheduler pause/resume
      evidence.
- [ ] Run stepwise with short timeouts and retained state; if wake is unreliable,
      stop at the durable-state Human Gate rather than inventing a generic queue.
- [ ] Record whether the existing primitives express wake reliably. A new minimal
      primitive is allowed only after that observation and approval.

**Focused checks and observation**

- [ ] Run the existing `make agentic-team-chat-smoke`; observe durable Message and
      queued wake facts in retained state, with no credential output.

### Phase 2 boundary

- [ ] Commit only at phase end after Tasks 2.1–2.3 and their observations:
      `git add src/domain/teams/team-message.ts src/application/ports/team-message-repository.ts src/infrastructure/postgres/postgres-team-message-repository.ts src/infrastructure/postgres/migrations/0024_agent_team_messages.sql src/application/ports/team-execution-repository.ts src/infrastructure/postgres/postgres-collaborative-team-repository.ts src/application/runs/complete-run.ts src/application/teams/team-turn-scheduler.ts src/application/teams/team-wake-reconciler.ts src/application/teams/team-context-projector.ts src/infrastructure/postgres/postgres-run-dispatcher.ts src/contracts/teams.ts src/entrypoints/api/routes/team-runs.ts apps/web/lib/agentic-team-bff.ts src/bootstrap.ts scripts/smoke/agentic-team-chat-main-flow.mjs && git commit -m "Add durable Team messages and wakes"`.

## Phase 3 — collaboration closure and Web projection

### Task 3.1 — Close the Golden Path Work Board

**Create**

- `src/infrastructure/postgres/migrations/0025_agent_team_work_dependencies.sql`

**Modify**

- `src/domain/teams/team-work-item.ts`
- `src/domain/teams/team-work-item-attempt.ts`
- `src/domain/teams/team-run.ts`
- `src/application/teams/team-command-service.ts`
- `src/application/teams/team-policy-evaluator.ts`
- `src/infrastructure/postgres/postgres-collaborative-team-repository.ts`
- `src/adapters/team-mcp/team-mcp-tools.ts`

**Delete:** none in this task.

**Steps**

- [ ] Add only Golden Path dependency evaluation, atomic claim fencing, immutable
      Attempt transitions, minimum submit/idle/finish gates, and owner-safe Direct
      Message semantics needed by the retained flow.
- [ ] Make `0025_agent_team_work_dependencies.sql` forward-only and require the
      durable-state Human Gate. Add an owner-scoped relation with
      `team_run_id`, `work_item_id`, `depends_on_work_item_id`, owner scope fields,
      a unique constraint, and a self-edge prohibition. Do not add unnecessary
      Work/Member enum values.
- [ ] Keep dependency evaluation, claim, and gate changes transactional with owner,
      TeamRun revision, and active-member fencing.
- [ ] Make atomic claim check every dependency WorkItem is `accepted` before
      moving the candidate into existing `in_progress`.
- [ ] Do not build a generic permission framework or graceful shutdown system;
      both are deferred unless the actual Golden Path is blocked.
- [ ] Keep only canonical Phase 1/2 tools as the active invariant; no model-provided
      IDs or revisions.

**Focused checks and observation**

- [ ] Run `make test-integration`; observe existing focused Team behavior remains
      valid for the v2 schema without adding tests.

### Task 3.2 — Add Direct Message and Team Overview projection

**Create:** no new app shell or Project Lab files.

**Modify**

- `apps/web/lib/agentic-team-bff.ts`
- `apps/web/app/page.tsx`
- `apps/web/components/chat/conversation-sidebar.tsx`
- `apps/web/app/globals.css`
- `src/contracts/teams.ts`
- `src/entrypoints/api/routes/team-runs.ts`

**Delete:** none in this task.

**Steps**

- [ ] Read current BFF owner checks and Event projection before extending them.
- [ ] Project only safe Team Overview, addressed Direct Message summaries, stable
      Agent Sessions, Work Board status, gates, and replayable Run Events.
- [ ] Keep RuntimeSession IDs, prompts, credentials, raw provider payloads, local
      paths, and tenant internals out of Web responses.
- [ ] Have the designer own visible hierarchy and responsive behavior; do not add
      Project Lab or a second shell.

**Focused checks and observation**

- [ ] Run `make web-check-types` and `make web-build`; observe safe projection
      types compile and the existing Web build succeeds.

### Task 3.3 — Converge the real smoke and finish the Golden Path

**Create**

- `scripts/smoke/agent-teams-v2-main-flow.mjs`

**Modify**

- `scripts/smoke/agentic-team-chat-main-flow.mjs` during rename/convergence only
- `package.json`
- `Makefile`
- `templates/self-learning-market-research/agents/lead.yaml`
- `templates/self-learning-market-research/agents/opportunity-analyst.yaml`
- `templates/self-learning-market-research/agents/analog-risk-reviewer.yaml`

**Delete**

- `scripts/smoke/agentic-team-chat-main-flow.mjs` only after the new harness has
  equivalent retained-state behavior and the old command is no longer referenced

**Steps**

- [ ] Rename/converge the Phase 1/2 harness without changing redaction or retained
      evidence guarantees.
- [ ] Create `make agent-teams-v2-smoke` invoking the new harness.
- [ ] Debug stepwise with short timeouts and retained state, then run exactly one
      full paid smoke with `PASEO_MODEL=opencode-go/deepseek-v4-flash` and the
      authorized secret through the allowlist without printing it.
- [ ] Observe stable TeamMemberRuns and RuntimeSessions, dependency claim,
      addressed wake, checkpoint/submit or Lead request-changes, minimum finish gate,
      terminal facts, safe Web projection, and refresh replay.

**Focused checks and observation**

- [ ] Run `make agent-teams-v2-smoke`; observe successful terminal Team state and
      safe replay. Existing focused checks remain supporting evidence only.

### Phase 3 boundary

- [ ] Commit only at phase end after Tasks 3.1–3.3 and their observations:
      `git add src/infrastructure/postgres/migrations/0025_agent_team_work_dependencies.sql src/domain/teams/team-work-item.ts src/domain/teams/team-work-item-attempt.ts src/domain/teams/team-run.ts src/application/teams/team-command-service.ts src/application/teams/team-policy-evaluator.ts src/infrastructure/postgres/postgres-collaborative-team-repository.ts src/adapters/team-mcp/team-mcp-tools.ts src/contracts/teams.ts src/entrypoints/api/routes/team-runs.ts apps/web/lib/agentic-team-bff.ts apps/web/app/page.tsx apps/web/components/chat/conversation-sidebar.tsx apps/web/app/globals.css scripts/smoke/agent-teams-v2-main-flow.mjs package.json Makefile templates/self-learning-market-research/agents/lead.yaml templates/self-learning-market-research/agents/opportunity-analyst.yaml templates/self-learning-market-research/agents/analog-risk-reviewer.yaml && git commit -m "Close Agent Teams v2 collaboration flow"`.

## Phase 4 — destructive single-runtime cutover

### Task 4.1 — Define and wire only the canonical v2 TeamVersion

**Create:** none.

**Modify**

- `src/domain/teams/managed-team-package.ts`
- `src/infrastructure/postgres/postgres-invokable-repository.ts`
- `src/bootstrap.ts`
- `src/contracts/teams.ts`
- `src/entrypoints/api/routes/teams.ts`
- `src/entrypoints/api/routes/team-runs.ts`

**Delete:** none in this task.

**Steps**

- [ ] Read current TeamVersion admission, registry, route, and bootstrap symbols;
      then make the v2 fixed roster/Lead/policy/Work/dependency/final-output shape the
      only accepted invocation contract.
- [ ] Remove `execution_mode` driver selection, graph/compiled-plan execution
      contracts, and all mode branches. Do not add a `compiled_plan` policy for an old
      no-Lead DAG.
- [ ] Run a reference scan before deleting anything else; record every runtime,
      route, contract, template, smoke, and documentation reference to old modes.

**Focused checks and observation**

- [ ] Use the old smoke scripts only as behavior reference while implementing;
      they are not gates and are not required to pass.

### Task 4.2 — Delete old runtime, surface, and claims

**Create:** none.

**Modify**

- `src/bootstrap.ts`
- `src/contracts/teams.ts`
- `src/entrypoints/api/routes/teams.ts`
- `src/entrypoints/api/routes/team-runs.ts`
- `package.json`
- `Makefile`
- README/Features/Contracts documentation files that claim old Team modes

**Delete after Task 4.1 passes**

- `src/application/teams/collaborative-team-executor.ts`
- `src/application/teams/agentic-team-executor.ts`
- `src/application/teams/team-phase-coordinator.ts`
- `src/application/tasks/advance-team-execution.ts`
- `src/application/invokables/dag-team-compiler.ts`
- `src/application/invokables/sequential-team-compiler.ts`
- `src/infrastructure/postgres/postgres-team-execution-repository.ts`
- `src/adapters/demo-market/synthetic-team-evidence-provider.ts`
- old tool registrations in `src/application/teams/team-tools.ts` and
  `src/adapters/team-mcp/team-mcp-tools.ts`
- old Team routes/contracts/bootstrap references
- old Team templates and smoke scripts, including
  `scripts/smoke/team-dag-main-flow.mjs`,
  `scripts/smoke/collaborative-team-main-flow.mjs`, and
  `scripts/smoke/agentic-team-chat-main-flow.mjs`
- old package scripts `smoke:team-dag`, `smoke:collaborative-team`, and
  `smoke:agentic-team-chat`, plus their existing Makefile smoke targets

**Steps**

- [ ] Confirm the new v2 real E2E has passed before each destructive deletion.
- [ ] Confirm `src/application/tasks/execute-team-task.ts` remains the canonical
      root Task entry and calls only `src/application/teams/team-driver.ts`; do not
      delete it.
- [ ] Keep migrations `0003`, `0019`, `0020`, and `0023` only as immutable
      migration-chain records; they do not preserve old runtime or reads.
- [ ] Add `src/infrastructure/postgres/migrations/0026_agent-teams-v2-cutover.sql`
      only if schema cleanup is required; it is forward-only and approved by the
      destructive-scope Human Gate.
- [ ] Run the post-delete no-reference scan and remove every old runtime
      reference. Development DB/fixtures may be rebuilt.
- [ ] Update `README.md`, `docs/features.md`, and
      `docs/contracts/agent-team-api.md` so the documented product surface contains
      only the v2 TeamVersion, TeamDriver, canonical tools, TeamRun/MemberRun, Work,
      and TeamMessage; remove old mode claims.

**Focused checks and observation**

- [ ] Run `make agent-teams-v2-smoke`; observe the v2 main chain succeeds.
- [ ] Run the no-reference scan; observe no old executor/compiler/repository,
      route, contract, template, smoke, tool registration, mode branch, or
      documentation claim remains.

### Phase 4 boundary

- [ ] Commit only at phase end after Tasks 4.1–4.2 and their observations:
      `git add -u -- src/application/tasks/execute-team-task.ts src/application/tasks/advance-team-execution.ts src/application/invokables/dag-team-compiler.ts src/application/invokables/sequential-team-compiler.ts src/infrastructure/postgres/postgres-team-execution-repository.ts src/application/teams/collaborative-team-executor.ts src/application/teams/agentic-team-executor.ts src/application/teams/team-phase-coordinator.ts src/adapters/demo-market/synthetic-team-evidence-provider.ts src/application/teams/team-tools.ts src/adapters/team-mcp/team-mcp-tools.ts src/bootstrap.ts src/contracts/teams.ts src/entrypoints/api/routes/teams.ts src/entrypoints/api/routes/team-runs.ts package.json Makefile README.md docs/features.md docs/contracts/agent-team-api.md && git add src/domain/teams/managed-team-package.ts src/infrastructure/postgres/postgres-invokable-repository.ts && git commit -m "Destructively cut over Agent Teams v2 runtime"`.

## Final verification and deferred ledger

- [ ] Under Node 24 run:
      `export NVM_DIR=/Users/fanye/.nvm; . "$NVM_DIR/nvm.sh"; nvm use 24; export PNPM_HOME=/Users/fanye/Library/pnpm; export PATH="$PNPM_HOME/bin:$PNPM_HOME:$PATH"; make check`.
- [ ] Run `git diff --check`; observe zero whitespace errors.
- [ ] Inspect only the three plan/design files for wrong paths, stale status,
      unresolved placeholders, contradictory smoke commands, and forbidden new-test
      instructions; observe none.
- [ ] Record existing focused command results exactly; do not author new tests.

Deferred: generic permission frameworks, graceful shutdown, dynamic rosters, nested Teams, general workflow authoring, a second
generic queue, generalized retry, multi-node leadership, advanced accounting,
full Agent Server restart recovery, cross-TeamRun sessions, production OIDC/ACLs,
broad search, and richer Web history.
