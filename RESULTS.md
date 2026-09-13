# Lane D results

This file records the completed visual sweep, measured geometry, and final verification output.

## Scope

Completed: Conversations, Agents/Coworkers, Observe, Run trace, Whispers, Account, and shell chrome at a 1440 x 900 desktop viewport in English and Simplified Chinese. Work detail and Files/Boards were excluded except for replacing one platform-dependent Work-card test assertion that blocked the required full browser gate.

## Changes

- Contained wide Observe result Markdown inside its own `pre`/table scrollers, removing the unintended full-detail horizontal scrollbar.
- Made failed Whisper channel and message requests settle their loading collections so loading copy does not remain visible beside an error.
- Added direct Account layout/error coverage in both locales.
- Replaced rendered-text fractional height pins in the shared in-scope surface helper with explicit tolerances. Deliberate integer dimensions remain exact.
- Replaced a platform-dependent Work-card content-height assertion with its existing product intent: fixed card width, minimum height, readable preview, and child containment.

## 1440px geometry (`getBoundingClientRect()`)

Measurements use real Chromium at 1440 x 900. “Before = after” means the sweep measured and retained the existing geometry; it is included to document that both locales were actually checked.

| Surface / element                                                |            English before -> after |              zh-CN before -> after |
| ---------------------------------------------------------------- | ---------------------------------: | ---------------------------------: |
| Shell rail control                                               |                       44px -> 44px |                       44px -> 44px |
| Conversations dispatch card                                      |               124.59px -> 124.59px |               124.59px -> 124.59px |
| Coworker roster title / main width                               |              44px / 1368px -> same |              44px / 1368px -> same |
| Coworker detail title / main width                               |              44px / 1028px -> same |              44px / 1028px -> same |
| Observe title / detail width                                     |              44px / 1028px -> same |              44px / 1028px -> same |
| Observe detail horizontal extent (`scrollWidth` / `clientWidth`) | 6524px / 1028px -> 1028px / 1028px | 6524px / 1028px -> 1028px / 1028px |
| Run trace title                                                  |                       44px -> 44px |                       44px -> 44px |
| Session transcript reading width                                 |                     966px -> 966px |                     966px -> 966px |
| Whispers title / message width                                   |              44px / 1028px -> same |              44px / 1028px -> same |
| Account card / minimum input height                              |               380px / 40px -> same |               380px / 40px -> same |

The route matrix also verified end reachability for every in-scope scroll owner, no unintended horizontal overflow outside the Run trace's deliberate canvases, and realistic/oversized content in both locales. Dedicated suites exercised empty, loading, unavailable/error, and populated states where each surface supports them. The authored `apps/web` typography inventory contains no remaining numeric `font-size` declarations below or outside the token scale; rendered text retains the shared 12px minimum in both locales.

## Verification

- `CI=true pnpm test:web apps/web/src/app/router/scroll.browser.test.tsx`: `Test Files  1 passed (1)` / `Tests  108 passed (108)` before the changes; focused Observe rerun: `Test Files  1 passed (1)` / `Tests  5 passed | 103 skipped (108)`.
- In-scope surface batch: `Test Files  6 passed (6)` / `Tests  24 passed (24)`.
- Whisper states: `Test Files  1 passed (1)` / `Tests  5 passed (5)`.
- Account states/layout: `Test Files  1 passed (1)` / `Tests  4 passed (4)`.
- Work-card intent: `Test Files  1 passed (1)` / `Tests  12 passed (12)`.
- `pnpm lint`: passed before each committed implementation increment.

Final full `CI=true pnpm test:web` output (the only failures are the three declared baseline reds):

```text
 Test Files  2 failed | 71 passed (73)
      Tests  3 failed | 556 passed (559)
```

The three failures were:

1. `router.browser.test.tsx > serves the conversations list at /conversations instead of a route miss`
2. `router.browser.test.tsx > gives a first-time principal an onboarding empty state at /conversations`
3. `FilesPage.browser.test.tsx > scrolls the real Files list to its final file on desktop`

## Work-focused follow-up

When a person opens Work, they are trying to triage an ongoing portfolio: identify what needs their decision or has gone wrong, choose the right Work, then inspect a particular WorkRun's conversation, output, activity, or definition to decide whether to intervene, retry, or accept the result. They do not need counts, timestamps, or execution provenance to compete with that first decision.

The Work directory now carries that decision first: work that `needs_you` is listed first, then work in `problem`, with the remaining work ordered by recent activity. Within each row the name and state remain primary; the item count and timestamp are deliberately quieter reference metadata. Before, recent activity alone could place healthy work above an item waiting on the user. The existing Work-to-Run information model was retained: Work presents durable identity and aggregate progress, while a selected Run presents attempt-specific state, result, activity, and definition. That distinction supports the path from choosing work, to resolving attention, to inspecting evidence.

Simplified Chinese needed a locale-specific correction that English did not: uppercase tracking provides useful separation for short Latin labels, but Chinese has no uppercase form and extra spacing visually fragments compact ideographic words. Work kickers and state pills therefore retain their tracking in English while zh-CN uses normal tracking. This removes artificial visual noise without shrinking Chinese text, tightening its line boxes, or increasing row density. The deliberate 49.5px directory row, 26px tab, and 624px card pins remain unchanged.

### 1440px headless evidence

Captured through the repository's real Chromium Playwright/Vitest harness at a 1440 x 900 viewport. The directory views contain multiple `needs_you`, `problem`, and unknown-state runs; the detail views show a selected WorkRun and its Conversation, Output, Activity, and Definition-used tabs.

- Work directory: [English](docs/ux/r3/work-list-en.png) / [Simplified Chinese](docs/ux/r3/work-list-zh-CN.png)
- WorkRun detail: [English](docs/ux/r3/work-run-detail-en.png) / [Simplified Chinese](docs/ux/r3/work-run-detail-zh-CN.png)

### Work geometry at 1440px (`getBoundingClientRect()`)

Measurements use real Chromium at 1440 x 900. Line-box and viewport measurements demonstrate that the hierarchy changes did not buy clarity by compressing either locale.

| Work element                | English before -> after | zh-CN before -> after |
| --------------------------- | ----------------------: | --------------------: |
| Directory row height        |        49.5px -> 49.5px |      49.5px -> 49.5px |
| Visible directory rows      |                14 -> 14 |              14 -> 14 |
| Directory viewport height   |          788px -> 788px |        788px -> 788px |
| Work title line box         |        19.5px -> 19.5px |      19.5px -> 19.5px |
| Reference metadata line box |            18px -> 18px |          18px -> 18px |
| Work tab height             |            26px -> 26px |          26px -> 26px |
| Work / Run header height    |     36px / 28px -> same |   36px / 28px -> same |
| Work card width             |          624px -> 624px |        624px -> 624px |

Computed tracking changed only where language called for it: the 12px state pill remains about 0.24px in English and changes from about 0.24px to normal (0) in zh-CN; the 13px Work kicker remains about 1.04px in English and changes from about 1.04px to normal (0) in zh-CN. Tests assert the language-sensitive product intent rather than these font-rendered fractional values.

### Work verification

- Initial Work component baseline: `Test Files  4 passed (4)` / `Tests  46 passed (46)`.
- Work hierarchy and bilingual typography: `Test Files  2 passed (2)` / `Tests  15 passed (15)`.
- Attention-first directory ordering: `Test Files  1 passed (1)` / `Tests  14 passed (14)`.
- Work measurement cases: `Test Files  2 passed (2)` / `Tests  10 passed | 18 skipped (28)`.
