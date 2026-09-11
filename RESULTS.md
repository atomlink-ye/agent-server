# Desktop scroll audit

Base: `fa344fcc`. Target: real Chromium at 1440 × 900. **Verification is in progress.**
The branch has been pushed; no PR, merge, or rebase was performed.

## Changes and measured evidence

The audit mounts the real AppRouter/AppShell, with feature CSS followed by
`index.css`, matching production import order. Deterministic API fixtures provide
50 WorkRuns for one Work, 2,000 transcript paragraphs, a 500-line Definition
metadata description, and 200-character English/Chinese titles. Ordinary cases
use three records and eight paragraphs. This exercises browser layout with mocked
reads, not a live API, database, or provider.

| Route                                                            | Container                                                                                   | Symptom and measured before → after                                                                                                               | Fix / status                                                                                                                                                                                      |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/files`, oversized English                                      | `.chat-panel.files-main`                                                                    | Bounds remain top 0 / bottom 900px; client height 900 → 900px; content height 74,567 → 74,696px; computed overflowY `hidden` → `auto`             | Increase specificity only for the Files scroll owner so the production shell rule cannot override it. Browser scroll/end-point assertions pass; scope endpoint fixture correction is being rerun. |
| `/files`, oversized Chinese                                      | `.chat-panel.files-main`                                                                    | Client height 900 → 900px; content height 74,791 → 74,824px; `hidden` → `auto`                                                                    | Same scroll ownership fix.                                                                                                                                                                        |
| `/files`, 200-character unbroken English filename                | `.files-main`, `.files-file-viewer h2`                                                      | Main scroll width 2,910 → 1,028px with a 1,028px client width                                                                                     | Wrap long filenames; assert scrollWidth equals clientWidth.                                                                                                                                       |
| `/files`, oversized preview                                      | `.files-rendered-markdown`                                                                  | Before: 438px box / 74,174px text content in English; 214px box / 74,174px content in Chinese. Text extends beyond the box into trailing actions. | Prevent flex shrink; assert actions follow the preview and the final actions are reachable. Updated box measurements pending.                                                                     |
| `/files`, scope and file directories                             | `.files-scope-list`, `.files-file-list`                                                     | Before and after: 794px / 6,284px (English scopes), 684px / 2,648px (files), `auto`                                                               | No ownership change. The audit now checks the actual last scope, which is a Work scope after the Coworker scopes.                                                                                 |
| `/`, `/conversations/:id`                                        | Conversation directory, transcript, composer                                                | Earlier partial audit observed a 651px / 3,025px directory and 624px / 67,234px transcript at `/`; no layout change claimed                       | Full rerun pending.                                                                                                                                                                               |
| `/work` and `/work/:workId`, every tab and selected-Run variants | `.work-pane-scroll.scroll-region`, detail, chat history/composer, Definition editor, Result | Earlier partial audit observed a 794px / 3,131px Work directory with `auto`; `.work-list` remains `visible`                                       | Full rerun pending. No Work CSS changed.                                                                                                                                                          |
| `/observe?work=&run=`                                            | Observe directory, detail and trace                                                         | Coverage pending valid fixture rerun                                                                                                              | No change yet.                                                                                                                                                                                    |
| `/agents`, `/agents/:id`                                         | Roster, directory, profile                                                                  | Partial profile observation: directory 666px / 4,096px; main 900px / 900px. Unbroken English title produces horizontal overflow.                  | Full rerun pending. Three-line profile bio clamp is intentional; not counted as a vertical scroll bug.                                                                                            |
| `/tasks/:id`                                                     | Task directory and detail/comments                                                          | Coverage pending                                                                                                                                  | No change yet.                                                                                                                                                                                    |

The existing Files test fixture now answers `/api/auth/me`, so its router can
reach Files. Its original scope-list, file-list, and preview assertions were
preserved. This is a fixture correction, not credit for clearing a baseline red.
The new audit exposed the production CSS-order issue independently.

No mobile breakpoints, shared `index.css`, i18n files, or Work list overflow rules
were changed. Generated logs remain ignored under `.local/`. This explicitly
requested RESULTS.md is the only campaign report committed.

## Commands actually run

`pnpm test:web src/features/files/FilesPage.browser.test.tsx` passed after the
auth fixture correction, before the Files CSS change. Verbatim tail:

```text
 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  22:02:44
   Duration  129.75s (transform 0ms, setup 0ms, import 43.57s, tests 17.43s, environment 0ms)
```

`pnpm test:web src/app/router/scroll.browser.test.tsx -t '/files' --browser.screenshotFailures=false`
ran after the CSS fix. Verbatim tail:

```text
 Test Files  1 failed (1)
      Tests  2 failed | 1 passed | 63 skipped (66)
   Start at  22:40:47
   Duration  83.95s (transform 0ms, setup 0ms, import 21.02s, tests 35.04s, environment 0ms)
```

Both failures were the audit's scope endpoint selection: the last Coworker is
not the last Files scope. The Files preview scrolling, width, action-order, and
viewport assertions passed. The selector has been corrected; the whole audit is
running again, including source-mode reachability. No timeout was increased.
Automatic failure screenshots were disabled to avoid an unrelated screenshot
stability timeout under contention.

`pnpm web:check:types` exited 0 before the latest fixture/assertion additions:

```text
$ pnpm --filter @atomlink-ye/agent-server-web check:types
$ tsc -p tsconfig.app.json --noEmit
```

`pnpm lint` exited 1. The format stage reported 17 files: the draft audit before
formatting, the untracked manager-supplied BRIEF.md, and unchanged baseline files
including `.shoot.mjs`, Agent authoring, Observe, Run Trace, BoardCardPeek,
architecture/contracts/decision docs, REPORT-workui, Paseo/postgres files, and
setup-providers. Root and Web type checking subsequently completed without
errors. Unrelated baseline formatting was not changed. Final rerun pending.

Several early audit attempts failed to connect to Chromium or disconnected
under the manager-confirmed 3-core / 8GB, six-lane host load. Others were
interrupted during harness development. Early Work/Observe fixtures omitted
`source_yaml` or exceeded per-message limits; their error-page measurements are
**not** Work/Observe layout evidence. Those fixture defects were corrected and
schema validation added. No startup timeout is claimed as a product regression.

## Remaining work

Finish the valid 66-case audit; fix measured traps; verify source mode; refresh
measurements, command tails, and limitations; rerun final types/lint; commit and
push the final report. No complete route-coverage or all-green claim is made yet.
