# Desktop scroll and overflow audit

Base: `fa344fcc`. Branch: `wui3/lane-a`. Target: real Chromium at **1440 × 900**.
The final route audit passed **72/72 cases**. Web type checking passed. Lint is
red on **16 unchanged/pre-existing formatting files**, listed below.

## User-visible changes

Files previews can scroll through the complete document and reach their trailing
actions. Long filenames, Coworker names, Task titles, transcript labels, and
Observe filters stay within their desktop columns. Existing vertical scrolling
owners remain responsible for reaching the last record.

The implementation changes only feature CSS. No `index.css`, i18n, package,
contract, or Vitest configuration changes remain. No mobile breakpoints were
added. No PR, merge, or rebase was performed.

## Measured defects and fixes

These are browser measurements, not CSS estimates. Widths below are
`scrollWidth` before → after in px; the tests also pin the containing
`getBoundingClientRect().width` and require `scrollWidth === clientWidth`.
English stress cases are shown unless both locales are explicitly listed.
Every listed fix has an oversized English and Chinese route case.

| Route                                                      | Container                                         | Symptom / before → after evidence                                                                                                                                                     | Fix and assertion                                                                                                                                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/files`                                                   | `.chat-panel.files-main`                          | 900px-high panel with 74,567px English / 74,791px Chinese content had `overflowY: hidden`. After: same rectangle, top 0 / bottom 900px, `overflowY: auto`; content 74,696 / 74,824px. | Specificity protects the Files scroll owner from the later shell rule. Assert overflow, positive scrollTop, maximum scroll position, and final content bounds. Final scrollTop: 73,796 / 73,924px. |
| `/files`                                                   | `.files-rendered-markdown`                        | Preview box 438px English / 214px Chinese → 74,174px in both; text content is 74,174px. The shrunken box let text extend through trailing actions.                                    | Disable flex shrink. Pin preview clientHeight to 74,174px and to scrollHeight; actions follow the complete preview. Scrolled action bounds are y=875–900px in both locales.                        |
| `/files`                                                   | `.files-file-viewer h2`, `.files-main`            | Long filename expands main content width 2,910 → 1,028px.                                                                                                                             | Allow filename wrapping; pin the main rectangle to 1,028 × 900px and require no horizontal overflow.                                                                                               |
| `/agents`                                                  | `.agents-roster-identity-copy`, `.agents-main`    | Long name expands roster content width 2,922 → 1,368px.                                                                                                                               | Wrap long names; pin the roster width and retain vertical last-card reachability.                                                                                                                  |
| `/agents/:id`                                              | `.agents-list-copy`, `.agents-list`               | Directory content width 1,674 → 307px.                                                                                                                                                | Wrap long names; pin directory width and reach its final Coworker.                                                                                                                                 |
| `/agents/:id`                                              | `.agents-profile-copy`, `.agents-main`            | Profile content width 2,298 → 1,028px, pushing its actions beyond the column.                                                                                                         | Allow the flex copy to shrink and names to wrap. Pin main width and require the action rectangle to end at or before x=1,440px.                                                                    |
| `/tasks/:id`                                               | `.work-org-list-item`, `.work-org-list`           | Task directory content width 1,442 → 307px.                                                                                                                                           | Wrap long titles; pin width and scroll to the final Task.                                                                                                                                          |
| `/tasks/:id`                                               | `.work-org-card`, `.work-org-content`             | Detail content width 3,327 → 1,028px, including an oversized description field.                                                                                                       | Allow cards to shrink and text to wrap; pin width and reach the final comment.                                                                                                                     |
| `/observe?work=&run=`                                      | `.observe-agent-chip`, `.observe-pane .work-list` | Directory content width 1,195 → 307px.                                                                                                                                                | Wrap agent chips inside their existing column. The existing Observe list still scrolls to its final WorkRun.                                                                                       |
| `/observe?work=&run=`                                      | `.observe-filters`, `.observe-pane`               | Filter content width 1,322 English / 2,425 Chinese → 267px in both. The sidebar clipped the oversized native select.                                                                  | Constrain labels and selects to their available width. Pin filter rectangle to 267px, sidebar rectangle to 340px, and require no horizontal overflow in either.                                    |
| `/observe?work=&run=`                                      | `.run-trace`, `.work-main-content`                | Detail content width 1,576 → 1,028px.                                                                                                                                                 | Use a shrinkable grid column and wrap labels. Pin the main width; exercise Timeline, Map, and MCP Activity and reach the final trace footer.                                                       |
| `/work/:id?tab=transcript&run=`                            | `.run-trace`, `.work-main-content`                | Transcript content width 1,407 → 1,028px.                                                                                                                                             | Constrain the grid rather than letting its content size the whole page. Keep the 2,000-paragraph transcript vertically reachable.                                                                  |
| `/work/:id?tab=result&run=` and legacy `tab=overview&run=` | `.work-role-card`, `.work-main-content`           | Result content width 1,190 → 1,028px.                                                                                                                                                 | Give role cards a shrinkable grid column and wrap session names. Both Result entry paths pin main width and reach the final Result paragraph.                                                      |

The Files trap depends on production CSS order: feature styles load before the
shell's `index.css`. The route audit uses that order. The old Files test loaded
styles in the opposite order and also lacked `/api/auth/me`; its fixture now
answers that read so it reaches Files. Its original scroll assertions were
preserved. The baseline red is not counted as newly discovered work.

## Route coverage and scroll owners

The suite contains **24 route variants × 3 content cases**: ordinary English,
oversized English, and oversized Chinese. The oversized fixture has 50 WorkRuns
for one Work, 50 directory records, 2,000 transcript paragraphs (3,999 literal
lines), a Definition description with 500 lines, and 200-character titles.
It mounts the actual AppRouter/AppShell and uses deterministic API reads derived
from a product recording. Definition, transcript, and Work chat fixtures are
validated against their contracts.

| Route / state                              | Significant containers and final observed clientHeight / scrollHeight in px                        | Verification                                                                                                           |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `/`, `/conversations/:id`                  | Conversation directory 651 / 3,025; transcript 624 / 67,234                                        | Last conversation and final transcript paragraph reachable; composer remains within the viewport. No CSS change.       |
| `/work`, all Work detail variants          | `.work-pane-scroll.scroll-region` 794 / 3,131                                                      | Last Work reachable. Explicitly assert `.work-pane .work-list` has `overflowY: visible`. No Work directory CSS change. |
| Work Overview and Artifacts, without a Run | Main 856 / 856                                                                                     | Loaded content/placeholder fits; it is not required to overflow. Artifacts remain the existing unavailable state.      |
| Work Runs, with and without `?run=`        | Main 856 / 4,075                                                                                   | All 50 WorkRuns present and final row reachable.                                                                       |
| Current / historical Definition            | Current main 856 / 2,112; source textarea 428 / 8,828; historical main 856 / 1,604                 | 500-line source loaded, editor scrollTop changes, outer detail reaches its final facts. Historical view is read-only.  |
| Preparation chat / selected WorkRun chat   | History 521 / 76,014 and 575 / 76,014                                                              | Final message reachable; composer stays within the viewport. Preparation uses the no-Run bucket.                       |
| Selected Transcript                        | Main 856 / 67,467 English; 856 / 67,517 Chinese                                                    | Final paragraph reachable.                                                                                             |
| Selected Result / legacy Overview alias    | Result document 419 / 56,169; main 856 / 1,839 English                                             | Nested Result and outer detail both scroll.                                                                            |
| `/observe?work=&run=`                      | Directory 627 / 5,022; Timeline detail 856 / 76,361 (English)                                      | Directory and detail scroll; Map and MCP Activity also reach the trace footer.                                         |
| `/agents`, `/agents/:id`                   | Roster 900 / 6,946; directory 666 / 14,596; profile 900 / 952 (English)                            | Final roster/directory entries reachable; profile actions contained.                                                   |
| `/files`                                   | Scope list 794 / 6,284; file list 684 / 2,648; preview 900 / 74,696; source 900 / 74,905 (English) | Final scope/file and markdown/source trailing actions reachable.                                                       |
| `/tasks/:id`                               | Directory 730 / 11,977; detail 856 / 4,082 (English)                                               | Final Task and comment reachable.                                                                                      |

The audit also explicitly visits bare Work/detail URLs, `?run=` without a tab,
and Transcript/Result without `?run=`; those last two normalize to the existing
Work Overview. It asserts loaded detail content instead of treating a loading
or error shell as successful coverage.

`scroll.browser.test.tsx` writes repeatable geometry to ignored
`.local/browser/scroll-inventory.json` using Vitest's existing file command.
The inventory includes dimensions, scroll offsets, computed overflow, visibility,
and rectangle bounds. Diagnostic logs and screenshots are not committed.

## Verification actually run

Final audit command:

```text
pnpm test:web src/app/router/scroll.browser.test.tsx --browser.screenshotFailures=false

 Test Files  1 passed (1)
      Tests  72 passed (72)
   Start at  23:05:35
   Duration  84.85s (transform 0ms, setup 0ms, import 8.31s, tests 65.95s, environment 0ms)
```

The preceding combined command also exercised the existing Files regression:

```text
pnpm test:web src/app/router/scroll.browser.test.tsx src/features/files/FilesPage.browser.test.tsx --browser.screenshotFailures=false

 Test Files  1 failed | 1 passed (2)
      Tests  2 failed | 71 passed (73)
   Start at  22:59:35
   Duration  243.17s (transform 0ms, setup 0ms, import 75.24s, tests 175.85s, environment 0ms)
```

The Files file passed. The two failures were oversized English Result widths
(1,190 instead of 1,028px). Those defects were fixed, and **all 72 route cases
were rerun green in the final command above**. Earlier focused Files/Agents
runs also passed. No test timeout was increased. The commands set `--browser.screenshotFailures=false` after screenshot
stability itself timed out under host contention.

Final `pnpm web:check:types` exited 0. Verbatim output:

```text
$ pnpm --filter @atomlink-ye/agent-server-web check:types
$ tsc -p tsconfig.app.json --noEmit
```

`pnpm lint` exited 1. Its root and Web type checks completed without type errors;
formatting failed on unchanged files. Verbatim tail:

```text
[warn] Code style issues found in 16 files. Run Prettier with --write to fix.
[ELIFECYCLE] Command failed with exit code 1.
> pnpm typecheck
$ tsc -p tsconfig.json --noEmit && pnpm web:check:types
$ pnpm --filter @atomlink-ye/agent-server-web check:types
$ tsc -p tsconfig.app.json --noEmit
[ELIFECYCLE] Command failed with exit code 1.
```

Those files are `.shoot.mjs`; Agent `authoring.ts` and `AuthoringPanels.tsx`;
`ObservePane.browser.test.tsx`; Run Trace `events.tsx`, `inspector.tsx`, and
`run-trace-view.tsx`; `BoardCardPeek.tsx`; the manager's untracked `BRIEF.md`;
`computer-placement-gap.md`, `work-organization-api.md`,
`0013-task-ordering-in-the-description.md`; `REPORT-workui.md`;
`paseo-turn-runner.test.ts`; `postgres-work-organization-repository.ts`; and
`setup-providers.ts`. None was edited. Lint ran before the final small
role-card/filter assertion refinement; the final Web type check and browser
run include that refinement. Changed files were formatted with Prettier.

## Limits and deliberate non-changes

- No unresolved measured scroll trap remains in these fixtures. Intentional
  ellipses, three-line profile bios, list previews, single-line native inputs,
  and compact timeline labels remain. They are summaries/controls, not broken
  page scroll owners. Closed trace disclosures are distinguished by visibility.
- Wide trace canvases and transcript selector strips retain their existing
  horizontal scrolling; the surrounding page no longer expands with them.
- This is a browser layout audit with mocked reads. No live API, database,
  provider execution, mobile viewport, or full Web suite was verified.
- The two baseline `router.browser.test.tsx` failures were not changed or rerun.
  Unrelated baseline formatting and pre-existing REPORT files were left alone.
- Initial exploratory runs encountered Chromium connection/disconnection and
  screenshot timeouts on the shared host. Early Work fixtures also needed
  source YAML and message-limit corrections; their error-page measurements
  were discarded. Only the valid measurements and completed checks above are
  used as acceptance evidence.
- Test processes finish with their browser servers; no development server or
  temporary infrastructure is handed off. BASELINE.md and BRIEF.md remain
  untracked manager inputs. RESULTS.md is committed because it was explicitly
  requested despite the repository's general rule against one-run reports.

## Round 2 convergence notice

Round 2 stopped at the Deputy’s explicit quota ceiling. Its complete source inventory and unfinished runtime-verification handoff are in [RESULTS-R2.md](RESULTS-R2.md). The latest expanded check is **unverified at convergence**:

```sh
pnpm test:web src/app/router/scroll.browser.test.tsx -t "extended=true|'realistic' 'en'.*/observe|'oversized'.*/boards" --browser.screenshotFailures false
```

It had no completed result when convergence was ordered. The preceding broad diagnostic was 8 failed / 70 passed; the endpoint-probe corrections and added UI states have no completed green rerun. Final types and lint are also unverified at convergence. No complete scroll-system pass is claimed. Round 1 remains frozen; round-2 delivery is on `wui3/lane-a-r2`.
