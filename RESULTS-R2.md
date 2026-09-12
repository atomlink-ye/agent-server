# Work Card previews and recoverable list reads

Round 2 starts from `191d7f13`, the frozen Round 1 tip. Work is on `wui3/lane-d-r2`; only this new branch is pushed. Git commands run as OS user `agent`, with the campaign commit author. No PR, merge, or rebase.

## Diagnosis before changes

The initial “fixed 124px card clips content” hypothesis was only partly correct. The card uses `min-height: 124px`, not a fixed height. Its controls did not require a larger fixed reservation. The existing summary stylesheet separately clipped the already-condensed preview to two lines and hid overflow from unbroken identifiers.

A new browser test rendered 200-character natural-language titles, long English and Chinese report paragraphs, and long release identifiers. These are deterministic content fixtures, not a claim to have exercised a live backend. At 1440 × 900 in Chromium, `getBoundingClientRect()` and scroll/client dimensions found:

- English preview: 36px visible, 54px content height.
- Chinese preview: 36px visible, 90px content height.
- Unbroken identifier: 1100px scroll width, inside a 501px English / 504px Chinese client width.
- The failed Run-state read had a 78px row and rendered “Status unknown” / “状态未知” without a Retry button.
- All six directory empty/offline/stale fixtures already passed: the feedback was 292 × 220px, starting at y=90px. Their action buttons measured 32.5px high. No directory layout defect was found or invented.

The new tests ran against unchanged Round 1 production source first. Failures were direct content/DOM assertions, not timeout diagnoses.

## Changes

- Keep the 124px **minimum** card height and the existing bounded 180-character preview. Remove the second CSS truncation and wrap long identifiers, so all of that preview is visible and the card can grow. Full reports remain accessed through Open Work; titles retain the Round 1 prefix/suffix and full hover/accessibility text.
- Distinguish a failed Run-state read from a successful response that contains no captured state. The failed read offers a localized explanation and Retry targeting that Run. Recovery replaces the error with the returned execution state, while Open stays available.
- Extend directory coverage to real list-hook empty, offline, and stale-data recovery in **both** locales. The existing production directory layout did not need another change.

Only lane-owned Work components/styles/tests and one new key in each locale dictionary change. No backend, state library, framework, shared shell stylesheet, or other lane's feature is edited.

## Before → after measurements

Paired dimensions below are width × height.

All measurements use a 1440 × 900 desktop Chromium viewport. Work Cards use an 800px conversation host; directory and Runs use the real desktop shell columns. Every final value below is pinned by a browser assertion, alongside content containment and action recovery checks.

| Surface                                | en before → after       | zh-CN before → after    |
| -------------------------------------- | ----------------------- | ----------------------- |
| Card with natural-language report      | 124 → 133px             | 124 → 169px             |
| Card report preview height             | 36 → 54px               | 36 → 90px               |
| Card with long identifier              | 124 → 133px             | 124 → 133px             |
| Identifier preview height              | 18 → 54px               | 18 → 54px               |
| Card width                             | 624 → 624px             | 624 → 624px             |
| Directory empty/offline/stale feedback | 292 × 220 → 292 × 220px | 292 × 220 → 292 × 220px |
| Directory action height                | 32.5 → 32.5px           | 32.5 → 32.5px           |
| Directory feedback top                 | 90 → 90px               | 90 → 90px               |
| Real pane viewport height              | 794 → 794px             | 794 → 794px             |
| Runs error/recovered row               | 78 → 78px               | 78 → 78px               |

Card preview width is unchanged at 500.953125px (en) and 504.265625px (zh-CN). The Open Work button remains 33px high. The identifier's scroll width drops from 1100px to its client width, 501px (en) / 504px (zh-CN). Tests pin the preview width, button height, and equality of scroll/client dimensions; they also measure the final character with a DOM Range and require it to lie inside the preview. This verifies actual text containment as well as the surrounding boxes.

The directory test recovers into 30 Works and verifies `.work-pane-scroll.scroll-region` has `overflow-y: auto`, `scrollHeight > clientHeight`, accepts a positive scrollTop, and brings the final row fully into view. The child `.work-list` remains `overflow-y: visible`; no overflow declaration was added to it in Round 2.

## Red-first evidence

Command:

```bash
pnpm test:web apps/web/src/features/work/components/work-feedback.browser.test.tsx
```

Initial run, before production changes (exit 1), excerpts:

```text
AssertionError: expected 54 to be 36 // Object.is equality
AssertionError: expected 1100 to be 501 // Object.is equality
AssertionError: expected null not to be null
AssertionError: expected 90 to be 36 // Object.is equality
AssertionError: expected 1100 to be 504 // Object.is equality

 Test Files  1 failed (1)
      Tests  6 failed | 6 passed (12)
   Start at  23:12:04
   Duration  44.73s (transform 0ms, setup 0ms, import 10.38s, tests 16.39s, environment 0ms)

[ELIFECYCLE] Command failed with exit code 1.
```

The six failures are four clipped preview cases plus two missing Run retry cases. All directory cases passed before changes. Temporary console measurements are removed from the final test; generated screenshots and logs are not committed.

The first style adjustment still failed four preview assertions because the shared stylesheet won an equally specific selector. Run retry and all directory cases passed. Strengthening the Work Card selector resolved that remaining clipping. This was a real CSS cascade failure, not a timeout.

The same single-file command then passed (exit 0):

```text
 Test Files  1 passed (1)
      Tests  12 passed (12)
   Start at  23:17:00
   Duration  87.23s (transform 0ms, setup 0ms, import 27.16s, tests 25.78s, environment 0ms)
```

Final focused run after all pixel, DOM Range, requested-Run identity, and recovery assertions were committed (exit 0):

```bash
pnpm test:web apps/web/src/features/work/components/work-feedback.browser.test.tsx apps/web/src/features/work/components/work-card-layout.browser.test.tsx
```

```text
 Test Files  2 passed (2)
      Tests  18 passed (18)
   Start at  00:01:22
   Duration  67.49s (transform 0ms, setup 0ms, import 25.62s, tests 18.65s, environment 0ms)
```

This includes all 12 new bilingual tests and the six existing Work Card layout tests. The latter retain the 124px loading/error/no-result geometry.

`pnpm web:check:types` passed (exit 0), verbatim output:

```text
$ pnpm --filter @atomlink-ye/agent-server-web check:types
$ tsc -p tsconfig.app.json --noEmit
```

`pnpm test:web` ran once after the final assertions were committed (exit 1):

```text
 Test Files  4 failed | 54 passed (58)
      Tests  5 failed | 360 passed (365)
   Start at  23:40:18
   Duration  719.46s (transform 125.93s, setup 0ms, import 850.86s, tests 508.53s, environment 283ms)

[ELIFECYCLE] Command failed with exit code 1.
```

Three failures match the manager's baseline. The other two are `Test timed out in 30000ms`: Work list's “starts catalog Definitions without Coworker binding or initiator controls” (36107ms) and Observe's “scrolls the real Observe list to its final traced Run on desktop” (68908ms). Both also reported screenshot timeouts. Single-file reruns passed: Work list 14/14 and Observe 3/3, without code or timeout changes. The two extra failures did not reproduce when each file ran alone; this supports contention as the cause, without claiming CPU-exclusive verification.

`pnpm lint` completed with exit 1. Its 17 formatting warnings cover 15 unchanged tracked files, the supplied untracked `BRIEF.md`, and the Round 2 report draft. The report draft was formatted with Prettier before commit. Full lint was not rerun after that formatting fix; no green lint result is claimed. No warning intersects the seven changed Round 2 source/test files. Root and Web TypeScript checks completed without diagnostics. Full lint is not claimed green.

Verbatim final portion:

```text
[warn] Code style issues found in 17 files. Run Prettier with --write to fix.
[ELIFECYCLE] Command failed with exit code 1.
> pnpm typecheck
$ tsc -p tsconfig.json --noEmit && pnpm web:check:types
$ pnpm --filter @atomlink-ye/agent-server-web check:types
$ tsc -p tsconfig.app.json --noEmit
[ELIFECYCLE] Command failed with exit code 1.
```

Work list single-file rerun, `pnpm test:web apps/web/src/features/work/components/work-list.browser.test.tsx` (exit 0):

```text
 Test Files  1 passed (1)
      Tests  14 passed (14)
   Start at  23:55:32
   Duration  161.19s (transform 0ms, setup 0ms, import 54.12s, tests 54.86s, environment 0ms)
```

Observe single-file rerun, `pnpm test:web apps/web/src/features/observe/ObservePane.browser.test.tsx` (exit 0):

```text
 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  23:59:11
   Duration  68.92s (transform 0ms, setup 0ms, import 24.34s, tests 7.63s, environment 0ms)
```

## Baseline / concurrent / isolated comparison

| Check                                | Clean base                                                                          | Concurrent full suite                                 | Isolated file                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Known baseline failures              | Manager's `fa344fcc`: two conversations router cases and Files final-file scrolling | Same three assertion failures                         | Not rerun; outside this Round 2 scope                                              |
| Work catalog                         | Not named among manager's baseline failures; no per-file timing recorded            | Catalog case timed out at 36107ms; file tests 65566ms | 14/14 passed; file tests 54.86s, whole command 161.19s                             |
| Observe scrolling                    | Not named among manager's baseline failures; no per-file timing recorded            | Scroll case timed out at 68908ms; file tests 70822ms  | 3/3 passed; file tests 7.63s, whole command 68.92s                                 |
| New preview and Run retry assertions | Round 1 source `191d7f13`: six failures, six passes                                 | Not listed among full-suite failures                  | Measurement run: 12/12 in 87.23s; final new + existing card tests: 18/18 in 67.49s |

“Isolated” means this lane invokes only the named file; sibling lanes still share the sandbox. No CPU-exclusive run is claimed. A slow test is not treated as hung or fixed by changing timeouts.

## Limits

The full underlying report remains intentionally condensed to 180 characters plus an ellipsis; Round 2 ensures the entire **condensed preview** is visible. The deliberate tradeoff is 9px more card height for the English report fixture and 45px for Chinese, exposing the hidden lines. It does not turn the Work Card into a report reader. Native title truncation remains intentional and has the full title available on hover/accessibility.

The three baseline reds are not fixed: router first-time conversations onboarding, router conversations list routing, and Files final-file scrolling. Live backend/runtime, PostgreSQL, and mobile are outside this verification. No other lane production code was changed.
