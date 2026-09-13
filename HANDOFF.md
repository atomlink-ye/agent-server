# Lane A handoff

## Session scope

This session exercised the real Coworker conversation product at 1440×900 using
the host-native `dev:runtime` stack, PostgreSQL 15 at the manager-provided
`DATABASE_URL`, and Paseo's authenticated Codex provider (`gpt-5.6-luna`). It
also fixed the product and development defects discovered during that journey.
The branch is `r3/lane-a` and every completed change below is on
`origin/r3/lane-a`.

## Completed work

- `4cc7670` — **fix(dev): forward runtime MCP listener settings**
  - `with-paseo` previously stripped `RUNTIME_MCP_LISTEN_HOST`,
    `RUNTIME_MCP_ADVERTISED_HOST`, and `RUNTIME_MCP_PORT` from the isolated API
    child. Concurrent real stacks therefore collided on the default port
    `39117`. The variables now survive the isolation boundary and are covered
    by the provider-process test.
- `d80f5c2` — **fix(web): keep queued chat work visibly pending**
  - A real long turn plus queued follow-up showed the waiting indicator vanished
    when the first reply arrived, even though the second turn was still running.
    The transcript now tracks unmatched principal turns instead of checking
    only whether the final message came from the principal.
- `6793c22` — **docs(ux): record real Coworker conversation**
  - Added real WebM recordings, screenshots, exact timings, and an honest UX
    assessment under `docs/ux/r3/real/`. The record contains real PostgreSQL and
    Paseo/Codex output, not fixture replay.
- `9d4c8a1` — **fix(web): expose queued chat wait progress**
  - The real 700-word turn showed no visual change for about 40 seconds. The
    pending state now displays both unmatched reply count and durable elapsed
    time, including English and Chinese copy. The elapsed time derives from the
    oldest unmatched persisted message, so it survives reloads.
- `bf82a95` — **fix(test): prevent orphaned Chromium children**
  - Vitest browser projects now launch Chromium with `--no-zygote` and
    `--single-process`. Before the change a focused suite added two to four
    adopted zombie Chromium children. After the change the same focused suite
    exited successfully with the count unchanged at 435.
- `2ccc7fd` — **fix(chat): materialize terminal delivery failures**
  - A real queued follow-up exhausted eight execution-plane attempts and was
    durably dead-lettered, while the browser waited forever because no terminal
    message existed. The worker now awaits dead-letter notification and, after
    the activation is durably parked, appends an idempotent sanitized Agent
    failure reply. Raw provider/runtime errors are not exposed.

## Real-product observations

- Coworker creation through **Create & Chat** worked and opened the conversation.
- A short provider reply took about eight seconds.
- The long reply was acknowledged promptly but did not stream. Its complete
  9,151-character body appeared in one jump 39.8 seconds after acceptance.
- A follow-up could be submitted while the long reply was running.
- Before `d80f5c2`, the first reply made the conversation look complete for 8.9
  seconds while the follow-up still ran.
- Scroll anchoring was correct: after the reader moved up to `scrollTop = 1396`,
  the next reply increased `scrollHeight` from 4187 to 4448 while `scrollTop`
  remained exactly 1396.
- A later real follow-up dead-lettered with the durable reason
  `execution_plane_unavailable`; this exposed the infinite-wait defect fixed by
  `2ccc7fd`.

## Deliberately not done

- **True token/partial-message streaming was not implemented.** The current
  browser contract polls durable completed messages. A correct streaming design
  needs stable partial-message identity, revision ordering, terminal and failed
  states, reconnect/resume semantics, cancellation, and scroll behavior for a
  growing final bubble. This is a cross-layer contract decision, not a safe
  transcript-only patch.
- **No full `test:web` run was performed.** The manager explicitly required
  focused browser suites only for the rest of the round.
- **The terminal dead-letter materialization was not re-exercised with another
  deliberately failing real provider turn.** The manager instructed the lane to
  wrap up immediately. It is covered at the deterministic worker/application
  boundary, but the next session should perform one real recovery verification.
- **Existing zombie Chromium processes were not removed.** They are already
  adopted by PID 1 and cannot be reaped by this process. The launcher fix stops
  new Vitest runs from adding more.
- The supplied untracked `BRIEF.md` and runtime-created untracked `default/`
  workspace were not committed or deleted. They are not product source.

## Broken or limited behavior left for the next agent

1. **Completed-message polling is not streaming.** The UI now honestly shows
   queue depth and elapsed wait, but users still receive no partial output. Start
   with the delivery contract described in `docs/ux/r3/real/README.md`; do not
   fake streaming by animating already-complete text.
2. **Real terminal-failure recovery needs an end-to-end confirmation.** Boot
   `dev:runtime` with a unique API/Web/runtime-MCP port set, force or observe a
   terminal Chat dispatch, and confirm the sanitized failure reply appears once,
   clears the pending indicator, and remains idempotent after restart.
3. **Direct Playwright scripts can still appear to increase the global zombie
   count when other lanes run concurrently.** The controlled Vitest before/after
   proof was stable. Any future audit should attribute processes by parent/start
   time or serialize the measurement rather than relying only on a global count.
4. The real conversation evidence uses WebM because no `ffmpeg`, ImageMagick, or
   GIF encoder was installed. The files play directly and the accompanying PNGs
   preserve the key states.

## Verification actually run

### Runtime environment forwarding

Command:

```bash
CI=true pnpm exec vitest run scripts/dev/paseo-process.test.mjs
```

Verbatim final totals:

```text
 Test Files  1 passed (1)
      Tests  14 passed (14)
```

### Coworker transcript pending, elapsed, bilingual, and scroll behavior

Command (run after each transcript change; the final focused result was the
same):

```bash
CI=true pnpm test:web apps/web/src/features/conversations/components/ChatTranscript.browser.test.tsx
```

Verbatim final totals:

```text
 Test Files  1 passed (1)
      Tests  9 passed (9)
```

The successful post-launcher audit additionally printed:

```text
browser_exit=0 zombie_chrome_before=435 zombie_chrome_after=435
```

### Terminal delivery failure

Command:

```bash
CI=true pnpm exec vitest run src/application/chat/materialize-chat-delivery-failure.test.ts src/entrypoints/chat/worker.test.ts
```

Verbatim final totals:

```text
 Test Files  2 passed (2)
      Tests  6 passed (6)
```

### Required repository lint/type gate

Command:

```bash
pnpm lint
```

Final exit code: `0`. Its final type commands were:

```text
$ tsc -p tsconfig.json --noEmit && pnpm web:check:types
$ pnpm --filter @atomlink-ye/agent-server-web check:types
$ tsc -p tsconfig.app.json --noEmit
```

## What I would do next

1. Start the real stack with PostgreSQL and distinct ports, then verify
   `2ccc7fd` through the browser against one terminally failed dispatch and one
   subsequent successful retry.
2. Add a deterministic composition/integration test proving a parked dispatch
   invokes failure materialization exactly once, supplementing the worker and
   materializer unit tests.
3. Draft the smallest explicit partial-message delivery contract and bring that
   contract through the required Human Gate before implementing real streaming.
4. Re-record the long-turn evidence after terminal-failure verification so the
   videos show queue count, elapsed time, successful completion, and failure as
   distinct states.
