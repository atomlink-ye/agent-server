# Lane C session handoff

Branch: `r3/lane-c`

Final implementation commit at handoff time: `6ecda07`

## Completed

### Work page task-oriented information architecture

- `e6c6476` — audited the user jobs served by Work before implementation.
- `ac42f22` — made the latest WorkRun a task-oriented summary with a state-specific primary action.
- `d55dc2f` — localized the new WorkRun task actions.
- `489b089`, `5d547a2` — added browser geometry/behavior coverage without rendered-text float pins.
- `39f7d96`, `712c0cf` — documented the IA and before/after measurements.
- `63818f3` — retained the deliberate latest-row geometry.

### Chinese Work typography and density

- `7b443a0` — introduced shared zh-CN Work-surface typography tokens and stronger metadata contrast.
- `22f7a93` — covered CJK density and preserved the deliberate 49.5px rows, 26px tabs, and 624px cards.
- `d38477e`, `48d458f` — restricted the CJK scale to explicit Work surfaces so reused legacy classes do not affect Observe or other pages.
- `acd5b27` — recorded English/Chinese before-and-after measurements.

### Files and Tasks redundancy fixes

- `a163134` — Files rows use the basename instead of repeating `notes/`; the secondary line now gives localized modified date plus version. Full path remains available as the title.
- `2e2387e` — empty Task descriptions use three rows instead of six, keeping Assignee and Save above the fold. Identical formatted dates are suppressed across a multi-row visible list but remain when they distinguish entries.

### Work Chat loss prevention

- `6cb32a1` — moved mutation continuity above routing into an `AppProviders`-owned store keyed by `(Work, WorkRun | preparation)`. The store owns the pending promise, frozen body, and stable `client_request_id`. A rejection after the chat route unmounts restores the exact text and Retry affordance when the user returns; retry uses the original identity. Editing the failed body starts a new identity. Sensitive draft text is not written to browser storage.
- `a3c47c6` — added real Work Chat seek pagination. GET accepts `limit` 1–200 and an opaque, Work/Run-bound cursor; responses include nullable `next_cursor`. The repository fetches one extra row and pages backward by durable sequence without offset drift.
- `6ecda07` — exposed localized “Load earlier messages” UI. Older pages merge by ID/sequence, polling cannot discard loaded history, and prepend preserves the reader's viewport anchor within 1px.

Detailed UX reasoning and measurements are in `RESULTS.md`.

## Deliberately not done

- Did not persist Work Chat drafts to `localStorage` or another durable browser store. Work text may be sensitive, and the reported defect requires route-navigation survival, not browser-restart persistence. Expanding that retention boundary needs an explicit product/security decision.
- Did not replace the existing Work-wide idempotency semantics. The browser retains and reuses the established `client_request_id`; the server remains authoritative.
- Did not use offset pagination or client-only history reconstruction. New messages would shift offsets and the original defect was an absent API contract.
- Did not add automatic infinite scroll. The explicit top-of-transcript control is discoverable, keyboard accessible, locally retryable, and does not surprise the reader by moving the viewport.
- Did not complete the earlier real-provider exploratory flow or record real-product GIFs. Runtime startup was interrupted, then the manager explicitly replaced that assignment with the two Work Chat defects and finally ordered session wrap-up. No real stack is running.
- Did not run the full `test:web` after the final Work Chat changes. The manager's active concurrency rule required focused touched-file suites only; all final touched browser files were run together and passed.

## Known broken behavior left alone

These were established outside the final changes and were not silently repinned:

- Baseline: `router.browser.test.tsx > serves the conversations list at /conversations instead of a route miss`.
- Baseline: `router.browser.test.tsx > gives a first-time principal an onboarding empty state at /conversations`.
- Baseline: `FilesPage.browser.test.tsx > scrolls the real Files list to its final file on desktop` (the test receives the sign-in surface). The Files-focused visual test passes.
- `work-feedback.browser.test.tsx > en long card report keeps its condensed preview and action inside the card` expects 133px and measures 124px. This was independently reproduced on `origin/master`; it is not a Lane C regression.
- The full concurrent suite intermittently timed out on the oversized English `/observe` scroll case. Its immediate focused rerun passed 2 matching tests with 106 skipped, so this was recorded as a load artifact rather than used to change geometry.
- Focused Work Chat browser runs emit pre-existing React `act(...)` warnings from polling updates even though assertions pass. A future test-harness cleanup should drain/advance the polling update inside `act` or use deterministic polling seams; do not change product behavior to silence the warning.
- `CI=true pnpm test:integration src/infrastructure/postgres/postgres-work-chat-repository.test.ts` reports “No test files found” because that config includes only `tests/integration/**`. The repository test is intentionally under `src/**` and passes through `test:unit` with PGlite.
- The first focused PGlite pagination invocation hit the default 30-second test timeout during database startup. With an explicit 60-second allowance it passed in 22.19 seconds. No pagination assertion failed.

## Verification actually run

All browser commands were prefixed with `CI=true`. Only focused browser suites were used after the manager's concurrency rule.

```text
CI=true pnpm test:web apps/web/src/features/work/components/work-detail.browser.test.tsx --reporter=verbose
 Test Files  1 passed (1)
      Tests  26 passed (26)

CI=true pnpm test:web apps/web/src/typography.browser.test.tsx
 Test Files  1 passed (1)
      Tests  2 passed (2)

CI=true pnpm test:web apps/web/src/typography.test.ts
 Test Files  1 passed (1)
      Tests  6 passed (6)

CI=true pnpm test:web apps/web/src/features/work/components/work-list.browser.test.tsx
 Test Files  1 passed (1)
      Tests  14 passed (14)

CI=true pnpm test:web apps/web/src/features/work/components/work-detail.browser.test.tsx
 Test Files  1 passed (1)
      Tests  26 passed (26)

CI=true pnpm test:web apps/web/src/features/work/components/work-vocabulary.browser.test.tsx
 Test Files  1 passed (1)
      Tests  1 passed (1)

CI=true pnpm test:web apps/web/src/features/files/FilesPage.visual.browser.test.tsx
 Test Files  1 passed (1)
      Tests  2 passed (2)

CI=true pnpm test:web apps/web/src/features/work-organization/TasksPage.browser.test.tsx
 Test Files  1 passed (1)
      Tests  14 passed (14)

CI=true pnpm test:web apps/web/src/features/work-organization/TasksPage.browser.test.tsx -t "keeps empty Task details"
 Test Files  1 passed (1)
      Tests  2 passed | 12 skipped (14)

CI=true pnpm test:web apps/web/src/features/work/components/panes/work-chat-pane.browser.test.tsx
 Test Files  1 passed (1)
      Tests  8 passed (8)

CI=true pnpm test:unit src/entrypoints/api/routes/product-work.test.ts src/entrypoints/api/routes/browser-web.test.ts src/application/work-chat/work-chat-service.test.ts
 Test Files  3 passed (3)
      Tests  26 passed (26)

CI=true pnpm test:unit src/infrastructure/postgres/postgres-work-chat-repository.test.ts
 Test Files  1 passed (1)
      Tests  2 passed (2)

CI=true pnpm test:web apps/web/src/features/work/components/panes/work-chat-pane.browser.test.tsx apps/web/src/features/work/clients/work-client.test.ts
 Test Files  2 passed (2)
      Tests  12 passed (12)

CI=true pnpm test:web apps/web/src/app/router/scroll.browser.test.tsx -t "keeps 'oversized' 'en' content reachable at 1440 on '/observe"
 Test Files  1 passed (1)
      Tests  2 passed | 106 skipped (108)
```

`CI=true pnpm lint` passed after each shipped change. Its final successful output included:

```text
All matched files use Prettier code style!
> pnpm typecheck
$ tsc -p tsconfig.json --noEmit && pnpm web:check:types
$ pnpm --filter @atomlink-ye/agent-server-web check:types
$ tsc -p tsconfig.app.json --noEmit
```

Additional non-browser verification:

```text
CI=true pnpm check:compatibility-surfaces
compatibility-surfaces: ok
```

One historical full-suite run, before the final Work Chat work and before the focused-only rule, ended with:

```text
 Test Files  4 failed | 68 passed (72)
      Tests  5 failed | 549 passed (554)
```

Those five were the three declared baseline failures, the independently reproduced 133/124 Work-card pin, and the `/observe` load timeout that passed focused rerun.

## Next session

1. Pull/confirm `origin/r3/lane-c` at this handoff commit and read `RESULTS.md` plus this file.
2. Run the focused Work Chat route, repository, client, and pane suites if rebasing changes their dependencies; verify the browser harness exits afterward.
3. Add a focused polling-after-pagination assertion if further hardening is requested: load an older page, inject a newly arrived latest message on the next poll, and prove both oldest and newest remain exactly once. The production merge already implements this, but the current browser test covers prepend/dedupe/anchor rather than a full one-second poll after prepend.
4. Consider separating transcript load errors, persisted-message retry errors, and preparation-confirm errors from the remaining shared local `error` boolean in `WorkChatConversation`. Mutation-send failure is already correctly store-backed; the other action errors still share generic copy.
5. If authorized, resume the postponed real-provider exploration with `DATABASE_URL=postgres://user:dev@127.0.0.1:5432/agent_server HOST_NATIVE_WATCH=0 pnpm dev:runtime`, exercise the actual >200-message and route-unmount flows, capture evidence only under the repository's approved artifact policy, then stop the owned stack and confirm no child processes remain.
