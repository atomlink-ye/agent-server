# Semantic vocabulary and bilingual copy audit

Implemented bilingual semantic corrections and pushed incremental commits to `wui3/lane-b`. Work records now attribute execution state to the latest WorkRun; product executions, technical Task attempts, and preparation conversations have distinct names. No Work detail structure, tab composition, CSS, or backend contract changes remain. Verification outcomes and limits are recorded below.

## Vocabulary

The same core nouns appear in English and Simplified Chinese. Chinese surrounding copy is written for the UI; short state labels replace filler such as 正在.

| Term in both locales | Meaning                                                                                |
| -------------------- | -------------------------------------------------------------------------------------- |
| Work                 | Durable identity pinned to a Definition version; only archived/unarchived record state |
| WorkRun              | One product execution of a Work; Work has 1:N WorkRuns                                 |
| Run                  | One attempt at a technical Task                                                        |
| Definition           | Versioned execution specification that chooses Worker or Team                          |
| Worker               | Formal executor selected by the Definition                                             |
| Coworker             | Conversational identity; Definition access does not bind Work directly to a Coworker   |
| Task                 | Technical execution node; existing Tasks navigation still projects WorkItems           |

Preparation uses “Preparation” / “启动准备”. Chat's compatibility `lead` role displays “Assistant” / “助手”; actual Team roles remain visible when the captured roster supplies them.

## Findings

Locations below refer to the baseline `fa344fcc` so removed copy remains findable.

| Baseline location                                               | Finding and correction                                                                                                                                               |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/i18n/en.ts:663`                                   | Product execution counts called WorkRuns “runs”.                                                                                                                     |
| `apps/web/src/i18n/en.ts:836`                                   | Start/retry/history actions called a WorkRun a Run.                                                                                                                  |
| `apps/web/src/features/work/pages/WorkDetailPage.tsx:31`        | Selected WorkRun ID passed as selectedRunId. Internal clients/hooks use workRunId; shared Work detail props remain unchanged under the manager’s integration ruling. |
| `apps/web/src/features/work/clients/work-run-client.ts:70`      | Product WorkRun client parameter called runId; now workRunId.                                                                                                        |
| `apps/web/src/features/run-trace/normalized.ts:131`             | Trace wrapper called work_run.id runId; now workRunId, preserving technical event.runId.                                                                             |
| `apps/web/src/features/work/components/WorkCard.tsx:92`         | Work card showed execution status without latest-WorkRun attribution.                                                                                                |
| `apps/web/src/features/work/WorkPage.tsx:347`                   | Recent Work row showed latest execution state as Work state.                                                                                                         |
| `apps/web/src/features/work-organization/format.ts:36`          | Linked Work badges in Tasks/Boards omitted latest-WorkRun attribution.                                                                                               |
| `apps/web/src/features/agents/coworker-activity.ts:143`         | Coworker Work activity badges omitted latest-WorkRun attribution.                                                                                                    |
| `apps/web/src/i18n/en.ts:785`                                   | Preparation labeled shared Work Chat; now explicitly preparation before WorkRun creation.                                                                            |
| `apps/web/src/i18n/en.ts:800`                                   | Every execution conversation called the executor “Run’s Lead”; now neutral Assistant/WorkRun conversation.                                                           |
| `apps/web/src/features/run-trace/selectors.ts:282`              | Root Task attempt lane mislabeled as the WorkRun itself; now Root Task Run.                                                                                          |
| `apps/web/src/i18n/en.ts:892`                                   | Single-worker execution described as a single Agent; now single Worker with no Team graph.                                                                           |
| `apps/web/src/i18n/en.ts:939`                                   | Observe advertised every agent turn, though it lists the latest traced WorkRun per Work.                                                                             |
| `apps/web/src/features/work/components/definition-panel.tsx:77` | Definition editor strings and accessible labels bypassed the catalogs.                                                                                               |

## Catalog audit

The baseline catalogs each had 904 keys: their different line counts were formatting, not key divergence. Added a test for exact key-set equality, plus interpolation-placeholder parity. Localized Definition authoring, trace controls and summaries, account/route labels, file-state sentences, and known captured state values. Raw authored content, identifiers, tool names, and source data remain data.

## Browser measurements

Real Chromium, 1440 × 900, unchanged production CSS. “Before” replays baseline heading copy in the same DOM; this is not a separate baseline deployment. The current header and tabs are real production components. The isolated vocabulary test pins the measured heading widths to 0.1px precision, heading/header/tab heights, and horizontal containment in both locales.

| Metric                 | English before → after   | Chinese before → after  |
| ---------------------- | ------------------------ | ----------------------- |
| Execution heading text | RUN #1 → WorkRun #1      | RUN 第 1 次 → WorkRun 1 |
| Heading width          | 65.953125 → 103.484375px | 104.75 → 91.890625px    |
| Heading height         | 24 → 24px                | 24 → 24px               |
| Header height          | 36 → 36px                | 36 → 36px               |

Tabs measure 34px after the copy change. English grows to name the correct entity; Chinese removes the redundant ordinal phrase. No overall page density improvement is claimed, and no CSS was changed. The original full Work detail fixture and the final isolated production-component test produced identical measurements.

## Integration boundary

The manager assigns Work detail structure and tabs to ia-a. The five named production pane/tab/page files are restored byte-for-byte to fa344fcc. Shared Work detail test edits only update copy expectations; vocabulary geometry lives in its own browser test. docs/frontend.md only appends a glossary section. Both catalogs retain all 904 original keys in their original order, with 180 new keys appended. Existing legacy key names remain while their displayed values use the corrected vocabulary.

## Verification

The full suite was **not green**. Initial browser startup also timed out. A subsequent full run completed with 17 failures: baseline reds, stale semantic expectations, and browser timeouts under shared CPU load. The semantic expectations were corrected; failed files were rerun individually, without changing test timeout thresholds or scroll implementation. New Work, trace map, Boards, Tasks, and the previous Work detail test all passed in isolation. Final Work detail (12/12), Work list (8/8), chat (5/5), vocabulary measurements (1/1), and catalog checks (8/8) passed. No full suite rerun after those fixes is claimed.

`pnpm test:web --browser.connectTimeout=180000 --maxWorkers=2` (before final expectation fixes):

```text
 Test Files  10 failed | 43 passed (53)
      Tests  17 failed | 288 passed (305)
   Start at  22:11:50
   Duration  749.12s (transform 351.76s, setup 0ms, import 1196.98s, tests 584.09s, environment 229ms)

[ELIFECYCLE] Command failed with exit code 1.
```

`pnpm web:check:types` after restoring shared interfaces exited 0:

```text
$ pnpm --filter @atomlink-ye/agent-server-web check:types
$ tsc -p tsconfig.app.json --noEmit
```

`pnpm test:web apps/web/src/features/work/components/work-vocabulary.browser.test.tsx apps/web/src/i18n/i18n.test.ts` passed all 8 catalog tests but failed the new measurement fixture because it passed extra trace fields to a strict WorkRun schema. The fixture now selects the proper fields explicitly. That failure is ours, not a load timeout. The corrected standalone measurement test passed; its final output is below.

## Deliberately unchanged

- No public API, route query name (`?run=`), backend identity, Team role contract, execution behavior, layout CSS, or scroll ownership changes.
- The three manager-recorded baseline failures are outside this lane: two conversations-route tests and the Files list scroll test.
- Product navigation “Tasks” remains the existing WorkItem projection. Changing that information architecture is outside a vocabulary audit.
- Generated logs and browser output are untracked; this requested RESULTS.md is the explicit campaign-report exception to normal repository evidence hygiene.

## Completed isolated checks

`pnpm test:web apps/web/src/i18n/i18n.test.ts apps/web/src/features/run-trace/selectors.test.ts`:

```text
 Test Files  2 passed (2)
      Tests  17 passed (17)
   Start at  22:25:32
   Duration  17.86s (transform 14.19s, setup 0ms, import 18.77s, tests 1.40s, environment 1ms)
```

`pnpm test:web apps/web/src/features/work/components/new-work.browser.test.tsx`:

```text
 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  22:32:42
   Duration  87.26s (transform 0ms, setup 0ms, import 10.71s, tests 16.68s, environment 0ms)
```

`pnpm test:web apps/web/src/features/run-trace/map.browser.test.tsx`:

```text
 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  22:34:49
   Duration  83.54s (transform 0ms, setup 0ms, import 17.64s, tests 8.88s, environment 0ms)
```

`pnpm test:web apps/web/src/features/work-organization/BoardsPage.browser.test.tsx`:

```text
 Test Files  1 passed (1)
      Tests  15 passed (15)
   Start at  22:36:50
   Duration  133.54s (transform 0ms, setup 0ms, import 57.19s, tests 21.34s, environment 0ms)
```

`pnpm test:web apps/web/src/features/work-organization/TasksPage.browser.test.tsx`:

```text
 Test Files  1 passed (1)
      Tests  10 passed (10)
   Start at  22:39:45
   Duration  76.33s (transform 0ms, setup 0ms, import 28.70s, tests 12.56s, environment 0ms)
```

## Final browser reruns

`pnpm test:web apps/web/src/features/work/components/work-vocabulary.browser.test.tsx`:

```text
 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  22:56:18
   Duration  58.87s (transform 0ms, setup 0ms, import 15.42s, tests 4.47s, environment 0ms)
```

`pnpm test:web apps/web/src/features/work/components/work-list.browser.test.tsx`:

```text
 Test Files  1 passed (1)
      Tests  8 passed (8)
   Start at  23:00:24
   Duration  80.50s (transform 0ms, setup 0ms, import 27.23s, tests 16.09s, environment 0ms)
```

The Work list file first timed out in isolation (81.70s in tests, 184.75s total); the final unchanged scroll test passed with 16.09s in tests, 80.50s total. No timeout threshold or scroll implementation was modified.

`pnpm test:web apps/web/src/features/work/components/panes/work-chat-pane.browser.test.tsx`:

```text
 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  23:02:06
   Duration  39.23s (transform 0ms, setup 0ms, import 6.99s, tests 14.14s, environment 0ms)
```

Chat’s previously timed-out file passed unchanged scroll assertions in 14.14s of tests (previous isolated run: 71.52s).

`pnpm test:web apps/web/src/features/work/components/work-detail.browser.test.tsx`:

```text
 Test Files  1 passed (1)
      Tests  12 passed (12)
   Start at  23:03:12
   Duration  36.76s (transform 0ms, setup 0ms, import 12.90s, tests 7.46s, environment 0ms)
```

`pnpm test:web apps/web/src/i18n/i18n.test.ts`:

```text
 Test Files  1 passed (1)
      Tests  8 passed (8)
   Start at  23:03:59
   Duration  2.30s (transform 776ms, setup 0ms, import 1.06s, tests 235ms, environment 0ms)
```

The first post-convergence Work detail rerun caught three stale ordinal assertions (`RUN #1` / `Run #2`) restored with the baseline test. Correcting only their expected text produced the final 12/12 result above.

The three known baseline failures remain outside this lane and were not repaired or rerun after the final copy fixes:

- `router.browser.test.tsx > gives a first-time principal an onboarding empty state at /conversations`
- `router.browser.test.tsx > serves the conversations list at /conversations instead of a route miss`
- `FilesPage.browser.test.tsx > scrolls the real Files list to its final file on desktop`

## Lint and completion limits

`pnpm lint` exited 1. All 10 tracked formatting warnings were byte-compared with `fa344fcc` and are unchanged; the eleventh is the supplied untracked `BRIEF.md`. Both root and web typechecks completed without diagnostics. No unrelated file was reformatted. Verbatim command output:

```text
$ node --import tsx scripts/quality/run-lint.ts
> pnpm format:check
$ prettier --check .
Checking formatting...
[warn] .shoot.mjs
[warn] apps/web/src/features/agents/authoring.ts
[warn] apps/web/src/features/observe/ObservePane.browser.test.tsx
[warn] BRIEF.md
[warn] docs/architecture/computer-placement-gap.md
[warn] docs/contracts/work-organization-api.md
[warn] docs/decisions/0013-task-ordering-in-the-description.md
[warn] REPORT-workui.md
[warn] src/adapters/paseo/paseo-turn-runner.test.ts
[warn] src/infrastructure/postgres/postgres-work-organization-repository.ts
[warn] tooling/dev/setup-providers.ts
[warn] Code style issues found in 11 files. Run Prettier with --write to fix.
[ELIFECYCLE] Command failed with exit code 1.
> pnpm typecheck
$ tsc -p tsconfig.json --noEmit && pnpm web:check:types
$ pnpm --filter @atomlink-ye/agent-server-web check:types
$ tsc -p tsconfig.app.json --noEmit
[ELIFECYCLE] Command failed with exit code 1.
```

The branch is delivered with passing scoped checks and the red full-suite/lint evidence above; it is not a claim of a clean repository-wide gate. All test processes started by this lane have completed. No development server or temporary infrastructure remains to hand off. No PR was opened, and no master rebase or merge was performed.
