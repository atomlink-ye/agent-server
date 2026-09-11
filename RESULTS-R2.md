# Non-Work consistency, round 2

Branch: `wui3/lane-c-r2`, from round-one `c05a2a49`. The frozen `wui3/lane-c` branch is untouched. Git runs as OS user `agent`.

## Result and diagnosis

Equivalent surface roles now use the same root tokens: title height `--surface-title-height` (44px), title inset/content gutter `--space-6` (24px), card padding/collection gap `--space-4` (16px), outer radius `--radius-lg` (12px). This aligns workspace bars and gives comments, board columns, transcript cards and disclosures consistent spacing. No overflow ownership changes were made.

The initial diagnosis corrects one premise: Whispers' 10px radius and Stream's 12px disclosure padding already used root tokens (`--radius-md` and `--space-3`). The inconsistency was choosing different tokens for the same role. The 29px Whispers observer header was content-driven, not a literal CSS height.

The new title-height token lives in lane-owned `features/surface-tokens.css`, derived from existing spacing tokens. The shared workspace-bar rule is scoped to this lane's surfaces. No shared `index.css`, type token, backend code or other lane's production file is edited in this round.

## One measured contract

`apps/web/src/test-support/surface-contract.ts` defines one table of selectors and one expected root token per role. Existing real component fixtures invoke that table; they cannot choose different expected values for different surfaces. Every matching element is read using `getComputedStyle()` and its rectangle recorded with `getBoundingClientRect()` in Chromium at 1440px, in both `en` and `zh-CN`. Title heights and token-probe widths use bounding rectangles directly.

The table also temporarily changes the root tokens to title height 48px, inset/gutter 28px, padding/gap 20px and radius 16px. The same rendered elements must follow those changes. Exact prior inline values and priorities are restored. This rejects hardcoded values that happen to equal today's tokens.

All 22 current captures (11 variants × two locales) pass both default-value and root-binding assertions in the nine-file targeted run. Both locales have identical numeric role values. Values below are pixels; braces list distinct values across all matched elements/sides. An em dash denotes a role the surface does not own.

| Surface | Title height | Title inset | Card padding | Content gutter | Collection gap | Outer radius |
| --- | --- | --- | --- | --- | --- | --- |
| Agents | 44 → 44 | 24 → 24 | 16 → 16 | 24 → 24 | {12,16} → 16 | 12 → 12 |
| Agents roster | 44 → 44 | 24 → 24 | 16 → 16 | 24 → 24 | 16 → 16 | 12 → 12 |
| Files | 44 → 44 | 24 → 24 | 16 → 16 | 24 → 24 | 16 → 16 | 12 → 12 |
| Observe | 44 → 44 | 24 → 24 | 16 → 16 | 24 → 24 | 16 → 16 | 12 → 12 |
| Tasks | 44 → 44 | 24 → 24 | {8,12,16} → 16 | 24 → 24 | {8,16} → 16 | {10,12} → 12 |
| Boards | 44 → 44 | 24 → 24 | {12,16} → 16 | 24 → 24 | {8,16} → 16 | 12 → 12 |
| Whispers | {29,44} → 44 | 24 → 24 | 16 → 16 | 24 → 24 | 12 → 16 | 10 → 12 |
| Trace | 64 → 44 | 16 → 24 | 16 → 16 | 16 → 24 | 0 → 16 | 0 → 12 |
| Sessions | — | — | 16 → 16 | 16 → 24 | 8 → 16 | 8 → 12 |
| Stream | — | — | 12 → 16 | 16 → 24 | 0 → 16 | 8 → 12 |
| Dispatch | — | — | 16 → 16 | — | — | 12 → 12 |

The initial gap reader returned `NaN` for computed `normal`; it was corrected to report the used grid/flex gap of 0 before the final before-captures were saved. This was a measurement defect, not a product defect.

Selected bounding-rectangle evidence (zero-based indices within the recorded role, since captures do not store element IDs): Whispers `titleHeight[1]` height 29 → 44; Tasks `cardPadding[3]` height 61 → 77 at unchanged width 279.3125; Boards `cardPadding[1]` width 264 → 256, x 449 → 453, y 202 → 206; Sessions `cardPadding[0]` x 16 → 24, width 920 → 918; Stream `cardPadding[0]` open height 83 → 91; Trace `contentGutter[0]` width 1118 → 1102 and y 163 → 143. These resulting content dimensions are recorded observations; assertions pin the shared role values, not incidental paragraph or column heights.

## Red-first evidence

Before changing production layout styles, ran:

```text
pnpm test:web AgentsPage.browser.test.tsx FilesPage.visual.browser.test.tsx ObservePage.browser.test.tsx TasksPage.browser.test.tsx BoardsPage.browser.test.tsx WhispersPage.browser.test.tsx run-trace.browser.test.tsx session-transcripts.browser.test.tsx ChatTranscript.browser.test.tsx

 Test Files  4 failed | 5 passed (9)
      Tests  4 failed | 42 passed (46)
   Start at  23:15:20
   Duration  183.19s (transform 0ms, setup 0ms, import 131.66s, tests 100.64s, environment 0ms)
```

These were new contract failures in Agents, Whispers, Trace and Sessions/Stream. After expanding the selectors to Task comments and Board columns/card collections:

```text
pnpm test:web TasksPage.browser.test.tsx BoardsPage.browser.test.tsx

 Test Files  2 failed (2)
      Tests  2 failed | 23 passed (25)
   Start at  23:19:49
   Duration  126.49s (transform 0ms, setup 0ms, import 94.79s, tests 77.73s, environment 0ms)
```

The same nine-file command after convergence and root-binding assertions:

```text
 Test Files  9 passed (9)
      Tests  46 passed (46)
   Start at  23:27:55
   Duration  284.11s (transform 0ms, setup 0ms, import 234.52s, tests 146.65s, environment 0ms)
```

The failures above were numeric assertions, not test timeouts. Some failure screenshot captures timed out under contention. Single-file selection reproduced the numeric mismatches before fixes:

| File | Clean base fa344fcc | Concurrent nine-file red run | Single-file red rerun |
| --- | --- | --- | --- |
| WhispersPage.browser.test.tsx | New contract absent; no individual duration recorded | Numeric role mismatch; batch 183.19s | Same numeric mismatch; 84.03s, 1 failed / 2 passed |
| session-transcripts.browser.test.tsx | New contract absent; no individual duration recorded | Numeric role mismatch; batch 183.19s | Same numeric mismatch; 71.22s, 1 failed / 1 passed |
| run-trace.browser.test.tsx | New contract absent; no individual duration recorded | Numeric role mismatch; batch 183.19s | Same numeric mismatch; 86.36s, 1 failed |

These are single-file commands, not a guarantee of an idle host: sibling lanes remained active, and the Whispers rerun overlapped this lane's two-file collection run. No clean-base timing or dedicated-CPU isolation is claimed. The manager's clean-base full suite had only the three documented baseline failures; the new assertions did not exist there.

## Verification still in progress

`pnpm web:check:types` exited 0:

```text
$ pnpm --filter @atomlink-ye/agent-server-web check:types
$ tsc -p tsconfig.app.json --noEmit
```

The one round-two full `pnpm test:web` run and `pnpm lint` are currently running. Their outcomes will be recorded before handoff.

## Applicability and limits

Sessions and Stream are embedded sections; Dispatch is an inline conversation card. They do not own page title bars. Dispatch also does not own its host's page gutter or collection layout. These are explicitly inapplicable, not fictitious equalities. Stream's composite card checks its upper outside corners on the summary container and lower outside corners on the disclosure; the internal joined edge remains square.

The matrix covers structural cards, gutters and collections in the rendered fixtures, not every possible application state. Main pages render in real AppShell fixtures; Trace, Sessions/Stream and Dispatch render their real embedded components. Tests import application CSS but do not load the HTML Google Fonts link, so measurements use the configured fallback font stack. No external font-loading or production backend verification is claimed.

Icon/text gaps, controls, status pills and natural section-heading heights have different roles and are deliberately not flattened into card spacing/radii. Thus a literal requirement that every CSS gap/radius or every unrendered state have one value is not fulfilled. No listed surface was skipped, but the table's applicability limits matter.

Raw logs and captures remain ignored under `.local/visual-system-r2/` and `.local/surface-contract/`; this requested report records evidence summaries only. No generated captures are committed. No PR is opened.
