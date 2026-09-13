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
- `pnpm web:check:types`: passed.
- Full `CI=true pnpm test:web`: the in-scope Files baseline failure is fixed. The two documented router baseline failures remain. One unrelated pre-existing Work feedback height pin also failed (`expected 133`, rendered `124`) and reproduces in isolation; none of this lane's CSS selectors apply to that component.

Verbatim full-suite summary:

```text
 Test Files  2 failed | 70 passed (72)
      Tests  3 failed | 551 passed (554)
```

## Delivery

Commits were created incrementally and pushed to `origin/r3/lane-b`. Earlier attempts failed while GitHub credentials were unavailable; the final push succeeded:

```text
To https://github.com/atomlink-ye/agent-server.git
 * [new branch]      HEAD -> r3/lane-b
```

## Headless walkthrough observations

Evidence was captured at 1440×900 through the repository's headless Playwright/Vitest browser harness:

- [Files walkthrough](docs/ux/r3/files-walkthrough.gif)
- [Workspace walkthrough](docs/ux/r3/workspace-walkthrough.gif)

Files observations:

- The long Files list scrolls to its final row without stalling. The selected final file opens and its long preview scrolls to the final heading.
- Scroll ownership is visually consistent with the implementation: the file list scrolls independently until a file is opened; long preview content then scrolls in the main Files pane.
- No horizontal layout break or visible path overflow was observed. Long paths remain single-line and ellipsized in the list; the full selected path wraps in the preview heading.
- A normal Workspace-scope file preview has no Back action. Because selection stays in the split list/preview layout, returning means selecting another file or scope. The explicit Back action exists only for routed Work-result files. This is the one point where the requested “go back” flow has no direct UI control.

Workspace observations (implemented as the Tasks and Boards surfaces; there is no `/workspace` route):

- Tasks list scrolling and detail/comment scrolling both reach their final entries without stalling. The `+ New Task` primary action opens its in-app authoring state.
- Boards list, vertical Board content, and horizontal Board canvas each reach their final entries. The `+ New Board` and `+ New Task` Board actions open in-app authoring states and remain inside the 1440 layout.
- No clipped controls, horizontal text overflow, or broken card/column layout was observed during these flows.
- Repeated 1440 geometry checks in `en` and `zh-CN` showed no visible Chinese size/density mismatch on Files, Tasks, or Boards. Simplified Chinese uses the same 12px minimum metadata and shared body/control scale as English; localized heading actions wrap within their existing bounds.

Recording verification:

```text
 Test Files  3 passed (3)
      Tests  30 passed (30)

 Test Files  2 passed (2)
      Tests  29 passed (29)
```

## GIF critique follow-up

The five visual-weight issues found in the walkthrough were corrected and measured at 1440×900 in real Chromium. English and Simplified Chinese produced the same structural measurements; text hierarchy assertions use computed size/weight and parent-relative geometry rather than platform-sensitive text widths.

| Area                  | Before                                                                                                                       | After (en and zh-CN)                                                                                                                                                                                                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files idle preview    | The bordered viewer filled the `644×748px` preview region around one centered hint.                                          | The quiet idle viewer is `644×194px` and top-aligned; selecting a file restores the full `644×748px` viewer.                                                                                                                                                                                |
| Files list rows       | Two-line rows were approximately `57.5px` tall and repeated version plus truncated hash.                                     | Filename-only rows use a deliberate `38px` minimum; the full list still scrolls to its final row. Hash remains available in the selected-file header.                                                                                                                                       |
| Files coworker scopes | Two bordered pill controls visually competed with each coworker name.                                                        | Scope choices are one quiet segmented text row. Coworker names render at `13px`, controls at `12px`; name weight is at least the control weight and the control row is less than `1.5×` the name line height.                                                                               |
| Tasks list rows       | Homogeneous fixtures rendered approximately `97.1875px` rows with repeated To do and Unassigned signals.                     | Homogeneous rows use a deliberate `73px` target and omit both repeated signals. Mixed lists retain status and assignee chips, including Unassigned where it contrasts with assigned rows.                                                                                                   |
| Tasks right column    | The empty Formal execution card appeared above Comments; a long Comments card measured roughly `4792px` with no visible end. | Comments appear first in a `313.3125px` column; the card measured `480px`, with history bounded to `280px` and independently scrollable while composer/action remain visible. Ready-with-zero-Definitions Formal execution is compact and removes redundant prose plus the disabled action. |

Final focused verification:

```text
 Test Files  2 passed (2)
      Tests  18 passed (18)
```
