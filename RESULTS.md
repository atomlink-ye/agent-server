# Lane B results

## Changes

- Restored Files scroll ownership by flex-bounding the file workspace so `.files-file-list` is the list scroller and reaches its final row, while `.files-main` continues to scroll long previews.
- Updated the real Files browser regression to pass the authenticated workspace boundary before exercising the list and preview.
- Contained desktop Boards/Tasks heading actions in both locales and allowed long Latin/CJK Board card titles to wrap inside their fixed-width cards.
- Added 1440px browser geometry regressions for heading actions and long Board card titles in English and Simplified Chinese.

## 1440px measurements

Measurements below come from `getBoundingClientRect()` in real Chromium at a 1440×900 viewport. Decimal rendering values are recorded as evidence only; regression assertions compare containment to parent edges with a 1px tolerance.

| Surface / locale | Before                                                                                                                                              | After                                                                                                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files / en       | File list expanded with its contents, leaving the outer `.files-main` as the effective list scroller; the inner list had no bounded overflow range. | Main `1028×900` at `x=412`; grid `980×748` at `x=436`; viewer `644×748` at `x=772`. The bounded list reaches its final row, and the deep Latin path stays within the row by ≤1px.       |
| Files / zh-CN    | Same flex sizing defect; locale did not change scroll ownership.                                                                                    | Main `1028×900` at `x=412`; grid `980×748` at `x=436`; viewer `644×748` at `x=772`. The bounded list reaches its final row, and the deep CJK path stays within the row by ≤1px.         |
| Boards / en      | Heading/card flex children retained intrinsic min-content width, so an unbroken title or action could exceed its container.                         | Title bar rectangle: `1028×44` at `x=412`; Board column width `290`, card width `256`, card padding `16`; action and long unbroken card title remain within parent right edges by ≤1px. |
| Boards / zh-CN   | Heading/card flex children retained intrinsic min-content width; wider CJK action/title copy could exceed the fixed sidebar/card.                   | Title bar rectangle: `1028×44` at `x=412`; Board column width `290`, card width `256`, card padding `16`; action and long CJK card title remain within parent right edges by ≤1px.      |
| Tasks / en       | Heading title/action children had no explicit shrink contract.                                                                                      | Title bar rectangle: `1028×44` at `x=412`; content gutter `24`, card padding `16`; New Task action stays inside the heading and has no internal horizontal overflow.                    |
| Tasks / zh-CN    | Wider action copy had no explicit shrink/wrap contract.                                                                                             | Title bar rectangle: `1028×44` at `x=412`; content gutter `24`, card padding `16`; localized New Task action stays inside the heading and has no internal horizontal overflow.          |

## Verification

- `CI=true pnpm test:web apps/web/src/features/files/FilesPage.browser.test.tsx`: passed.
- `CI=true pnpm test:web apps/web/src/features/work-organization/BoardsPage.browser.test.tsx apps/web/src/features/work-organization/TasksPage.browser.test.tsx`: passed.
- `pnpm lint`: passed.
- Full `CI=true pnpm test:web`: the in-scope Files baseline failure is fixed. The two documented router baseline failures remain. One unrelated pre-existing Work feedback height pin also failed (`expected 133`, rendered `124`) and reproduces in isolation; none of this lane's CSS selectors apply to that component.

Verbatim full-suite summary:

```text
 Test Files  2 failed | 70 passed (72)
      Tests  3 failed | 550 passed (553)
```

## Delivery

Commits were created incrementally. Push attempts failed because `origin` requires HTTPS credentials that are not available in this worktree:

```text
fatal: could not read Username for 'https://github.com': No such device or address
```
