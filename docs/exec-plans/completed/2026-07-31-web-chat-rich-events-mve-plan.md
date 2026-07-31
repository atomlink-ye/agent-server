---
status: completed
owner: orchestrator
created_at: 2026-07-31
updated_at: 2026-07-31
authority: execution-plan
---

# Web Chat Rich Events MVE Implementation Plan

## Outcome

Deliver the approved Quiet-Control-Room/Focused-Conversation Web Chat with safe
Markdown and normalized Paseo Reasoning/Tool activity, then prove it through one
real browser Session.

## Context and authority

- Worktree: `.worktrees/web-chat-rich-events-mve`
- Branch: `agent/web-chat-rich-events-mve`
- Baseline: `origin/master@604aa811`
- Design: `2026-07-31-web-chat-rich-events-mve-spec.md`
- Product stage: Prove / MVE-first.
- User approved public rich-event payload expansion and new Web dependencies.
- Oracle selected a flat scalar allowlisted contract with no database migration.

## Scope

- Expand the Paseo adapter-local stream projection for safe progress, Tool,
  usage, and read-only permission activity.
- Expand the runtime-neutral event union and append those events through the
  existing `output` Run Event/SSE path.
- Add safe Markdown rendering and the approved responsive Web Chat design.
- Update authoritative Feature, Component, Contract, operations, and evidence
  documents with observed behavior only.
- Run a real Browser -> BFF -> Agent Server -> Paseo/OpenCode Session.

## Non-goals

- No Cancel/reset UI or restart recovery.
- No database migration, new outer event type, raw provider payload, or raw
  reasoning text.
- No newly authored automated tests/evals/fixtures.
- No merge, push, PR, destructive cleanup, or retained-volume deletion.

## Work breakdown

- [x] Add the flat scalar runtime/public event union and adapter-local safe
      Paseo extraction.
- [x] Reconcile and append progress, Tool, usage, and read-only permission
      activity through the existing Run Event sink.
- [x] Add safe Markdown dependencies and a shared assistant renderer.
- [x] Implement the approved responsive conversation-first visual design and
      rich-event reducer/projection.
- [x] Run the earliest possible real browser Session; fix only blockers that
      invalidate, expose unsafe data, or make the path unverifiable.
- [x] Synchronize Feature, Component, Contract, operations, evidence, and this
      plan with observed results; explicitly defer non-blockers.

## Verification

- [x] `pnpm web:check:types` passes under the supported Docker/Node 24 path.
- [x] `pnpm web:build` passes under the supported Docker/Node 24 path.
- [x] Existing root type/build checks relevant to changed boundaries pass.
- [x] Real browser Session observes safe rich event(s), live Markdown before
      terminal, one formal Assistant Message, and refresh recovery.
- [x] Browser-visible requests, cookies, storage, HTML, and bundles contain no
      service token or prohibited runtime data.
- [x] `git diff --check` passes.

## Documentation impact

- [x] README and Feature ledger describe the richer MVE and limits.
- [x] Channel/Paseo Components and Runtime/Run Contracts describe the exact
      allowlisted event boundary.
- [x] Operations and evidence record the real Session and safe reproduction.
- [x] No ADR: this does not select production identity, recovery, or a new
      runtime architecture.

## Decisions and discoveries

- The public contract keeps `type=output` and flat scalar payloads; existing
  JSONB storage and outer event types need no migration.
- Reasoning is represented as progress state only. Raw reasoning prose remains a
  security/public-contract follow-up.
- Tool summaries are fixed server-owned labels and never provider-derived text.
- The UI follows design A leaning toward B: conversation first, compact runtime
  activity, secondary details.
- The final public rich-event boundary remains flat scalar `output` payloads;
  outer Run Event types and PostgreSQL storage are unchanged.
- Reasoning is live-only progress. Final Timeline catch-up reconciles assistant
  and Tool entries but does not replay reasoning progress.
- The real session used `opencode/deepseek-v4-flash-free`; evidence retains no
  prompt or assistant body.

## Risks and recovery

- If the selected free model emits no Tool event, use a safe prompt that asks it
  to inspect a harmless workspace fact; if free availability is exhausted, use
  the locally stored OpenCode Go credential with DeepSeek V4 Flash without
  printing or persisting the key.
- If a rich provider shape is ambiguous, drop it rather than forwarding it.
- If rich events block the real path, preserve assistant Markdown plus lifecycle
  and record the unsupported event as deferred; do not bypass redaction.
- Recovery is the isolated worktree. Do not reset or clean unrelated state.

## Validation evidence

- Worktree created cleanly from `origin/master@604aa811`.
- Supported Docker stack resolved Node 24.18.0, pnpm 11.7.0, Paseo 0.1.110, and
  OpenCode 1.18.4.
- `make setup`, Web typecheck/build, root `pnpm check`, root `pnpm build`, and
  `git diff --check` passed. The final check covered 115 Markdown files and Exec Plan
  6/6 tests across 32 plans. Mirror supply-chain policy passed 604 lockfile
  entries; the existing sherpa-onnx-darwin-x64 publication-time metadata caveat
  did not change integrity enforcement.
- Real browser evidence is recorded in
  `docs/evidence/web-chat-rich-events-mve-evidence-packet.md`.

## Completion checklist

- [x] Real user-visible main flow satisfies the acceptance boundary.
- [x] No BLOCKER-NOW remains; non-blockers are recorded and deferred.
- [x] Implementation and authority docs agree.
- [x] No credential, raw provider payload, prompt, local path, or generated
      runtime state is tracked.
- [x] Plan/spec moved together to `completed/` with no unchecked items.

## Current blocker

None. Final independent review returned `FINAL_APPROVED`.

## Next exact command

No further implementation command. Await the owner's Git/PR decision.

## Cleanup state

The supported Agent Server/Web/PostgreSQL services and temporary visual
companion server are stopped. The transient favicon issue was resolved by
stopping Web, deleting only the generated `.next`, and restarting for the final
browser check. Named volumes and retained data remain; no volume was deleted.
