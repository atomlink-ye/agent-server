# Scroll audit — in progress

Base: `fa344fcc`. Desktop target: Chromium at 1440 × 900.

The first coherent change is committed and pushed as `bd6086e1`: the existing
Files browser fixture now answers `/api/auth/me`, allowing the real router to
reach the Files page. Its original scope-list, file-list, and preview scroll
assertions are unchanged. This is a test setup correction, **not** a claimed
product scroll fix or credit for a baseline red.

## Current verification

`pnpm test:web src/features/files/FilesPage.browser.test.tsx` passed in isolation.
Verbatim tail:

```text
 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  22:02:44
   Duration  129.75s (transform 0ms, setup 0ms, import 43.57s, tests 17.43s, environment 0ms)
```

`pnpm web:check:types` exited 0. Verbatim output:

```text
$ pnpm --filter @atomlink-ye/agent-server-web check:types
$ tsc -p tsconfig.app.json --noEmit
```

The new route audit is **not verified**. Two isolated attempts exited before
executing tests because Chromium did not connect within Vitest's timeout. The
manager has confirmed six concurrent lanes on a 3-core / 8GB sandbox with load
around 50. No product change is justified by those timeouts.

`pnpm test:web src/app/router/scroll.browser.test.tsx`, latest attempt tail:

```text
 Test Files   (1)
      Tests  no tests
     Errors  1 error
   Start at  22:17:12
   Duration  66.27s (transform 0ms, setup 0ms, import 0ms, tests 0ms, environment 0ms)

[ELIFECYCLE] Command failed with exit code 1.
```

The error was `Failed to connect to the browser session … [web-dom (chromium)]
within the timeout.` Earlier exploratory runs were interrupted after harness
corrections or timeouts; they are not passing evidence.

`pnpm lint` is still running its remaining checks. Its formatting stage reported
17 files, including the new audit before formatting and unchanged baseline
files. The untouched failures include `.shoot.mjs`, Agent authoring, Observe,
Run Trace, BoardCardPeek, architecture/contracts/decision docs, REPORT-workui,
Paseo/postgres files, and setup-providers. The untracked manager-supplied
`BRIEF.md` is also included by that command. None of those unrelated files has
been changed by this lane.

## Coverage still to complete

| Route                                               | Containers to measure                                                         | Status                                                                      |
| --------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `/`, `/conversations/:id`                           | Conversation list, transcript, composer                                       | Audit pending                                                               |
| `/work`                                             | `.work-pane-scroll.scroll-region`, landing                                    | Audit pending                                                               |
| `/work/:workId`, all tabs and selected-Run variants | Work scroller, Work chat history, Runs, Definition editor, transcript, Result | Audit pending                                                               |
| `/observe?work=&run=`                               | Observe list, detail, nested trace                                            | Audit pending                                                               |
| `/agents`, `/agents/:id`                            | Roster, directory, profile                                                    | Audit pending                                                               |
| `/files`                                            | Scope list, file list, preview/source/actions                                 | Existing isolated scroll assertions pass; larger/import-order audit pending |
| `/tasks/:id`                                        | Task list and detail                                                          | Audit pending                                                               |

The draft audit uses the real AppRouter/AppShell and deterministic API fixtures,
with ordinary content and oversized English/Chinese content: 50 WorkRuns for one
Work, 2,000 transcript paragraphs, a 500-line Definition description, and
200-character titles. It does not exercise a live API, database, or provider.

No layout fix or before/after pixel improvement is claimed yet. No product bug
has been marked fixed based on CSS inspection alone. Generated diagnostic logs
remain under ignored `.local/`; the explicitly requested RESULTS.md is the only
campaign report intended for Git.
