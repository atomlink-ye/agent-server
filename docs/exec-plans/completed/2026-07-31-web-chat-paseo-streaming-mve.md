---
status: completed
owner: orchestrator
created_at: 2026-07-31
updated_at: 2026-07-31
authority: execution-plan
---

# Web Chat + Paseo Streaming MVE Implementation Plan

> **For agentic workers:** implement only the assigned bounded task. The real
> browser path is primary evidence; do not add unit, contract, integration,
> deterministic E2E, evaluation, or fixture suites unless the owner explicitly
> expands this plan.

## Outcome

Deliver one internal single-Agent Web Chat path:

```text
Browser -> Next.js BFF -> ProductSession Message -> Task/Run
-> real Paseo/OpenCode -> live assistant text Run Events/SSE
-> terminal -> durable Assistant Message -> browser refresh recovery
```

The browser never receives the Agent Server service-account token. The first
accepted stream surface is assistant text only.

## Context and authority

- User approved route A and direct implementation on 2026-07-31, including the
  minimum Web dependencies, Run Event migration, and assistant-text event
  contract required by this plan.
- Baseline: `origin/master` at
  `2039a1fbff7586e5767174d06b8c45e3945eed37`.
- Worktree: `.worktrees/web-chat-paseo-streaming-mve`.
- Branch: `agent/web-chat-paseo-streaming-mve`.
- Product stage: `Prove`; the primary acceptance is one real browser turn.
- External design authority:
  `enterprise-research-agent-platform-v1-spec/roadmap/web-chat-console-paseo-streaming-mve-first-development-roadmap-2026-07-31.md`.
- Current code already owns durable Workspace, ProductSession, Message, Task,
  Run, final Assistant Message, Run Event reads/SSE, Task cancellation,
  Managed Environment, RuntimeSession, and per-session Runtime Cell behavior.

## Architecture

Use three dependency-ordered slices. A narrow Paseo probe first establishes the
actual `agent_stream` and Timeline synchronization contract. A final-only Web
Chat then proves the Browser/BFF/ProductSession path without depending on the
new stream. The final slice projects only sanitized assistant text snapshots
through an optional runtime event sink into append-only Run Events and the
existing SSE route.

The Web app is a separate Next.js service. Browser requests are same-origin to
the BFF; only the server-side Agent Server client carries the service token.
Persisted ProductSession Messages remain the conversation truth. Run Events are
transient execution projection, and `waitForFinish` remains terminal authority.

## Tech stack

- Existing Node 24 / pnpm workspace, Hono Agent Server, PostgreSQL 16.
- Existing `@getpaseo/client@0.1.110` and OpenCode `1.18.4`.
- Next.js App Router, React, TypeScript, and native `EventSource` in the current
  Web package/code.
- The current page uses a local reducer for active SSE state and the existing
  server-state/message flow. AI SDK `useChat` and its stream protocol are not
  used; planned presentation/data dependencies are not implementation claims.

## Scope

- A disposable real Paseo streaming probe with sanitized event metadata.
- Reproducible fixed Managed Agent/Environment bootstrap for local Web use.
- One fixed Workspace and browser-local ProductSession cookie.
- One-page text Chat with persisted messages, send, running, terminal, failure,
  and refresh recovery.
- BFF REST/SSE proxy with server-only bearer token.
- One migration removing `UNIQUE(run_id,type)` and pure append semantics.
- Optional runtime event sink that emits complete assistant-text snapshots.
- Paseo listener-before-create, pre-ready filtering, Timeline catch-up,
  epoch/sequence dedupe when available, and ordered sink drain.
- Existing Run SSE closes after a persisted terminal event, not merely terminal
  Run state.
- One real Browser -> BFF -> Agent Server -> Paseo/OpenCode acceptance run.

## Non-goals

- No OIDC, shared users, ACL productization, public deployment, CSRF/CSP suite,
  rate limit, or production secret broker.
- No Agent/Workspace/Model picker, Agent Builder, file upload, Artifact viewer,
  Task board, Operator Inbox, Team inspector, multi-thread, edit, regenerate, or
  branch behavior.
- No reasoning, tool detail, permission, usage, notice, todo, compaction, or raw
  provider payload projection.
- No Web cancel/reset UI in the first accepted path.
- No multi-writer sequence allocator, multi-instance projector, durable stream
  recovery, backpressure framework, retention, DLP, capacity work, browser
  matrix, or production deployment.
- No Paseo/OpenCode dependency upgrade and no browser-to-Paseo connection.
- No newly authored automated test/evaluation suites.
- No merge, branch/worktree deletion, retained database deletion, or destructive
  cleanup without separate authorization.

## File map

### Slice 0: probe

- Create `scripts/probes/paseo-agent-stream.mjs`: connect to Paseo, install the
  stream listener before Agent creation, fetch the authoritative Timeline after
  binding, print allowlisted event metadata, and compare the final marker.
- Modify `package.json`: add `probe:paseo-stream`.

### Slice 1A: durable final Chat

- Create `apps/web/package.json`, `apps/web/tsconfig.json`,
  `apps/web/next.config.ts`, `apps/web/postcss.config.mjs`, and
  `apps/web/app/globals.css`: isolated Next.js package and minimal styling.
- Create `apps/web/app/layout.tsx` and `apps/web/app/page.tsx`: one fixed Chat
  page with persisted messages, send, running, terminal, and failure state.
- Create `apps/web/lib/agent-server-client.ts`: server-only authenticated REST
  client with safe error normalization.
- Create `apps/web/lib/session-cookie.ts`: HttpOnly opaque ProductSession ID
  cookie; it never stores the service token.
- Create `apps/web/app/api/session/route.ts`: recover or bootstrap the fixed
  Workspace/ProductSession and return persisted messages.
- Create `apps/web/app/api/sessions/[id]/messages/route.ts`: proxy message reads
  and writes and return authoritative IDs.
- Create `scripts/dev/web-bootstrap.mjs`: use existing authenticated APIs to
  validate/import/publish the fixed Agent and Environment and create/reuse the
  fixed Workspace inputs without direct database mutation.
- Modify `pnpm-workspace.yaml`, root `package.json`, `Makefile`, `Dockerfile`, and
  `compose.yaml`: install, build, and run the Web package as a separate service.

### Slice 1B: live assistant text

- Create a new numbered PostgreSQL migration after the current latest migration:
  drop only `run_events_run_id_type_key`.
- Modify `src/infrastructure/postgres/postgres.ts`: register the migration.
- Modify `src/infrastructure/postgres/postgres-run-event-repository.ts`: replace
  the `(run_id,type)` conflict path with a pure append.
- Modify `src/application/ports/agent-runtime.ts`: add an optional sink whose
  sole MVE event is `{ kind: 'assistant_text'; text: string }`.
- Modify `src/adapters/paseo/paseo-client-port.ts`: expose Paseo-local stream
  subscription and Timeline fetch without leaking Paseo protocol types to the
  application layer.
- Modify `src/adapters/paseo/paseo-runtime-adapter.ts`: listener-before-create,
  pre-ready filtering, Timeline catch-up, dedupe, full-text snapshot projection,
  serialized sink queue, drain-before-return, and listener cleanup.
- Modify `src/application/runs/execute-run.ts`: supply a sink that appends
  `{ type: 'output', payload: { kind: 'assistant_text', text } }` for the current
  Run.
- Modify `src/entrypoints/api/routes/runs.ts`: keep SSE open until a persisted
  terminal event is observed; do not close solely from terminal Run status.
- Create `apps/web/lib/stream-reducer.ts` and
  `apps/web/app/api/runs/[id]/events/route.ts`: replace assistant snapshot text
  by sequence and stream upstream SSE without buffering.
- Modify `apps/web/app/page.tsx`: display live assistant text before terminal,
  then refetch and replace it with the durable Assistant Message.

### Authority and evidence

- Modify `README.md`, `docs/features.md`, `docs/components.md`,
  `docs/components/channel-api-console.md`, `docs/components/paseo-runtime-adapter.md`,
  `docs/contracts.md`, `docs/contracts/runtime-contract.md`, and the relevant
  operations page: record only observed MVE behavior and explicit limits.
- Create `docs/evidence/web-chat-paseo-streaming-mve-evidence-packet.md`: retain
  sanitized IDs, event sequence, screenshots, commands, and limitations only.

## Work breakdown

- [x] **0. Probe the real Paseo stream.** Add and run the isolated probe against
      Paseo 0.1.110/OpenCode 1.18.4. Record event shapes, `seq`/`epoch`, Timeline
      cursor behavior, listener timing, terminal event, and final marker. If the
      stream cannot be reconciled with Timeline, stop Slice 1B rather than guess.
- [x] **1. Add reproducible fixed bootstrap.** Use existing Agent and Environment
      package APIs and stable local configuration; do not add public registry UI
      or mutate PostgreSQL directly.
- [x] **2. Deliver durable final Chat early.** Add the Web service, BFF session
      route, message route, server-only token client, cookie, and minimal page.
      Run one real browser turn and prove final-message refresh recovery before
      starting the streaming migration.
- [x] **3. Make Run Events truly append-only.** Add the one-way migration and
      pure append repository behavior. Preserve existing event types and cursor
      ordering; defer concurrent multi-writer allocation.
- [x] **4. Add the minimum runtime event sink.** Keep the sink optional for
      compatibility. Project only sanitized complete assistant-text snapshots;
      ignore all raw and unknown Paseo payloads.
- [x] **5. Reconcile create-time stream events.** Subscribe before create, bind
      the returned Agent ID, catch up Timeline, dedupe by confirmed real fields,
      serialize sink writes, drain before terminal completion, and always
      unsubscribe.
- [x] **6. Complete BFF SSE and Web projection.** Stream upstream bytes without
      aggregation or caching, replace snapshot text by cursor, show terminal,
      refetch persisted messages, and clear transient text.
- [x] **7. Run the real browser path.** Observe at least one live assistant text
      event before terminal, then prove the durable transcript survives refresh
      and that the token is absent from browser-visible surfaces.
- [x] **8. Synchronize authority docs and evidence.** Record observed behavior,
      commands, exact limitations, failed attempts, and deferred hardening.
- [x] **9. Run narrow supporting checks.** Run Web build/type checks, existing
      repository check/build, and `git diff --check`; broaden only to diagnose a
      blocker discovered by the real path.

## Verification

- [x] Baseline `make setup && make check` passes on Node 24 Docker tooling.
- [x] `pnpm probe:paseo-stream` observes `turn_started`, assistant Timeline
      content, terminal, catch-up of creation-window content, and matching final
      marker without retaining raw provider payloads. Scheme A remains
      unverified, but Scheme B is verified using create-without-prompt, bind,
      listen, then send.
- [x] Durable-final browser canary returns real `message_id`, `task_id`, and
      `run_id`, invokes real Paseo/OpenCode, stores exactly one formal Assistant
      Message, and reloads it after refresh.
- [x] Streaming browser canary displays at least one genuine assistant update
      before terminal, receives the persisted terminal event, replaces transient
      text with the formal Assistant Message, and remains correct after refresh.
- [x] Browser bundle, requests, responses, cookies, Local Storage, and Session
      Storage contain no Agent Server service token or browser Authorization
      header. Sanitized evidence does not retain raw prompt, provider error dump,
      local path, MCP header, Shell output, or file content.
- [x] Final relevant Web build, repository checks/build, and `git diff --check`
      pass; the default-registry metadata timeout and mirror-policy caveat are
      recorded below.

## Documentation impact

- [x] README and Feature ledger distinguish durable final Chat, assistant text
      streaming, and deferred Web Console functionality.
- [x] Components document BFF ownership and runtime-neutral event projection.
- [x] Contracts document the minimum output payload, cursor behavior, and
      persisted terminal event close rule.
- [x] Operations document bootstrap/start/real-browser commands and process
      cleanup.
- [x] No ADR is required because this MVE does not select production identity,
      deployment, stream recovery, or multi-runtime architecture.

## Decisions and discoveries

- Route A is approved: Probe -> durable final Chat -> streaming projection.
- Assistant text is the only first-stream event. Reasoning, tools, permissions,
  usage, cancel, and developer details are deferred.
- Use complete assistant text snapshots and replace semantics unless the real
  probe proves a safer append-delta contract.
- Existing ProductSession Messages remain formal conversation truth; Web never
  writes an Assistant Message assembled from deltas.
- Existing `waitForFinish` remains terminal authority. SSE closes after the
  terminal Run Event is persisted so clients cannot miss terminal due to the
  Run-state/event insertion window.
- The approved dependency set does not include AI SDK transport or `useChat`.
- The current scheduled collaborative-Team external smoke timeout is diagnostic
  context, not acceptance evidence for this single-Agent path.
- Scheme A (`createAgent` with `initialPrompt`) did not expose a creation-window
  seq/epoch Timeline candidate and is not claimed as verified. Scheme B is the
  Slice 1B boundary: create without `initialPrompt`, bind the returned agent ID
  while the global listener is already installed, then call `sendAgentMessage`.
  The existing product adapter must make this minimum behavior change in Slice
  1B.
- Slice 1B uses Scheme B in the product adapter: install the adapter-local global
  stream listener, create without `initialPrompt`, bind the returned agent ID,
  fetch the projected Timeline baseline, then send the first prompt. Assistant
  snapshots are the only runtime sink event; same-epoch sequence ranges are
  used for Timeline catch-up and the sink queue drains before return.
- Post-finish stream handling is quiescent: `waitForFinish` returns, the global
  listener is detached, projected Timeline catch-up runs, and the final sink
  queue drains before execution returns. Pre-ready stream events are ignored;
  they are not buffered. Same-epoch live sequences are monotonic and duplicate
  or out-of-order events are ignored after baseline filtering. Projected
  assistant entries are complete authoritative snapshots: a seen live sequence
  does not suppress Timeline reconciliation when its complete text differs.
- Run SSE initial-cursor reconnects use one minimal `list(runId, cursor - 1, 1)`
  lookup. If that exact persisted cursor event is terminal, the stream closes
  immediately; a nonterminal cursor continues normal `after cursor` polling.
  This remains independent of Run status and adds no repository API or recovery
  state.

- The Web page keeps one in-flight `/api/session` initialization Promise for
  its lifetime, so React Strict Mode's repeated mount Effect cannot create two
  ProductSessions. Each logical send owns one opaque Idempotency-Key; retries
  and unknown POST outcomes reuse that key, while a new message gets a new key.
- The messages BFF requires a non-empty Idempotency-Key of at most 256 bytes
  and forwards it unchanged to Agent Server. The key is not stored in the
  cookie, browser storage, or any long-lived Web state.

## Risks and recovery

- If external free-model availability blocks the canary, preserve the exact safe
  failure classification and rerun with another explicitly free catalog model;
  never silently select paid capacity.
- If Next.js or a proxy buffers SSE, verify the local Node service first and
  record deployment buffering as deferred; do not replace the source of truth
  with browser-to-Paseo WebSocket access.
- If the migration fails, preserve the worktree and database and diagnose the
  exact constraint name; do not reset or drop retained databases.
- Recovery before commit is the isolated worktree. No implementation step may
  modify or clean existing feature worktrees.
- The final fresh-session browser canary proves the narrow BFF/Web live
  projection, terminal convergence, reload recovery, and browser token
  boundary. Old-session restart continuation and broader recovery remain
  deferred.

## Validation evidence

- Worktree created cleanly from `origin/master@2039a1f`.
- Baseline `make setup && make check` passed. Documentation checks covered 110
  Markdown files and Exec Plan checks covered 29 plans.
- 2026-07-31: Slice 0 `./scripts/dev/docker-run -- pnpm probe:paseo-stream`
  completed with Paseo `0.1.110`, OpenCode `1.18.4`, and an explicitly free
  OpenCode model. Scheme A's earlier run had no seq/epoch-bearing Timeline
  candidate before `createAgent()` returned and remains unverified. The updated
  Scheme B run created without `initialPrompt`, proved the listener was installed
  and the agent ID was known before `sendAgentMessage`, then observed
  `turn_started`, assistant Timeline content, `turn_completed` plus finished
  attention, same-epoch seq-range Timeline catch-up, and the final marker. It
  returned `DONE` with `blocksSlice1B: false`. No prompt, assistant body, raw
  event, provider error, path, token, or generated evidence file was retained.
- 2026-07-31: Migration `0021_web_chat_streaming_mve` applied on the running
  Compose PostgreSQL; `run_events_run_id_type_key` is absent and the
  `(run_id,sequence)` constraint remains. After rebuilding/restarting only
  Agent Server, direct API run `a035e740-4318-4641-be5c-2bf9250321ca` produced
  safe summaries `1/started`, `2/output assistant_text`, `3/output`,
  `4/output`, `5/succeeded`; assistant text preceded terminal and the formal
  result existed. After the final Agent Server rebuild/restart, BFF session
  `a2127bd5-317c-44f4-868d-114166d7af6d` run
  `05766027-cf2a-42ac-9189-cb7e69344124` produced
  `1/started`, `2/output assistant_text`, `3/output`, `4/succeeded`; its
  transcript contained one completed Assistant Message. No prompt, assistant
  body, raw event, provider error, path, token, or generated evidence file was
  retained.
- 2026-07-31 debugging discovery: owning continuation `bc94a4cd-3cd9-4ea1-
96f1-fa04705f10a9` had `1/started`, `2/output assistant_text` with length
  145, then `3/failed`; the formal Assistant Message was absent. A safe,
  temporary adapter diagnostic reproduced the same failure in stage
  `send_message`, with an agent ID, baseline Timeline, and one seen assistant
  sequence. The Paseo daemon persistence record showed the continuation agent's
  MCP endpoint belonged to an older runtime-MCP listener; the listener port was
  no longer serving after the API/with-Paseo process lifecycle changed. This
  distinguishes the failure from baseline Timeline, waitForFinish, sink queue,
  or memory-artifact stages. The diagnostic was removed after reproduction.
- 2026-07-31 attempted minimal fix: rehydrate the persisted provider session
  with current MCP overrides before continuation send. The SDK resume operation
  creates a new Paseo wrapper identity and the subsequent real continuation
  still failed at the provider MCP setup/send boundary; no successful fix is
  claimed. New safe canaries `23a0a92d-a7e0-409c-ae6a-c8b431e6c63c` and
  `e316d60f-1459-42c1-9668-dd914285d157` ended `1/started`, `2/failed`.
- 2026-07-31 ora-1 backend canary after the final Agent Server stack restart
  used fresh ProductSession `76aaff20-de88-4986-9f93-e7058a7974ca` and Run
  `4b1e323f-e708-44b5-8e2d-3b5429ea2b8a`. Safe event summaries were
  `1/started`, `2/output assistant_text(len=23)`, `3/output`, `4/succeeded`;
  assistant text preceded terminal and the session transcript contained one
  completed Assistant Message. No old-session restart recovery was attempted.
- 2026-07-31 ora-4 SSE reconnect check after Agent Server rebuild/restart used
  completed Run `4b1e323f-e708-44b5-8e2d-3b5429ea2b8a`: Last-Event-ID `4`
  (persisted `succeeded`) returned zero bytes immediately; Last-Event-ID `1`
  returned safe summaries `2/output assistant_text`, `3/output`,
  `4/succeeded`. Query/header precedence and event formatting were unchanged.
- 2026-07-31 Web 1B implementation checks passed: Web typecheck/build, root
  check/build, Prettier, Compose config, and `git diff --check`. The final fresh
  browser evidence below adds the live-before-terminal, formal replacement,
  reload, persistence, and token-boundary observations.

- 2026-07-31 final fresh-session Browser acceptance used ProductSession
  `f9242577-aab9-4f03-b983-17d7d5316b93`, User Message
  `4d79eb83-a7ca-4415-8832-4696b62bb862`, Task
  `b4ff72b3-0597-4c75-b679-1b8f9cfce440`, and Run
  `9ea0dc45-c196-4976-b654-76d06312e91a`. Browser POST returned `202`; observed
  events were `1/started`, `2/output assistant_text(len=7)`,
  `3/output assistant_text(len=25)`, `4/output final-compat(len=25)`, and
  `5/succeeded`. The complete transient snapshot was visible while status was
  still running before the terminal event, then one formal Assistant Message
  replaced it. Reload restored completed status, one Assistant Message, and the
  same final result. Database inspection confirmed exactly one User Message
  and one Assistant Message for the Task and the partial/full snapshot event
  sequence. Browser checks found no Authorization header or service token in
  browser-visible request, storage, HTML, or client-bundle surfaces; only the
  `product_session_id` cookie name was present. Backend and Web Oracle reviews
  returned `SPEC_COMPLIANT` and `QUALITY_APPROVED`.

- 2026-07-31 final supporting checks passed: `pnpm web:check:types` and
  `pnpm web:build` completed successfully. Default-registry `make check` did
  not reach project checks because npm metadata requests repeatedly timed out;
  no lockfile or policy change was made. The one-shot mainland-China override
  `PNPM_CONFIG_REGISTRY=https://registry.npmmirror.com ./scripts/dev/docker-run
--pass-env PNPM_CONFIG_REGISTRY -- pnpm check` passed lockfile supply-chain
  policy for 506 entries in 10.4s, root typecheck, Prettier, documentation
  checks for 112 Markdown files, and Exec Plan checks for 30 plans with 6/6
  test cases. The same override with `pnpm build` passed root TypeScript build
  and lockfile policy for 506 entries in 10.7s. `pnpm exec prettier --check .`,
  `docker compose config --quiet`, and `git diff --check` passed. Mirror
  metadata included publication times for the probed OpenCode SDK version but
  lacked `time` only for `sherpa-onnx-darwin-x64`; pnpm skipped
  `minimumReleaseAge` for that package under the existing default policy while
  integrity and all other existing policies remained active. This is an
  environment metadata caveat, not a code or policy failure.

## Completion checklist

- [x] The real Browser -> BFF -> Agent Server -> Paseo/OpenCode path meets the
      exact acceptance boundary.
- [x] At least one live assistant text event precedes terminal and the refreshed
      formal transcript matches the final result.
- [x] No BLOCKER-NOW remains; every other finding is classified and deferred.
- [x] Implementation, Feature, Component, Contract, Operations, and evidence
      documents agree.
- [x] No credential, raw provider payload, prompt, local path, generated runtime
      state, or unrelated existing modification is tracked.
- [x] Plan is truthful and moved to `completed/` only after all items are met or
      explicitly transferred.

## Current blocker

No BLOCKER-NOW remains for the accepted fresh-session BFF/Web live projection.
The failed old ProductSession continuation is classified as deferred restart
hardening, not a current-path blocker: its persisted Paseo Agent referenced a
Runtime MCP random port from before Agent Server/Paseo restart. The accepted MVE
creates a new ProductSession after the final stack starts and requires browser
reload only; it does not claim backend restart reconstruction, provider rebind,
Grant/header renewal, or crash recovery.

## Slice 1A implementation update

- Implemented the isolated `apps/web` Next.js App Router service for the
  durable-final path only. The page has one fixed Agent title, persisted
  messages, Running/Completed/Failed state, plain-text input, disabled send
  while running, and a retry prompt. It does not render live assistant text,
  Reasoning, Tool, Permission, Usage, Cancel, picker, file, or thread UI.
- Implemented server-only Agent Server REST access. The service token is read
  only by `apps/web/lib/agent-server-client.ts`; Browser requests are same-origin
  BFF requests and the opaque `product_session_id` cookie is HttpOnly.
- Normalized Agent Server's camelCase GET message response and snake_case POST
  message response into one validated snake_case browser contract. The page
  tracks the submitted `task_id`, not a transient message status or optional
  run identity, and only marks Completed after a formal Assistant Message with
  the same `task_id` is present.
- Implemented `/api/session` recovery/bootstrap and the session message GET/POST
  proxy. The page polls persisted Session Messages at low frequency to observe
  the formal user-message status and then re-reads the formal Assistant Message.
  No Run Event, runtime, migration, or Paseo code was changed for 1A.
- Added `make web-bootstrap` reproducible bootstrap. When fixed IDs are absent,
  the Docker Node 24 runner reuses the Managed Agent/Environment smoke YAML,
  validates/imports/reads/publishes through authenticated APIs with stable
  idempotency keys, creates or verifies the fixed Workspace, and writes only
  non-secret configuration to ignored `.local/web-bootstrap.env`. Existing IDs
  are verified and reused.
- Added `CI=true` to the Compose development/runner services so detached
  Docker-first startup does not block on pnpm's no-TTY module purge prompt.
- Web typecheck and production build pass. A real Browser turn returned formal
  Message/Task/Run IDs, produced one formal Assistant Message, and preserved it
  across browser reload without exposing the service token.

### Slice 1A result

- Empty-database bootstrap creates and publishes the fixed AgentVersion and
  EnvironmentVersion through existing APIs and writes only non-secret IDs to
  `.local/web-bootstrap.env`.
- React Strict Mode initialization and logical-send retry/idempotency risks are
  addressed in the implementation. A subsequent browser submission created only
  one additional ProductSession and converged to one user/assistant pair for the
  same Task/Run.

## Slice 1B Web implementation update

- Added a Node-runtime same-origin SSE BFF at
  `apps/web/app/api/runs/[id]/events/route.ts`. It requires the HttpOnly
  `product_session_id`, verifies `run_id` ownership through normalized Session
  Messages, injects the server-only Bearer token, forwards `after` and
  `Last-Event-ID`, and returns the upstream body without buffering or parsing.
- Added `apps/web/lib/stream-reducer.ts`. It accepts only ordered Run Event
  responses, rejects sequence duplicates/regressions, replaces assistant text
  from `output.kind=assistant_text` snapshots, ignores final compatibility
  `output{text}` and unknown events, and recognizes only succeeded/failed/
  cancelled terminals.
- The page now opens native same-origin EventSource for the submitted or
  reloaded `run_id`, renders a transient Assistant message before the formal
  message exists, closes on terminal/disconnect, and continues formal Message
  polling. The existing Strict Mode initialization guard and logical-send
  Idempotency-Key behavior remain unchanged.
- The final fresh-session Browser acceptance observed live-before-terminal
  ordering, terminal convergence, formal Message replacement, and reload
  recovery. It intentionally does not claim old-session restart recovery.

## Final exact verification commands

The final checks were:

```bash
pnpm web:check:types
pnpm web:build
PNPM_CONFIG_REGISTRY=https://registry.npmmirror.com ./scripts/dev/docker-run --pass-env PNPM_CONFIG_REGISTRY -- pnpm check
PNPM_CONFIG_REGISTRY=https://registry.npmmirror.com ./scripts/dev/docker-run --pass-env PNPM_CONFIG_REGISTRY -- pnpm build
pnpm exec prettier --check .
docker compose config --quiet
git diff --check
```

The default-registry `make check` metadata timeout is retained as an
environment caveat; the regional registry override was one-shot only and no
regional registry or policy weakening was committed.

2026-07-31 verification: a new Compose project/database bootstrapped missing
Agent/Environment IDs successfully twice with one AgentVersion, one
EnvironmentVersion, and one `Web Chat MVE` Workspace. `make web-dev` also
started the Docker-first stack and served the Web page with HTTP 200. The first
real Browser turn completed and survived reload. After the Strict Mode and
idempotency fixes, a second browser context increased ProductSession count by
exactly one; its formal user and Assistant Messages shared one completed Task
and Run.

## Cleanup state

The probe's Paseo process and temporary cwd were cleaned in `finally`; no
retained PostgreSQL or existing worktree was touched. The existing Compose
services remain running after Agent Server rebuild/restart; no volumes were
deleted. Temporary SSE captures and cookie files were removed after evidence
extraction.
