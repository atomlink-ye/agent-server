# Lane D handoff

## Completed and pushed

All commits below are on `origin/r3/lane-d`.

- `5bbaa57` — started the lane-D visual-sweep results ledger.
- `9b73ee2` — contained oversized Observe result content instead of letting it overflow the detail surface.
- `8281245` — made failed Whisper loads settle instead of leaving loading copy beside an error.
- `ebca31c` — added bilingual Account layout/error coverage.
- `60709f1` — replaced platform-dependent Work-card rendered-float assertions with product-intent geometry.
- `58b1497` — recorded the completed bilingual 1440px surface sweep.
- `9b5fd15` — clarified the Work directory/detail hierarchy in English and Simplified Chinese while retaining the 49.5px row, 26px tab, and 624px card pins.
- `fd62f69` — ordered Work needing attention (`needs_you`, then `problem`) ahead of healthy recent activity.
- `ee7fa27` — recorded before/after bilingual Work measurements and user-task rationale.
- `a3800ac` — added 1440px English and zh-CN Work-list and WorkRun-detail evidence.
- `d01b3ab` — made the bootstrapped Research Brief collect required topic, audience, and format inputs. A real provider run had otherwise completed by asking the user for those missing inputs.
- `e568dd5` — fixed cumulative provider-stream snapshot projection so a real Codex result is coherent instead of repeated many times.
- `e2fbd05` — recorded the real PostgreSQL + Paseo journey and committed real-flow GIFs under `docs/ux/r3/real/`.
- `c8fa0e2` — made a newly started WorkRun open on Activity, where the user can observe real progress.
- `d2adcbb` — gave friendly and advanced Work-title inputs unique IDs, fixing ambiguous labels in the real authoring page.
- `974df03` — changed Work tabs from document-reloading anchors to React Router links so tab changes retain app context.

The real journey created a Coworker, created input-complete Work, ran it through the shared Paseo daemon with real Codex `gpt-5.6-luna`, observed `Running` to `Complete`, and inspected real session activity. The final Activity-first run landed with `tab=transcript`, showed visible session activity for every sampled Running state, and completed at sample 19. The lane-D `dev:runtime` stack was stopped before handoff; the shared Paseo daemon was not touched.

## Deliberately not done

- I did not redesign the Coworker-to-Worker/Definition relationship. Creating a Coworker redirects clearly to Chat, but Work only exposes published Definitions and gives no visible path to make the new Coworker executable. This is a product/navigation decision larger than a safe exploratory UI patch.
- I did not run the full `test:web` after the manager restricted this round to focused suites. The earlier full run, before that restriction, converged to exactly the three declared baseline failures recorded in `RESULTS.md`.
- I did not commit raw browser frames, logs, credentials, or `.local/` scripts. Only the requested reduced real-flow GIFs were committed.
- I did not touch untracked `BRIEF.md` or runtime-created `default/`.

## Broken or unresolved observations

- Output navigation needs one clean real-product recheck after `974df03`. Before that change, selecting Output performed a document reload and showed `Loading Work…`. Two verification captures still caught that loading panel because the temporary script's readiness predicate could observe the old detail shell before the route update. I corrected the ignored script to wait for `data-active-tab="result"`, but the manager interrupted that final run to request wrap-up. The focused component tests pass, but real settled Output after the Link change is therefore not claimed.
- Running Work was previously quiet on Conversation; `c8fa0e2` fixes the primary friendly-start path by landing on Activity. Other start paths still call `openStartedWorkRun` with the Chat tab in `WorkDetailPage.tsx` and `run-trigger.tsx`. Decide whether all run-start paths should consistently open Activity.
- Activity's “Latest activity summary” may contain provider-produced Markdown links rendered as literal text in the summary card. The real run showed strings such as `[University of Michigan progress study](http path)`. This was observed but not investigated.
- The Work directory accumulated several zero-run `Launch brief research` records from early real exploration. They are development database data, not repository state.

## Verification actually run

Focused commands from the completed work, with their verbatim final Vitest summary lines:

`CI=true pnpm test:web apps/web/src/app/router/scroll.browser.test.tsx` (focused Observe case):

```text
 Test Files  1 passed (1)
      Tests  5 passed | 103 skipped (108)
```

In-scope surface batch (exact file list is recorded in the shell history/results ledger):

```text
 Test Files  6 passed (6)
      Tests  24 passed (24)
```

Focused Whisper states:

```text
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

Focused Account states/layout:

```text
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

Focused Work-card intent:

```text
 Test Files  1 passed (1)
      Tests  12 passed (12)
```

Focused Work hierarchy/typography:

```text
 Test Files  2 passed (2)
      Tests  15 passed (15)
```

Focused attention ordering:

```text
 Test Files  1 passed (1)
      Tests  14 passed (14)
```

Focused Work measurement cases:

```text
 Test Files  2 passed (2)
      Tests  10 passed | 18 skipped (28)
```

`CI=true pnpm exec vitest run scripts/dev/web-bootstrap.test.mjs`:

```text
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

`CI=true pnpm test:web transcript-projection.test.ts run-outcome.test.ts`:

```text
 Test Files  2 passed (2)
      Tests  13 passed (13)
```

`CI=true pnpm test:web work-presentation.test.ts new-work.browser.test.tsx`:

```text
 Test Files  2 passed (2)
      Tests  7 passed (7)
```

`CI=true pnpm test:web apps/web/src/features/work/components/new-work.browser.test.tsx apps/web/src/features/work/components/definition-authoring.browser.test.tsx`:

```text
 Test Files  2 passed (2)
      Tests  8 passed (8)
```

`CI=true pnpm test:web apps/web/src/features/work/components/work-detail.browser.test.tsx apps/web/src/features/work/components/work-presentation.test.ts`:

```text
 Test Files  2 passed (2)
      Tests  28 passed (28)
```

`CI=true pnpm lint` was run successfully before every implementation commit. Its final gate ended with exit code 0 after:

```text
All matched files use Prettier code style!
> pnpm typecheck
$ tsc -p tsconfig.json --noEmit && pnpm web:check:types
$ pnpm --filter @atomlink-ye/agent-server-web check:types
$ tsc -p tsconfig.app.json --noEmit
```

The earlier manager-authorized final full browser report was:

```text
 Test Files  2 failed | 71 passed (73)
      Tests  3 failed | 556 passed (559)
```

Its three failures are the declared baseline reds listed in `RESULTS.md`.

Real browser verification (not Vitest) exited 0 and printed:

```text
landed_tab=transcript
attempt=18 status=Complete activity_visible=true
output_length=107
```

The `output_length=107` value was the loading panel, not the actual result, and must not be treated as successful Output verification. The harness used `finally { await browser.close(); }`; after it exited there was no live lane-D Chromium process.

## Next session

1. Boot `dev:runtime` with the supplied PostgreSQL/Paseo environment and perform one read-only navigation to the latest completed WorkRun's Output. Wait for both `data-active-tab="result"` and a non-loading `data-load-state`; confirm `974df03` removes the document-level loading flash and capture the actual output.
2. If other run-start paths still strand users on Conversation, route them to Activity using the existing `startedWorkRunHref` helper and focused tests.
3. Decide and document the intended Coworker → executable Worker/Definition journey before changing that navigation.
4. Consider rendering or sanitizing Markdown in Activity summaries if the literal-link observation reproduces.
