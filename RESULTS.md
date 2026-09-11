# Typography and information density results

Branch: `wui3/ia-b`; baseline: `fa344fcc`.

## Changes and effect

- Replaced all 196 raw CSS `font-size` declarations and the source-preview font shorthand with shared tokens. Removed the 9–11px steps: eyebrow, xs, and sm retain their semantic names but share a 12px floor. The remaining sizes are 13, 14, 16, 20, and 24px; former 15/17px headings use 16px.
- Added shared line-height tokens: 1.35 for tight headings, 1.5 for UI, 1.6 for prose, and 1.65 for code/transcripts. Existing single-symbol alignment keeps separate tokens. Explicitly sized small hints that previously inherited the browser's shrinking `<small>` default.
- Work directory titles grow from 12 to 13px and metadata from 11 to 12px. Vertical padding falls from 10 to 4px per side and the internal gap from 3 to 2px. This keeps more complete records visible while giving the two text lines more leading.
- Added browser assertions for 16 rendered text roles, the size floor, row density, padding, glyph advance, and actual scroll ownership in both locales. Added node guards that reject raw CSS font sizes (including shorthand), local line-height literals, and changes to the token scale.
- Updated the durable typography guidance in `docs/frontend.md`. Shared `index.css` changes are limited to the token block and mechanical size/leading substitutions. No i18n copy or dictionaries changed.

## Browser measurements

Measured in real headless Chromium at **1440×900**, using the production AppRouter, shell, and Work page with 48 deterministic API-fixture Work records. Both locale switches were asserted on the document. Titles contain English or Chinese respectively. These are component-browser measurements; no live backend/provider canary was run.

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

| Metric                          | Before |  After |
| ------------------------------- | -----: | -----: |
| Work row height                 |   57px | 49.5px |
| Fully visible Work rows         |     12 |     14 |
| Row vertical padding, each side |   10px |    4px |
| Gap between title and metadata  |    3px |    2px |
| Scroll viewport height          |  794px |  788px |
| Scroll viewport top             |   90px |   96px |
| Scroll content height           | 3007px | 2647px |

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

Implementation commit `5532b4ac` has been pushed to `origin/wui3/ia-b`.
Verification is still in progress; this is not a claim of a green full suite.

- The initial focused typography command passed 2 files / 4 tests. Final assertions were subsequently expanded and are included in the ongoing full run.
- `pnpm web:check:types` completed successfully (exit 0).
- `pnpm test:web` is still running. It has reproduced the three listed baseline failures and has hit 30-second test deadlines in Work catalog, Observe, Tasks, and Boards. Those files will be rerun individually before attributing a regression.
- `pnpm lint` is still running. Its formatting stage flags untouched baseline files, including the explicitly out-of-scope `REPORT-workui.md`. No formatting-only cleanup of those files is included.

Completed focused-command tail (`pnpm test:web apps/web/src/typography.browser.test.tsx apps/web/src/typography.test.ts`):

```text
 Test Files  2 passed (2)
      Tests  4 passed (4)
   Start at  22:00:40
   Duration  134.03s (transform 1.21s, setup 0ms, import 49.38s, tests 37.49s, environment 0ms)
```

Completed type-command tail:

```text
$ pnpm --filter @atomlink-ye/agent-server-web check:types
$ tsc -p tsconfig.app.json --noEmit
```

## Deliberately not changed

- The three failures listed in BASELINE.md are outside this lane: two Conversations route tests and the Files final-row scroll test. No changes were made to those assertions or their feature behavior.
- No Work/WorkRun copy, routing, status semantics, catalog layout, or navigation redesign was included. No mobile breakpoints were added.
- Other feature styles received token substitutions and the necessary small-hint floor; density optimization was measured and tuned specifically for the Work directory. This does not claim a full visual audit of every trace, form, or file preview.
- No backend, real-provider, or production canary was run. No PR, merge, or rebase was performed.

`RESULTS.md` is included because the lane brief explicitly requires a committed report; raw measurements, logs, and generated screenshots remain ignored local artifacts.
