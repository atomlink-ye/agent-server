---
status: completed
owner: orchestrator
created_at: 2026-07-27
updated_at: 2026-07-27
authority: execution-plan
---

# Runtime Bootstrap and Turn Separation MVE-CTX1

# Outcome

For one allowlisted Lark Product Session, create the Paseo/OpenCode Agent with a
stable native `systemPrompt` and the first user turn as `initialPrompt`, then
continue the same provider Agent using only the current user turn. Preserve
durable Message/Task/Run state and server-owned Lark reply delivery.

## Context and authority

- User-approved roadmap:
  `docs/agent-server/项目文档/enterprise-research-agent-platform-v1-spec/roadmap/runtime-bootstrap-turn-separation-mve-first-development-roadmap-paseo-opencode-system-prompt-mainline-2026-07-27.md`
- Repository authority: `AGENTS.md`, `docs/features.md`,
  `docs/components/paseo-runtime-adapter.md`,
  `docs/components/orchestration-kernel.md`, and
  `docs/contracts/runtime-contract.md`.
- Baseline: `origin/master` at `65fe1a4a0187dbae974776d898c59368537df823`.
- Product stage: Prove. The real two-turn Lark path is primary evidence. No new
  unit, integration, contract, deterministic E2E, fixture, or evaluation work
  was authorized or added.
- No separate repository Spec was retained. The reviewed external roadmap is
  the design authority for this slice.

## Scope

- Split stable Runtime Bootstrap from per-Run Turn rendering.
- Add an explicit internal `create | continue` request to `AgentRuntimePort`.
- Pass `systemPrompt` and `initialPrompt` to Paseo only when creating an Agent.
- Pass only the current Turn to `sendAgentMessage` on continuation.
- Preserve the existing ProductSession provider binding, Memory candidate
  behavior, final assistant Message persistence, and Lark result outbox.
- Update the minimum Runtime Contract, Paseo component, orchestration component,
  managed single-Agent runbook, and Feature ledger after the real path worked.

## Non-goals

- No public API, tenant/security boundary, production durable-state model,
  repository migration, or core dependency change.
- No typed context/control protocol, reset/rebind, generation-aware lookup,
  bootstrap receipt/fingerprint, Skills, Team unification, second runtime,
  Memory redesign, RAG, prompt-cache benchmark, or production hardening.
- No new automated tests or evals.
- No Task 14 hardening.

## Work breakdown

- [x] Confirm pinned Paseo/OpenCode source supports native `systemPrompt`.
- [x] Run an isolated two-turn native Runtime probe.
- [x] Replace `assembleContext()` with deterministic Bootstrap and Turn builders.
- [x] Introduce an explicit `AgentRuntimeExecuteInput` discriminated union:
      `create` requires `systemPrompt`; `continue` requires `providerAgentId`.
- [x] Resolve the stable Bootstrap and current Turn in `ExecuteRun`, retaining
      compatibility AgentVersion behavior and the Memory transition.
- [x] Map create to `createAgent({systemPrompt, initialPrompt})` and continue to
      `sendAgentMessage(providerAgentId, currentTurn)` in the Paseo adapter.
- [x] Mechanically migrate existing fakes/callers without adding test cases.
- [x] Run the user-approved real two-turn Lark group-Thread journey and fix only
      `BLOCKER-NOW` findings.
- [x] Record non-blocking findings as deferred work.

## Verification

- [x] Isolated Runtime probe: one Paseo Agent ID, two User Timeline entries,
      `SYSTEM_ACK` on turn 1 and `SECOND_ACK` on turn 2; System text absent from
      User Timeline. Probe Agents were archived after direct inspection.
- [x] Existing focused tests passed 29/29 under Node `v24.18.0`.
- [x] `pnpm check` and build passed under Node `v24.18.0`.
- [x] Real Lark group-Thread turn 1 created a provider Agent with native
      `systemPrompt` and a user-only `initialPrompt`.
- [x] Turn 2 reused the same Product Session and provider Agent, sent only the
      current user task, recalled `ORBIT`, and retained the pinned role behavior.
- [x] A third same-Session turn directly asked for information present only in
      the System Prompt and returned the exact `CTX1_ROLE:` prefix on the same
      provider Agent.
- [x] Three Runs correlated to three assistant Messages, three
      `agent_run_result` outboxes, three delivery attempts, and three delivered
      Lark replies.
- [x] The repository evidence contains no Prompt body, credential, token, raw
      owner ID, raw provider error, or host path.

## Documentation impact

- [x] Product/Feature: updated `docs/features.md` after real evidence existed.
- [x] Component/Contract: updated `docs/components/paseo-runtime-adapter.md`,
      `docs/components/orchestration-kernel.md`, and
      `docs/contracts/runtime-contract.md`.
- [x] ADR/Runbook: no ADR was required; updated
      `docs/operations/managed-single-agent-v1-runbook.md`.

## Decisions and discoveries

- Paseo `0.1.110` persists Agent-specific `systemPrompt` and maps it to OpenCode
  `promptAsync.system`; `sendAgentMessage` sends only new text while Paseo
  reapplies the persisted System Prompt to the same provider session.
- The Paseo Timeline exposes user messages but not System Prompt as a User
  Timeline item.
- Ordinary Lark completion remains server-owned: `CompleteRun` invokes the
  success notifier, which writes an `agent_run_result` outbox delivered as a
  threaded Lark reply.
- Feishu User OpenAPI rejected direct User-to-Bot P2P send with provider code
  `230001`. The user approved the fixed-group same-Thread path for this MVE.
  Manual P2P remains unproven and no extra User scope was granted.
- Code-quality review found no blocker. It deferred avoiding unnecessary
  Bootstrap construction on continuation and enriching the shared fake with
  sanitized operation/authority metadata until a later accepted boundary.

## Risks and recovery

- If a later provider ignores `systemPrompt`, stop and reshape; do not restore
  System/Role text to the User Prompt.
- Generation-aware provider binding, Reset/Rebind, restart recovery, complete
  receipts, and multi-node behavior remain later MVE/hardening work.
- Repository recovery remains branch/worktree deletion before integration; this
  slice added no production migration or new dependency.

## Validation evidence

- Probe Agent `2d045c3f-…`: free OpenCode model, one stable Agent, two User
  Timeline entries, outputs `SYSTEM_ACK` then `SECOND_ACK`; archived.
- Corrected duplicate Probe Agent `15924bf1-…` was also inspected and archived.
- Real Lark group-Thread canary: three ingress events, one Product Session, three
  Tasks, three succeeded Runs, one provider Agent, three assistant Messages,
  three delivered result outboxes, and three delivered attempts. Sanitized Session ref
  `1c069650bafe`; provider-Agent ref `dd16a56e9734`.
- Turn 1 returned `CTX1_ROLE: ORBIT`; turn 2 returned `ORBIT`; turn 3 asked for
  the System Prompt's fixed prefix and returned `CTX1_ROLE:`. Paseo Timeline
  showed exactly the three current User turns and no System/Role text as a User
  message.
- Spec review returned `COMPLIANT`; quality review returned `APPROVED` with no
  `BLOCKER-NOW` finding.

## Completion checklist

- [x] Real-path exit condition is met with no `BLOCKER-NOW` finding.
- [x] Minimum documentation agrees with observed behavior.
- [x] Deferred findings have an explicit destination.
- [x] Worktree contains no generated Probe artifact or secret-bearing evidence.
- [x] Plan is under `completed/`, marked completed, and has no unchecked boxes.

## Current blocker

None. The user-approved group-Thread MVE exit condition is complete.

## Next exact command

Run final Node 24 documentation/check verification and inspect the complete diff.

## Cleanup state

The feature worktree remains active for review. Old merged worktrees and branches
were removed; root `master` is clean and aligned with `origin/master`. The sole
Lark Worker stopped gracefully. The approved isolated PostgreSQL 16 container is
running and retained for user review; it has not been deleted.
