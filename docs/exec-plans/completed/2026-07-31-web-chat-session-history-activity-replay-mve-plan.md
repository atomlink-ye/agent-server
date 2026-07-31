---
status: completed
owner: orchestrator
created_at: 2026-07-31
updated_at: 2026-08-01
authority: execution-plan
---

# Web Chat Session History and Activity Replay MVE Implementation Plan

## Outcome

Add durable Chat navigation and per-turn retained runtime activity, then prove
same-chat Agent context plus ordinary Tool and subagent activity in one real
browser flow. The final parity phase preserves Paseo's useful intermediate
assistant, reasoning, Tool, and direct-child rendering instead of substituting
generic progress labels or visual loading effects for runtime data.

## Context and authority

- Worktree: `.worktrees/web-chat-rich-events-mve`
- Branch: `agent/web-chat-rich-events-mve`
- Baseline commit remains `604aa811`; the prior rich-events MVE is an intended
  uncommitted diff in this worktree.
- Design: `2026-07-31-web-chat-session-history-activity-replay-mve-spec.md`.
- The user explicitly approved the new public Session list API, exact
  tenant/workspace/principal isolation, bounded title/preview excerpts, and no
  migration.
- Product stage: Prove / MVE-first.

## Scope

- Add owner-scoped keyset Session summaries from existing ProductSession/Message
  data.
- Add BFF list/create/select and Run Event replay routes.
- Add desktop/mobile Chat history navigation and New Chat.
- Attach live/replayed Activity to each turn and retain it collapsed after
  completion.
- Run a real multi-chat, multi-turn, Tool, and subagent browser acceptance.

## Non-goals

- No migration or persisted titles/summaries.
- No background multi-chat execution, restart recovery, delete/rename/search,
  raw or unbounded Tool/provider data, recursive Subagent descendants, or
  interactive permission controls. Typed bounded safe previews are in scope.
- No newly authored automated tests/evals/fixtures.
- No commit, push, PR, merge, destructive cleanup, or volume deletion.

## Work breakdown

- [x] Add the exact owner/workspace-scoped Session list repository/API contract.
- [x] Add BFF Chat list, New Chat, selection, initial recovery, and Run Event
      replay routes.
- [x] Refactor Web state around selected ProductSession and per-Run projections.
- [x] Implement the Paseo-inspired simplified sidebar/drawer and per-turn
      collapsible Activity UI.
- [x] Run the earliest real browser path; fix only acceptance, safety, or
      verifiability blockers.
- [x] Extend normalized `tool_status` with safe label/summary and optional
      `parent_activity_id`.
- [x] Bridge Paseo provider-subagent list/timeline/update into one-level child
      Tool activity with canonical reconciliation.
- [x] Render nested child Tool rows live and from persisted replay.
- [x] Run one fresh real Subagent whose child timeline contains a safe read and
      search or shell action.
- [x] Synchronize authority docs, evidence, task bundle, and this Plan.

## Paseo streaming parity phase

### Task 1: Expose the same Docker Paseo daemon to the reference Web

**Files:**

- Modify `scripts/dev/paseo-process.mjs` to accept a configurable listen host.
- Modify `scripts/dev/with-paseo.mjs` to honor `PASEO_PORT` and
  `PASEO_LISTEN_HOST` without changing non-Docker defaults.
- Modify `compose.yaml` to set `PASEO_PORT=16767`,
  `PASEO_LISTEN_HOST=0.0.0.0`, and map `127.0.0.1:16767:16767`.

- [x] Pass `listenHost` into the Paseo CLI `--listen` argument while keeping
      `127.0.0.1` as the default.
- [x] Recreate only the `agent-server` and dependent `web` dev services; retain
      named volumes and existing Sessions.
- [x] Prove `http://127.0.0.1:16767/api/health` and
      `ws://localhost:16767/ws` are reachable from the host.
- [x] Start Paseo `v0.1.110` Web on `18081` with
      `EXPO_PUBLIC_LOCAL_DAEMON=localhost:16767` and verify `/sessions` lists the
      provider Session used by Agent Server.

### Task 2: Extend the sanitized runtime projection

**Files:**

- Modify `src/adapters/paseo/paseo-client-port.ts` to retain allowlisted
  reasoning text, typed Tool detail/result/error fields, and direct-child
  assistant/reasoning rows from Paseo timeline events.
- Modify `src/application/ports/agent-runtime.ts` to add optional reasoning text,
  optional typed Tool preview fields, and one direct-child text activity event.
- Modify `src/adapters/paseo/paseo-runtime-adapter.ts` to sanitize, bound,
  correlate, and monotonically project those fields.
- Modify `src/application/runs/execute-run.ts` to serialize only the normalized
  scalar event fields already accepted by Run Event persistence.

- [x] Keep `assistant_text` as a cumulative monotonic snapshot for live answer
      Markdown.
- [x] Extend `reasoning_progress` with an optional cumulative `text` snapshot.
- [x] Extend `tool_status` with optional `detail_kind`, `detail_text`, and safe
      exit/error state; never serialize raw Paseo detail.
- [x] Add a direct-child text activity carrying opaque run-local item ID,
      parent activity ID, `assistant|reasoning` kind, status, and cumulative text.
- [x] Reuse credential screening, workspace-relative path conversion, and safe
      URL projection; cap every persisted preview at 8,000 characters and every
      label/summary at their existing bounds.
- [x] Preserve first-seen Run Event order and update repeated snapshots in place;
      quarantine conflicting provider/parent correlations.

### Task 3: Render live and replayed ordered detail

**Files:**

- Modify `apps/web/lib/stream-reducer.ts` to retain first-seen activity order,
  reasoning text, Tool previews, and direct-child text rows.
- Modify `apps/web/components/chat/activity-panel.tsx` to render concise
  expandable reasoning, Tool detail/result/error, and child timeline content.
- Modify `apps/web/app/globals.css` only for the Paseo-like detail surface,
  streaming text treatment, compact nesting, and mobile containment.
- Modify `apps/web/app/page.tsx` only if required to keep cumulative assistant
  Markdown visibly updating during the active turn.

- [x] Keep collapsed rows at approximately 28–32px and show no decorative status
      text that duplicates the event state.
- [x] Reveal useful intermediate text/details while the Run is active; running
      motion supplements but never replaces streamed content.
- [x] Render direct-child assistant/reasoning/Tool rows under the Subagent parent
      using the same compact timeline language.
- [x] Use the same reducer for live SSE and paged replay so refresh reconstructs
      the identical sanitized timeline.
- [x] Preserve completed default collapse, keyboard disclosure, reduced motion,
      failed truth, and <=390px no-overflow behavior.

### Task 4: Side-by-side same-Session acceptance

- [x] Select the same provider Session in Paseo Web `:18081` and the corresponding
      ProductSession in Agent Server Web `:3001`.
- [x] Run one prompt that produces incremental assistant/reasoning and an ordinary
      Tool; observe live updates in both clients before terminal.
- [x] Run one Subagent prompt with direct-child assistant/reasoning/Tool activity;
      compare both clients before terminal.
- [x] Record allowed differences only: Agent Server sanitization, ProductSession
      shell, compact inline child presentation, and read-only permissions.
- [x] Refresh Agent Server Web and prove replay order/content matches its live
      sanitized timeline.
- [x] Recursively scan browser-visible event payloads for credentials, absolute
      paths, provider IDs, raw prompts, and unbounded provider detail.

## Verification

- [x] Supported Node 24 Web typecheck/build and root check/build pass. The first
      Web build inherited `NODE_ENV=development` and failed; the explicit
      production-environment rerun passed.
- [x] `make paseo-smoke` passes with its success marker.
- [x] Independent Oracle review approves the complete intended diff with no
      Critical or Important findings; final merge readiness is approved.
- [x] Git/PR gate is explicitly preserved as the only remaining operational
      gate; commit, push, and PR have not been performed.
- [x] Session list returns only bounded summaries for the authenticated owner and
      configured Workspace.
- [x] New Chat and selection preserve distinct ProductSession identities.
- [x] Real marker recall proves same-chat continuation with one RuntimeSession and
      provider Agent.
- [x] Real ordinary Tool and subagent activity are visible live and after replay
      with the new reasoning/detail/child timeline fields.
- [x] Terminal Activity collapses and remains expandable after refresh.
- [x] Browser-visible surfaces contain no service token or prohibited runtime
      data.
- [x] `git diff --check` passes.
- [x] Paseo reference Web and Agent Server Web show the same provider Session and
      equivalent live intermediate lifecycle for the acceptance prompts.

## Documentation impact

- [x] README and Feature ledger describe the final Session navigation/activity
      replay and sanitized timeline parity behavior.
- [x] Session/Channel/Runtime Components and Contracts describe the public list,
      BFF selection, and replay boundary.
- [x] Operations and a sanitized evidence packet record the fresh parity path.
- [x] No ADR: no migration, production identity, recovery, or new runtime
      architecture is selected.

## Decisions and discoveries

- Database inspection proved the observed multi-turn Chat already used one
  RuntimeSession and provider Agent; the previous `last message` prompt was not a
  reliable continuity assertion.
- Approach A is approved: public owner-scoped Session summaries with no migration.
- Paseo's live-head/durable-tail interaction is simplified using existing Run
  Events rather than provider-native UI state.
- The user's review rejected the first `category=subagent`-only projection.
  Paseo `v0.1.110` source proves the expected interaction uses
  `provider-subagent-panel.tsx`, the provider-subagent list/timeline/update API,
  and a read-only child `AgentStreamView`.
- The user approved additive `label`/`parent_activity_id` fields and the display
  of screened commands, workspace-relative targets, search queries, sanitized
  fetch locations, and screened Subagent metadata. Raw outputs and identifiers
  remain prohibited.
- The user approved approach A, sanitized timeline parity, and a fixed dev-only
  Paseo port `16767` so Paseo `v0.1.110` Web and Agent Server Web can inspect the
  same daemon and provider Session.
- The implemented projection retains bounded sanitized reasoning text, safe Tool
  detail, and direct-child assistant/reasoning/Tool rows before SSE. Remaining
  fidelity differences are intentional: ProductSession shell, sanitization and
  path redaction, inline child timeline versus Paseo's dedicated child panel,
  and no per-token rows.

## Risks and recovery

- If a real subagent call has a different known Paseo discriminant, stop and
  normalize only that allowlisted shape; never infer activity from text or pass
  raw payloads.
- If free model availability is exhausted, use the locally stored OpenCode Go
  credential with DeepSeek V4 Flash without printing or persisting the key.
- If pagination/query performance is adequate for the observed small dataset,
  defer indexes and denormalized summaries.
- Recovery remains the isolated worktree and retained Compose volumes.

## Validation evidence

- Latest targeted secure acceptance used ProductSession
  `335f93e4-b1d5-4141-8cea-034a06236ab6`, RuntimeSession
  `2d0ee704-6e42-47ee-82c7-e3b8b3fc3961`, Paseo Workspace
  `wks_2348cba9a54db1d2`, and provider Agent
  `3c08685b-548c-4afb-b472-9670e704912c`. A terminal-before long Run showed
  Working with cumulative expanded Thinking and an expanded Explorer child
  timeline, ending with `PARITY_SECURE_DONE`.
- Docker exposes the current Paseo daemon at host port `16767`; health succeeds.
  Paseo Web `v0.1.110` runs at `18081`, connects to the same daemon, and the
  targeted secure run selected the exact provider Session using the
  `runtime_sessions` mapping and `/?open=agent:<id>` route.
- After exact CORS hardening, the actual same-provider Paseo page found and
  expanded Thinking, Explorer, one subagent, and the same final response. The
  fresh scan found no absolute/runtime-cell paths, `ses_` IDs, UUIDs, or long
  hashes; empty text disclosures were `0`. Reference-origin CORS returned `101`
  and an untrusted origin returned `403`.
- RN Web row selection required a Playwright click workaround; assigning
  `textarea.value` and dispatching a raw `input` event does not update React
  state. The fourth run used current element refs with forced/visible-row click
  and `fill`/`type` for the composer.
- Oracle final merge review approved the complete intended diff with no Critical
  or Important findings. Same-status Tool detail/exitCode guards and
  quarantined-public-child terminalization with semantic labels are included.

## Completion checklist

- [x] Real user-visible main flow satisfies the acceptance boundary.
- [x] No BLOCKER-NOW remains; non-blockers are recorded and deferred.
- [x] Implementation and authority docs agree.
- [x] No credential, raw provider payload, prompt, local path, generated runtime
      state, or unrelated modification is tracked.
- [x] Plan/spec moved together to `completed/`; the Git/PR operational gate is
      documented separately as the only remaining operation.

## Deferred work

- Large-history paging and retention/performance hardening.
- Session-list query N+1 optimization and related scale hardening.
- ProductSession/Paseo restart reconstruction and old-session recovery.
- Conservative over-redaction improvements where safe detail may be omitted.
- Evaluation of an outer event wrapper beyond the current flat `output.payload`
  boundary.
- Production identity, ACL, deployment isolation, cancellation UI, and broader
  console functionality remain outside this MVE.

These are non-blocking follow-ups, not unresolved acceptance blockers.

## Next exact command

The only remaining operation is the Git/PR Human Gate: inspect the final status
and diff, fetch/rebase from `origin/master` if required, then obtain approval to
commit the intended diff, push, create a PR to `origin/master`, and report its
URL/checks.

## Cleanup state

Local Compose services and named volumes are retained. Paseo `v0.1.110` reference
Web dependencies are installed under `tmp/paseo-v0.1.110`; its Metro server uses
port `18081`. Paseo daemon port `16767` is mapped from Docker to host.
The screenshot at
`/Users/fanye/.mcporter/agent-server-web-chat-streaming-parity.png` shows an old
compact replay row only; it is not fresh parity acceptance evidence.
