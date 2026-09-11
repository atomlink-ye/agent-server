# Typography and information density results

Branch: `wui3/ia-b`; baseline: `fa344fcc`.

## Changes and effect

- Replaced all 196 raw CSS `font-size` declarations and the source-preview font shorthand with shared tokens. Removed the 9–11px steps: eyebrow, xs, and sm retain their semantic names but share a 12px floor. The remaining sizes are 13, 14, 16, 20, and 24px; former 15/17px headings use 16px.
- Added shared line-height tokens: 1.35 for tight headings, 1.5 for UI, 1.6 for prose, and 1.65 for code/transcripts. Existing single-symbol alignment keeps separate tokens. Explicitly sized small hints that previously inherited the browser's shrinking `<small>` default.
- Work directory titles grow from 12 to 13px and metadata from 11 to 12px. Vertical padding falls from 10 to 4px per side and the internal gap from 3 to 2px. This keeps more complete records visible while giving the two text lines more leading.
- Added browser assertions for 16 rendered text roles, the size floor, row density, padding, glyph advance, and actual scroll ownership in both locales. Added node guards that reject raw CSS font sizes (including shorthand), local line-height literals, and changes to the token scale.
- Updated the durable typography guidance in `docs/frontend.md`. Shared `index.css` changes are limited to the token block and mechanical size/leading substitutions. No i18n copy or dictionaries changed.

## Browser measurements

Measured in real headless Chromium at **1440×900**, using the production AppRouter, shell, and Work page with 48 deterministic API-fixture Work records. Both locale switches were asserted on the document. Titles contain English or Chinese respectively. These are component-browser measurements; no live backend/provider canary was run. The Vitest harness uses installed fallback fonts from the production font stack and does not load the remote font links in `index.html`.

Sizes come from `getComputedStyle()`. CSSOM returns `normal` for most baseline leading, so the test also measures a two-line probe using the same computed family, size, weight, and line-height with `getBoundingClientRect()`. The following tables report that measured line advance in px, rounded to two decimals. They are not inferred from a nominal multiplier. Unrounded observations stay under ignored `.local/typography/`.

### en

| Selector                                 | Before size px | After size px | Before line-height px | After line-height px |
| ---------------------------------------- | -------------: | ------------: | --------------------: | -------------------: |
| `.rail-brand`                            |             20 |            20 |                    27 |                30.00 |
| `.rail-language-button`                  |             12 |            12 |                    12 |                12.00 |
| `.pane-heading h1`                       |             20 |            20 |                    27 |                30.00 |
| `.pane-heading .eyebrow`                 |             10 |            12 |                    14 |                18.00 |
| `.pane-count`                            |             11 |            12 |                    15 |                18.00 |
| `.pane-refresh`                          |             20 |            20 |                    27 |                30.00 |
| `.work-list-copy strong`                 |             12 |            13 |                    17 |                19.50 |
| `.work-list-meta`                        |             11 |            12 |                    15 |                18.00 |
| `.work-list-mark`                        |             11 |            12 |                    15 |                18.00 |
| `.title-bar`                             |             11 |            12 |                    15 |                18.00 |
| `.work-landing__intro .eyebrow`          |             10 |            12 |                    14 |                18.00 |
| `.work-landing__intro h1`                |             24 |            24 |                    32 |                36.00 |
| `.work-landing__intro > p:not(.eyebrow)` |             13 |            13 |                  19.5 |                20.80 |
| `.work-landing__recent strong`           |             16 |            16 |                    21 |                24.00 |
| `.work-landing__recent time`             |             12 |            12 |                    17 |                18.00 |
| `.work-landing__no-run`                  |             12 |            12 |                    17 |                18.00 |

### zh-CN

| Selector                                 | Before size px | After size px | Before line-height px | After line-height px |
| ---------------------------------------- | -------------: | ------------: | --------------------: | -------------------: |
| `.rail-brand`                            |             20 |            20 |                    27 |                30.00 |
| `.rail-language-button`                  |             12 |            12 |                    12 |                12.00 |
| `.pane-heading h1`                       |             20 |            20 |                    27 |                30.00 |
| `.pane-heading .eyebrow`                 |             10 |            12 |                    14 |                18.00 |
| `.pane-count`                            |             11 |            12 |                    15 |                18.00 |
| `.pane-refresh`                          |             20 |            20 |                    27 |                30.00 |
| `.work-list-copy strong`                 |             12 |            13 |                    17 |                19.50 |
| `.work-list-meta`                        |             11 |            12 |                    15 |                18.00 |
| `.work-list-mark`                        |             11 |            12 |                    15 |                18.00 |
| `.title-bar`                             |             11 |            12 |                    15 |                18.00 |
| `.work-landing__intro .eyebrow`          |             10 |            12 |                    14 |                18.00 |
| `.work-landing__intro h1`                |             24 |            24 |                    32 |                36.00 |
| `.work-landing__intro > p:not(.eyebrow)` |             13 |            13 |                  19.5 |                20.80 |
| `.work-landing__recent strong`           |             16 |            16 |                    21 |                24.00 |
| `.work-landing__recent time`             |             12 |            12 |                    17 |                18.00 |
| `.work-landing__no-run`                  |             12 |            12 |                    17 |                18.00 |

### List density and scroll ownership

Identical measured results in English and Simplified Chinese:

| Metric                  | Before |  After |
| ----------------------- | -----: | -----: |
| Work row height         |   57px | 49.5px |
| Fully visible Work rows |     12 |     14 |
| Scroll viewport height  |  794px |  788px |
| Scroll viewport top     |   90px |   96px |
| Scroll content height   | 3007px | 2647px |

The row count includes only rows completely inside the scroller bounds. The existing 5px gap between rows is unchanged. The header grows by 6px with the new leading; even with that slightly smaller scroll viewport, two additional complete rows fit. `.work-pane-scroll.scroll-region` remains the owner: its scrollHeight exceeds clientHeight, the list itself has `overflow-y: visible`, and scrolling the pane reaches the final row. No overflow rule was reintroduced on the list.

### Why a shared 12px floor

The browser's actual glyph metrics for `审查研究结果`, using the installed fallback from the production font stack, were identical in both locales:

| Font size | Six-glyph advance | Ink height |
| --------- | ----------------: | ---------: |
| 9px       |              54px |       10px |
| 10px      |              60px |       11px |
| 11px      |              66px |       12px |
| 12px      |              72px |       13px |
| 13px      |              78px |       14px |

12px gives each ideograph 12px of horizontal advance instead of 9–10px and supports an 18px UI line advance. The primary Work title uses 13px with 19.5px leading. The 12px floor is an engineering lower bound for compact labels, not a claim that glyph bounds prove universal human readability. No locale-only size ramp is needed: both locales retain 14 complete rows, and mixed-script user content needs the same minimum. Font rasterization on other operating systems and human readability at different zoom levels were not tested.

## Verification

The implementation and measurements are committed on `wui3/ia-b`. No PR was opened.

`pnpm test:web` was **not green**: 6 failed / 49 passed files, 7 failed / 301 passed tests. Three failures are the documented baseline reds:

1. `router.browser.test.tsx > gives a first-time principal an onboarding empty state at /conversations`
2. `router.browser.test.tsx > serves the conversations list at /conversations instead of a route miss`
3. `FilesPage.browser.test.tsx > scrolls the real Files list to its final file on desktop`

The other four failures were test/screenshot deadlines. Work, Observe, Tasks, and Boards were rerun in separate single-file commands, with no changes to those tests or their timeouts. Final rerun outcomes and exact command tails are below. The first isolated Observe attempt lost the browser connection before executing its test (`tests 0ms`, 1 runner error); that was not counted as a pass.

Full-suite verbatim tail:

```text

 Test Files  6 failed | 49 passed (55)
      Tests  7 failed | 301 passed (308)
   Start at  22:09:52
   Duration  803.50s (transform 267.14s, setup 0ms, import 1071.56s, tests 566.85s, environment 38ms)

[ELIFECYCLE] Command failed with exit code 1.
```

| Rerun file                 | Broad-run test execution | Isolated test execution |
| -------------------------- | -----------------------: | ----------------------: |
| Work directory and catalog |                  72.299s |                 45.310s |
| Observe                    |                  37.012s |                 14.220s |
| Tasks                      |                  48.853s |                 32.120s |
| Boards                     |                  44.338s |                 42.580s |

These are whole-file test execution times, not total command startup/import time.

### Work directory and catalog

`pnpm test:web apps/web/src/features/work/components/work-list.browser.test.tsx`

```text
 Test Files  1 passed (1)
      Tests  8 passed (8)
   Start at  22:24:47
   Duration  165.23s (transform 0ms, setup 0ms, import 54.93s, tests 45.31s, environment 0ms)
```

### Observe

`pnpm test:web apps/web/src/features/observe/ObservePage.browser.test.tsx`

```text
 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  22:41:32
   Duration  84.31s (transform 0ms, setup 0ms, import 32.17s, tests 14.22s, environment 0ms)
```

### Tasks

`pnpm test:web apps/web/src/features/work-organization/TasksPage.browser.test.tsx`

```text
 Test Files  1 passed (1)
      Tests  10 passed (10)
   Start at  22:33:52
   Duration  108.21s (transform 0ms, setup 0ms, import 30.88s, tests 32.12s, environment 0ms)
```

### Boards

`pnpm test:web apps/web/src/features/work-organization/BoardsPage.browser.test.tsx`

```text
 Test Files  1 passed (1)
      Tests  15 passed (15)
   Start at  22:36:24
   Duration  137.63s (transform 0ms, setup 0ms, import 47.05s, tests 42.58s, environment 0ms)
```

### Final typography guards

`pnpm test:web apps/web/src/typography.browser.test.tsx apps/web/src/typography.test.ts`

```text
 Test Files  2 passed (2)
      Tests  6 passed (6)
   Start at  22:39:29
   Duration  78.35s (transform 793ms, setup 0ms, import 35.94s, tests 7.96s, environment 0ms)
```

### Types and lint

`pnpm web:check:types` completed with exit 0:

```text
$ pnpm --filter @atomlink-ye/agent-server-web check:types
$ tsc -p tsconfig.app.json --noEmit
```

`pnpm lint` completed with exit 1 because Prettier flagged 15 files. All 15 were compared byte-for-byte with `fa344fcc` and are unchanged by this lane. Both TypeScript stages completed; no TypeScript diagnostic was emitted. The out-of-scope formatting files were deliberately left untouched, especially `REPORT-workui.md`, which the brief explicitly says not to change.

Verbatim lint tail:

```text
[warn] docs/decisions/0013-task-ordering-in-the-description.md
[warn] REPORT-workui.md
[warn] src/adapters/paseo/paseo-turn-runner.test.ts
[warn] src/infrastructure/postgres/postgres-work-organization-repository.ts
[warn] tooling/dev/setup-providers.ts
[warn] Code style issues found in 15 files. Run Prettier with --write to fix.
[ELIFECYCLE] Command failed with exit code 1.
> pnpm typecheck
$ tsc -p tsconfig.json --noEmit && pnpm web:check:types
$ pnpm --filter @atomlink-ye/agent-server-web check:types
$ tsc -p tsconfig.app.json --noEmit
[ELIFECYCLE] Command failed with exit code 1.
```

Unchanged files flagged by the formatter:

- `.shoot.mjs`
- `apps/web/src/features/agents/authoring.ts`
- `apps/web/src/features/agents/AuthoringPanels.tsx`
- `apps/web/src/features/observe/ObservePane.browser.test.tsx`
- `apps/web/src/features/run-trace/events.tsx`
- `apps/web/src/features/run-trace/inspector.tsx`
- `apps/web/src/features/run-trace/run-trace-view.tsx`
- `apps/web/src/features/work-organization/BoardCardPeek.tsx`
- `docs/architecture/computer-placement-gap.md`
- `docs/contracts/work-organization-api.md`
- `docs/decisions/0013-task-ordering-in-the-description.md`
- `REPORT-workui.md`
- `src/adapters/paseo/paseo-turn-runner.test.ts`
- `src/infrastructure/postgres/postgres-work-organization-repository.ts`
- `tooling/dev/setup-providers.ts`

The baseline typography capture also ran `pnpm test:web apps/web/src/typography.browser.test.tsx` against the original CSS and passed both locale cases. Its final baseline-capture tail was:

```text
 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  22:04:59
   Duration  120.72s (transform 0ms, setup 0ms, import 49.50s, tests 17.10s, environment 0ms)
```

## Deliberately not changed

- The three failures listed in BASELINE.md are outside this lane: two Conversations route tests and the Files final-row scroll test. No changes were made to those assertions or their feature behavior.
- No Work/WorkRun copy, routing, status semantics, catalog layout, or navigation redesign was included. No mobile breakpoints were added.
- Other feature styles received token substitutions and the necessary small-hint floor; density optimization was measured and tuned specifically for the Work directory. This does not claim a full visual audit of every trace, form, or file preview.
- No backend, real-provider, or production canary was run. No PR, merge, or rebase was performed.

`RESULTS.md` is included because the lane brief explicitly requires a committed report; raw measurements, logs, and generated screenshots remain ignored local artifacts.
