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
