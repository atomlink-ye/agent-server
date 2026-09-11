# Work detail: jobs and baseline audit

Written before implementation or CSS changes. Baseline: fa344fcc.

This page exists to help a user supervise a durable Work through its individual
WorkRuns: check progress, inspect output, steer an execution, and compare history.
It is not primarily a registry record or an operational trace viewer.

| User job                                                        | Baseline from the default Work page                                       | Actual pane behavior and design consequence                                                                                                                                                                                |
| --------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Is execution progressing, stuck, or failed?                     | One click (Runs)                                                          | Summary shows definition ID, count, and dates. Work has only Active/Archived record state. Lead with the WorkRun history and each execution's own status.                                                                  |
| What did it produce; where is the result file?                  | Not at all within one click                                               | Files is an unavailable Artifact placeholder. Runs → Open → Result contains output/file access, plus an unrelated operational trace. Put a Result link on each WorkRun row and keep Result focused on output.              |
| What is happening now; what just happened?                      | Not at all within one click                                               | The tab called Trace renders session transcripts; Result separately renders the full operational trace. Name the transcript Activity and link directly from each WorkRun; send operational inspection to existing Observe. |
| Where do I type to steer it?                                    | Not at all within one click                                               | Runs → Open opens a WorkRun-scoped conversation. Put Conversation directly on the default history. Preparation is a separate null-WorkRun conversation before the first execution.                                         |
| Which execution am I viewing; how does it relate to the others? | One glance for the selected ordinal; one click for history only from Work | PR #155 already separates the Work identity/record state from the selected execution status, but calls WorkRuns “Runs”. Retain that boundary, use WorkRun identity, show ordinal/total and a direct history link.          |
| What definition governs future Work or governed this execution? | One click for current; historical only via Result                         | Selected historical Definition is outside the selected tab set. Give it an active “Definition used” tab, with explicit WorkRun scope; keep current Work Definition in Work navigation.                                     |

Plan justified by those jobs: merge Summary and Runs into the default WorkRun
history; disclose record metadata below it; remove the unavailable Files tab
(keep its explicit old-link unavailable state); give each execution Conversation,
Result, and Activity links; retain clearly scoped navigation for the selected
WorkRun and its pinned Definition. Preserve existing URL forms and preparation
chat. No new API, runtime, or execution semantics.

## User-visible changes

- The default Work page combines the former Summary and Runs panes into WorkRun history. Every execution has its own ordinal, state, timestamp, and direct Conversation / Result / Activity links. Record metadata is a disclosure below the history. Active/Archived remains exclusively the Work record state.
- Selected execution headers explicitly say WorkRun and show ordinal/total plus All WorkRuns. All four tabs belong to that selection, including the exact read-only Definition used. Current Work Definition remains at Work level and editable.
- Result contains captured output and the existing successful result-file link. It no longer embeds the operational trace, journey, or role cards; operational inspection links to existing Observe. Activity is the existing session transcript, now named for what it renders. Captured text is no longer titled as proof of completion, and the status description explicitly identifies the WorkRun.
- Preparation remains the pre-WorkRun chat bucket. Old `tab=runs`, historical Definition links, and explicit Files links still resolve. Files is not advertised as an available Artifact browser.
- Running / needs-you rows refresh their state through the existing Product read and stop polling at a terminal state. This does not add a Work state machine.

After loading, execution state and history are one-glance jobs; conversation,
activity, and result text are one click from each row. The successful result file
is one further explicit click from Result. Record metadata takes one disclosure;
current and pinned Definition each take one tab click in their respective scope.

## Real-browser measurements

Chromium, 1440 × 900, AppShell + AppRouter + real production components with
mocked Product responses. All values use `getBoundingClientRect()`. English and
zh-CN produced the same numbers in the measured fixture. This redesign preserves
the already-small header budget; it does not claim a header-height reduction.

| Measurement                                  | Before → after (px)                                |
| -------------------------------------------- | -------------------------------------------------- |
| Work header                                  | 44 → 44                                            |
| Work tab strip                               | 34 → 34                                            |
| Work header + tabs                           | **78 → 78**                                        |
| Selected WorkRun header                      | 36 → 36                                            |
| Selected WorkRun tab strip                   | 34 → 34                                            |
| Selected WorkRun header + tabs               | **70 → 70**                                        |
| Work shell top to tab-strip bottom           | 90 → 90                                            |
| WorkRun shell top to tab-strip bottom        | 83 → 83                                            |
| Work shell top to first pane content         | 102 → 102 (metadata pane → WorkRun history pane)   |
| Result shell top to first pane content       | 83 → 95 (standalone Definition link → result card) |
| Conversation shell top to first pane content | 103 → 103                                          |
| Definition shell top to first pane content   | 111 → 95 (viewer → explicit scope heading)         |

Browser assertions cap header/tab budgets at 78px / 70px and the first-content
offsets at 102px (Work), 103px (Conversation), and 95px (Result / Definition).
They assert that all tab links and the history link fit without horizontal
clipping in both locales. Existing tests still exercise real transcript scrolling
and composer visibility. No list overflow ownership was changed.

## Verification

Implementation commit `2ab4b1a7` is pushed to `origin/wui3/ia-a`.
The scoped single-file browser and translation checks are green. Broader verification remains blocked as detailed below; the full suite is not green.

`pnpm web:check:types` passed (exit 0) after guarding the nullable unanchored
WorkRun projection in the row refresh. Verbatim tail:

```text
$ pnpm --filter @atomlink-ye/agent-server-web check:types
$ tsc -p tsconfig.app.json --noEmit
```

`pnpm test:web apps/web/src/features/work/components/work-detail.browser.test.tsx` passed (exit 0). Verbatim tail:

```text
 Test Files  1 passed (1)
      Tests  25 passed (25)
   Start at  22:21:58
   Duration  138.31s (transform 0ms, setup 0ms, import 42.30s, tests 40.72s, environment 0ms)
```

`pnpm test:web apps/web/src/i18n/i18n.test.ts` passed (exit 0). Verbatim tail:

```text
 Test Files  1 passed (1)
      Tests  6 passed (6)
   Start at  22:25:13
   Duration  16.52s (transform 5.78s, setup 0ms, import 7.36s, tests 290ms, environment 0ms)
```

`pnpm test:web apps/web/src/features/work/components/run-trigger.browser.test.tsx` passed (exit 0). Verbatim tail:

```text
 Test Files  1 passed (1)
      Tests  6 passed (6)
   Start at  22:26:30
   Duration  85.32s (transform 0ms, setup 0ms, import 17.47s, tests 1.48s, environment 0ms)
```

The broad `pnpm test:web` run was explicitly interrupted (exit 130) under CPU
starvation. It reproduced the three baseline reds, found the now-corrected
duplicate i18n key, and timed out on BoardsPage, ObservePage,
ConversationsPage, TasksPage, and coverage.browser.test.tsx. Its final six lines
are reproduced verbatim:

```text
 ❯ |web-dom (chromium)| src/features/run-trace/coverage.browser.test.tsx (1 test | 1 failed) 51246ms
   × keeps the activity coverage disclosure present across views and selection 51245ms
 ❯ |web-dom (chromium)| src/features/work-organization/TasksPage.browser.test.tsx (10 tests | 2 failed) 77559ms
   × scrolls real Tasks list and detail content to their final entries on desktop 41143ms
   × selects a published Definition and coworker by display-safe labels while promoting canonical IDs 33478ms
[ELIFECYCLE] Command failed with exit code 130.
```

The baseline reds remain outside this lane and were not changed:

- `router.browser.test.tsx > gives a first-time principal an onboarding empty state at /conversations`
- `router.browser.test.tsx > serves the conversations list at /conversations instead of a route miss`
- `FilesPage.browser.test.tsx > scrolls the real Files list to its final file on desktop`

Following the manager's load advisory, each additional timeout file was rerun
alone with its original assertions. Tasks and coverage passed without any code
changes: Tasks' total test duration fell from 77.559s to 23.88s; coverage fell
from 51.245s to 5.60s. Boards and Observe could not connect to Chromium and ran
zero tests. Conversations still timed out at 35.225s (30-second limit) while its
other eight tests passed. These three isolated checks remain **inconclusive /
blocked**, not passes and not established code regressions. The affected tests
and their page implementations were left unchanged. The manager owns rerunning
these three files on a quiet host before claiming broader acceptance.

`pnpm test:web apps/web/src/features/work-organization/BoardsPage.browser.test.tsx` — blocked: browser session connection timeout; exit 1. Verbatim tail:

```text
 Test Files   (1)
      Tests  no tests
     Errors  1 error
   Start at  22:28:49
   Duration  65.37s (transform 0ms, setup 0ms, import 0ms, tests 0ms, environment 0ms)

[ELIFECYCLE] Command failed with exit code 1.
```

`pnpm test:web apps/web/src/features/observe/ObservePage.browser.test.tsx` — blocked: browser session connection timeout; exit 1. Verbatim tail:

```text
 Test Files   (1)
      Tests  no tests
     Errors  1 error
   Start at  22:31:59
   Duration  68.76s (transform 0ms, setup 0ms, import 0ms, tests 0ms, environment 0ms)

[ELIFECYCLE] Command failed with exit code 1.
```

`pnpm test:web apps/web/src/features/conversations/ConversationsPage.browser.test.tsx` — blocked: scroll test timed out; exit 1. Verbatim tail:

```text
 Test Files  1 failed (1)
      Tests  1 failed | 8 passed (9)
   Start at  22:33:55
   Duration  125.91s (transform 0ms, setup 0ms, import 34.34s, tests 48.84s, environment 0ms)

[ELIFECYCLE] Command failed with exit code 1.
```

`pnpm test:web apps/web/src/features/work-organization/TasksPage.browser.test.tsx` — passed; exit 0. Verbatim tail:

```text
 Test Files  1 passed (1)
      Tests  10 passed (10)
   Start at  22:36:47
   Duration  137.09s (transform 0ms, setup 0ms, import 55.65s, tests 23.88s, environment 0ms)
```

`pnpm test:web apps/web/src/features/run-trace/coverage.browser.test.tsx` — passed; exit 0. Verbatim tail:

```text
 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  22:39:48
   Duration  50.98s (transform 0ms, setup 0ms, import 10.11s, tests 5.60s, environment 0ms)
```

`pnpm lint` finished with exit 1. It reported formatting issues in 15 tracked
files whose contents were verified byte-for-byte against `fa344fcc`, the
untracked dispatch input BRIEF.md, and the then-unformatted RESULTS.md draft.
The final report has since been formatted; the full lint command was not rerun.
No changed implementation/test file appeared in the formatting warnings. The
baseline formatting files were deliberately left untouched:

```text
.shoot.mjs
apps/web/src/features/agents/authoring.ts
apps/web/src/features/agents/AuthoringPanels.tsx
apps/web/src/features/observe/ObservePane.browser.test.tsx
apps/web/src/features/run-trace/events.tsx
apps/web/src/features/run-trace/inspector.tsx
apps/web/src/features/run-trace/run-trace-view.tsx
apps/web/src/features/work-organization/BoardCardPeek.tsx
docs/architecture/computer-placement-gap.md
docs/contracts/work-organization-api.md
docs/decisions/0013-task-ordering-in-the-description.md
REPORT-workui.md
src/adapters/paseo/paseo-turn-runner.test.ts
src/infrastructure/postgres/postgres-work-organization-repository.ts
tooling/dev/setup-providers.ts
```

Verbatim `pnpm lint` tail:

```text
[warn] src/adapters/paseo/paseo-turn-runner.test.ts
[warn] src/infrastructure/postgres/postgres-work-organization-repository.ts
[warn] tooling/dev/setup-providers.ts
[warn] Code style issues found in 17 files. Run Prettier with --write to fix.
[ELIFECYCLE] Command failed with exit code 1.
> pnpm typecheck
$ tsc -p tsconfig.json --noEmit && pnpm web:check:types
$ pnpm --filter @atomlink-ye/agent-server-web check:types
$ tsc -p tsconfig.app.json --noEmit
[ELIFECYCLE] Command failed with exit code 1.
```

The baseline-only browser measurement run passed 14 tests. An intermediate
edited run had three failures: one incorrect test expectation (`Status
unavailable` vs the actual `Status unknown`) and two 30-second measurement test
timeouts on the shared host. The expectation was corrected and the measurement
loop was split into eight independent locale/page cases, preserving every
geometry assertion.

## Scope and limitations

Shared i18n edits are one Work-scope copy block and four terminology corrections:
`work.run.start`, `work.run.cantStart`, `work.result.notPresent`, and
`work.result.updating`, in both dictionaries. The adjacent run-trigger browser test only updates its expected label
to WorkRun. `docs/frontend.md` updates the affected navigation paragraph because
it otherwise describes the removed Summary/Files hierarchy. No API, persistence,
runtime, dependency, or global index.css change.

- The three manager baseline failures (two conversations routing tests and the
  Files scrolling test) are outside this lane. They are not claimed as fixes.
- Artifact browsing remains unavailable; the result-file link uses the existing
  successful-execution contract. No artifact is inferred from transcript text.
- The existing output projector still chooses captured assistant text. This
  change labels it honestly; it does not redesign output provenance or live
  transcript refresh.
- History still reads each execution's Product projection separately. Live rows
  refresh status; newly created external WorkRuns require a page refresh to
  refresh list membership. No aggregation API was added.
- Verification uses real browser layout with deterministic API fixtures, not a
  live backend/provider execution. No mobile target, runtime canary, Postgres
  test, or live artifact download was exercised.
- The existing DefinitionPanel still has untranslated internal English copy; the new scope heading and navigation are translated. A full authoring-panel localization is outside this lane.
- Baseline diagnostic prose elsewhere in the repository still uses “Run” for
  product execution in places; this lane corrects its own primary navigation,
  start action, and Result context without attempting a repository-wide rename.
- Screenshots and raw measurements remain ignored local artifacts. RESULTS.md
  is committed because the explicit campaign brief requests it, overriding the
  repository's normal prohibition on task reports. BASELINE.md and BRIEF.md are
  dispatch inputs and will not be committed.

No dev/runtime server or database was started. The broad Vitest process was
interrupted explicitly; the single-file checks and lint process have finished.
Implementation and report commits are on `wui3/ia-a`; no PR was opened.
