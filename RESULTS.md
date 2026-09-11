# Work directory and recovery feedback

Lane `wui3/lane-d`, based on `fa344fcc`. No PR, merge, or rebase. Implementation is pushed incrementally; final verification is recorded below.

## User-visible changes

The directory orders Works by the latest recorded Work or latest Run activity. Each row shows its title, Run count, explicitly Run-scoped execution state, and activity time. Failed and waiting Runs have different symbols and colors. Work remains a durable record with Active/Archived identity; selecting an older Run cannot overwrite the directory's latest Run state.

Long names retain both their beginning and last eight characters, with the full name in the accessible label and native hover title. This applies to directory rows, recent Works, and conversation Work Cards.

A failed directory refresh now identifies retained rows as previously loaded data and offers Retry. Disabled-feature 503 responses and permission failures no longer appear as “Run is starting”; transient readiness 503 responses still poll. Empty artifacts and transcripts link to Runs. Recorded transcript feedback retains Browse Runs and Refresh transcript actions. Loading feedback reserves space and delays visibility by 150 ms.

## Real browser measurements

All values below are real Chromium `getBoundingClientRect()` readings at **1440 × 900**. Final browser tests pin the new dimensions and check overflow/suffix visibility. This is fixture-backed browser rendering, not a live production backend or runtime canary.

Directory and main/detail baseline readings used the original implementation before changes. Card baseline readings rendered a temporary copy of the original component with the original stylesheet. Empty artifact/transcript baseline readings reconstructed the original DOM/copy without the new navigation action; CSS was unchanged. Recent-title baseline readings disabled the new title stylesheet to restore the original single-line ellipsis behavior. Temporary measurement code and source copies have been removed; logs remain outside Git under `/tmp`.

| Surface                                                                  | Before → after                                                                 |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Complete directory rows in viewport, en and zh                           | **12 → 15** (+25%)                                                             |
| Directory row height                                                     | **57 → 48 px**                                                                 |
| Directory row width                                                      | 292 → 292 px                                                                   |
| Actual `.work-pane-scroll` top / height                                  | 90 / 794 → 90 / 794 px                                                         |
| Directory title line box, including 200 Latin and 200 Chinese characters | 17 → 18 px high; new font size asserted at 13 px                               |
| First row top / fifteenth row bottom after                               | 94 / 884 px (scroller bottom 884 px)                                           |
| Conversation Work Card width in an 800 px host                           | 624 → 624 px                                                                   |
| Work Card loading / error height                                         | 44 / 70 → 124 / 124 px                                                         |
| Work Card with 200 Latin characters                                      | 149 → 124 px                                                                   |
| Work Card with 200 Chinese characters                                    | 185 → 124 px                                                                   |
| Card loading-to-ready height change, Latin / Chinese fixture             | 105 / 141 → 0 / 0 px                                                           |
| Empty Runs panel, en and zh                                              | 140 → 140 px high, 760 px wide                                                 |
| Empty artifacts / missing-trace panel, en and zh                         | 140.59375 → 184 px high, 760 px wide; added navigation remains inside viewport |
| Recorded transcript loading / empty / error inner panel, en and zh       | 77.5 / 102 / 102 → 102 / 102 / 102 px                                          |

Main feedback is 420 px wide. Its loading/empty/error/unavailable heights and top coordinates are:

| Locale | Heights before → after (loading / empty / error / unavailable) | Top before → after                      |
| ------ | -------------------------------------------------------------- | --------------------------------------- |
| en     | 212 / 303 / 209 / 146 → 340 / 340 / 340 / 340 px               | 366 / 320.5 / 367.5 / 399 → 302 px each |
| zh-CN  | 212 / 285 / 191 / 146 → 340 / 340 / 340 / 340 px               | 366 / 329.5 / 376.5 / 399 → 302 px each |

Sidebar loading/empty/error/unavailable heights: en 18 / 78.5 / 103.5 / 71 → 220 px each; zh-CN 18 / 60.5 / 103.5 / 53 → 220 px each. The new denied state also measures main 340 px and sidebar 220 px in both locales; it had no distinct baseline view.

Detail shell width is 964 px. Both locales: loading/starting 137 → 400 px; generic error/permission/disabled-feature 352 → 400 px; root-not-found 399.390625 → 400 px. These measurements stabilize feedback shells, not arbitrary populated reports or chat content.

The 200-character recent Work names keep their original 21 px line height. The following suffix coordinates show that the distinguishing ending moved from outside the clipped title to its right edge:

| Locale / title  | Width before → after       | Suffix right before → after  | Title right    |
| --------------- | -------------------------- | ---------------------------- | -------------- |
| en / Chinese    | 530 → 530 px               | 3834.140625 → 1164.140625 px | 1164.140625 px |
| en / Latin      | 542.59375 → 542.59375 px   | 2413.125 → 1164.140625 px    | 1164.140625 px |
| zh-CN / Chinese | 527.859375 → 527.859375 px | 3815.609375 → 1143.46875 px  | 1143.46875 px  |
| zh-CN / Latin   | 527.859375 → 527.859375 px | 2407.1875 → 1143.46875 px    | 1143.46875 px  |

The directory's original 200-character title boxes were 236 × 17 px and did not overflow their 292 px rows, but ellipsis hid the endings. Final tests require the last eight characters to fit inside the title and every row to have equal client/scroll width. They also require the real pane's scrollHeight to exceed its clientHeight; the list remains overflow-visible.

## State matrix

“Pass” means the named browser fixture rendered the localized text and asserted the stated action/layout; it does not claim a live service was exercised. The final targeted run status is recorded below.

| Surface / state                             | en   | zh-CN                                            | Recovery and geometry checked                                                                |
| ------------------------------------------- | ---- | ------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Directory/main loading                      | Pass | Pass                                             | Reserves 220/340 px; main visibility hidden at animation time 100 ms, visible at 150 ms      |
| Directory/main empty                        | Pass | Pass                                             | Create Work entry remains; 220/340 px                                                        |
| Directory/main initial error                | Pass | Pass                                             | Retry invokes refresh; 220/340 px                                                            |
| Directory failed refresh with existing rows | Pass | Localized copy present; interaction tested in en | Stale warning, retained rows, successful Retry clears warning                                |
| Directory/main unavailable                  | Pass | Pass                                             | Explains workspace availability; Conversations link; no futile Retry/create                  |
| Directory/main permission denied            | Pass | Pass                                             | Access guidance and Conversations link; 220/340 px                                           |
| Detail loading                              | Pass | Pass                                             | Loading explanation and Back to Work; 400 px shell                                           |
| Detail transient 503 / starting             | Pass | Pass                                             | Starting explanation, Back to Work; hook proves polling; 400 px shell                        |
| Detail disabled Work feature                | Pass | Pass                                             | Availability explanation, Conversations link; hook proves no polling; 400 px shell           |
| Detail permission error                     | Pass | Pass                                             | Access guidance and Back to Work; hook proves no polling; 400 px shell                       |
| Detail generic error                        | Pass | Pass                                             | Safe explanation, Retry/return controls; 400 px shell                                        |
| WorkDetailRootNotFoundError                 | Pass | Pass                                             | Not-found explanation and Back to Work; 400 px shell                                         |
| Invalid Work ID                             | Pass | Pass                                             | Existing invalid-link message and valid /work return inside viewport                         |
| Empty Runs                                  | Pass | Pass                                             | Enabled Start Run; 140 px panel                                                              |
| Empty artifacts                             | Pass | Pass                                             | Browse Runs; 184 px panel                                                                    |
| Empty transcript (no Run/trace)             | Pass | Pass                                             | Browse Runs; 184 px panel                                                                    |
| Recorded transcript loading                 | Pass | Pass                                             | Browse Runs + Refresh; fetch invoked twice; 102 px inner panel / 400 px shell; 150 ms reveal |
| Recorded transcript empty/error             | Pass | Pass                                             | Safe localized message, Browse Runs + Refresh; action top unchanged; 102 px inner panel      |
| Work Card loading                           | Pass | Pass                                             | 124 × 624 px; 150 ms reveal                                                                  |
| Work Card error                             | Pass | Pass                                             | Open Work invokes callback; 124 × 624 px                                                     |
| Work Card ready/problem with long title     | Pass | Pass                                             | Attention mark, suffix, Open Work; 124 × 624 px                                              |

The distinct 503/403 classification is tested at the real `useWorkDetail` hook with a mocked read boundary and deterministic fake timer advancement. Directory stale-refresh recovery uses the real list hook with mocked fetch. Remaining state tests isolate the rendering boundary. Existing list/router integration tests exercise latest-Run synchronization.

## Verification

Full suite was run **once**, then only targeted files were rerun. The full run found the three documented baseline failures plus five failures introduced during this work. The introduced failures were one standalone detail-view Router dependency and four asynchronous transcript fixture assertions. The Router dependency was removed from the new recovery links; transcript fixtures now use the same deterministic response shape as existing browser fixtures. Both failing files were first reproduced in isolation, so these were not dismissed as contention timeouts.

`pnpm test:web` — exit 1, verbatim tail:

```text
 Test Files  4 failed | 53 passed (57)
      Tests  8 failed | 343 passed (351)
   Start at  22:34:52
   Duration  499.71s (transform 162.43s, setup 0ms, import 653.99s, tests 339.51s, environment 107ms)

[ELIFECYCLE] Command failed with exit code 1.
```

Recovery run:

```bash
pnpm test:web apps/web/src/features/work/components/definition-authoring.browser.test.tsx apps/web/src/features/work/components/work-empty-states.browser.test.tsx apps/web/src/features/work/components/work-list.browser.test.tsx
```

Verbatim tail (exit 0):

```text
 Test Files  3 passed (3)
      Tests  29 passed (29)
   Start at  22:47:09
   Duration  29.11s (transform 0ms, setup 0ms, import 20.64s, tests 7.61s, environment 0ms)
```

Final targeted run (exit 0):

```bash
pnpm test:web apps/web/src/features/work/components/definition-authoring.browser.test.tsx apps/web/src/features/work/components/work-empty-states.browser.test.tsx apps/web/src/features/work/components/work-list.browser.test.tsx apps/web/src/features/work/components/work-card-layout.browser.test.tsx apps/web/src/features/work/components/work-states.browser.test.tsx apps/web/src/features/work/queries/use-work-detail.browser.test.tsx
```

Verbatim tail:

```text
 Test Files  6 passed (6)
      Tests  62 passed (62)
   Start at  22:51:11
   Duration  132.46s (transform 0ms, setup 0ms, import 112.68s, tests 49.60s, environment 0ms)
```

`pnpm web:check:types` — exit 0, verbatim output:

```text
$ pnpm --filter @atomlink-ye/agent-server-web check:types
$ tsc -p tsconfig.app.json --noEmit
```

`pnpm lint` — exit 1. Verbatim final portion:

```text
[warn] Code style issues found in 16 files. Run Prettier with --write to fix.
[ELIFECYCLE] Command failed with exit code 1.
> pnpm typecheck
$ tsc -p tsconfig.json --noEmit && pnpm web:check:types
$ pnpm --filter @atomlink-ye/agent-server-web check:types
$ tsc -p tsconfig.app.json --noEmit
[ELIFECYCLE] Command failed with exit code 1.
```

Formatting failures were all outside the implementation diff: `.shoot.mjs`, agent authoring (2 files), ObservePane test, run-trace (3 files), BoardCardPeek, manager-supplied untracked `BRIEF.md`, three architecture/contract/decision docs, `REPORT-workui.md`, Paseo turn-runner test, Postgres work-organization repository, and provider setup. These were left unchanged.

Some earlier targeted launches timed out connecting Chromium before any tests executed under sibling-lane contention. They are not counted as passes or product regressions. Baseline/card measurement collection also used intentional failing sentinels to print dimensions; those are measurements, not passing validation. Final tests contain no measurement sentinels.

## Boundaries and remaining risks

- The two baseline conversations router failures concern the auth fixture required by those routes, not the Work feedback defect; they remain unchanged: `gives a first-time principal an onboarding empty state at /conversations` and `serves the conversations list at /conversations instead of a route miss`.
- The baseline Files failure, `scrolls the real Files list to its final file on desktop`, belongs to another lane.
- Full-suite green is **not** claimed. It was not rerun after the five introduced failures were fixed, as instructed; final targeted verification is the evidence for those fixes.
- Recorded transcript service-specific error distinctions remain in the shared run-trace component; this lane adds safe navigation/refresh around that existing feedback. No populated transcript or arbitrary long report is claimed to have fixed height. The retained-detail background polling policy was not redesigned.
- No mobile target, live backend, provider runtime, PostgreSQL test, or canary was exercised. No temporary server was launched. Browser measurements use real Chromium with deterministic API fixtures.
- Shared edits are eight small i18n additions plus the artifact guidance correction in each locale. `index.css` is unchanged. `docs/frontend.md` is append-only relative to `fa344fcc`, per manager integration guidance. No public API, durable state contract, or core dependency changed.
