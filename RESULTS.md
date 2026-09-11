# Non-Work visual system

All nine requested CSS files now use the shell palette, spacing, radii, elevation and type-size tokens. A single root monospace token replaces the independent code stacks. Work organization no longer relies on undefined legacy palette variables and fallback colours. No type token was redefined.

The visible layout fixes align the desktop title bars and content gutters, give representative cards consistent padding, remove duplicate sidebar insets, and stop the Task status selector from squeezing its heading. Content headers remain content-driven where their information needs more space. This is a consistency pass, not a claim that every surface became denser.

## Real Chromium measurements

Viewport: **1440 × 900**. Both `en` and `zh-CN` were measured. Each paired capture measured the same mounted production components first with the nine original stylesheets and root CSS from `fa344fcc`, then with the changed CSS, using `getBoundingClientRect()` and `getComputedStyle()`. This controls fixture/content variation. The final tests contain only permanent assertions and need no local capture files.

Page fixtures mount the real AppShell. Files uses a separate AppShell fixture because the baseline route test stops at sign-in; that original failing test is unchanged. The Whispers fixture was corrected to include the real shell rail instead of placing its sidebar into the rail's grid column. Trace and dispatch are embedded component fixtures at the 1440 viewport; session/stream content is mounted at its existing 966px fixture width. These are browser component checks with mocked API data, not a live authenticated application canary.

The browser fixtures import production CSS but do not load the Google Fonts links from `index.html`. Measurements therefore cover the production fallback font stack. External font loading and resulting font-dependent heights were not verified. Padding and fixed header contracts are asserted independently of content height.

All table values are **before → after, in px**. Padding follows CSS shorthand order. “Row” means the first representative fixture row; it is not a global fixed-height rule. English and Chinese values match except Observe's sidebar row, listed separately.

| Surface / stylesheet                      | Header height                        | Card / disclosure padding | Row height                      | Horizontal content gutter / grid gap           |
| ----------------------------------------- | ------------------------------------ | ------------------------- | ------------------------------- | ---------------------------------------------- |
| Agents profile (`agents.css`)             | shell 44 → 44; profile 90.5 → 90.5   | 14 16 → 16                | coworker 57 → 57                | 24 → 24; grid 24 → 16                          |
| Agents roster (same CSS)                  | shell 44 → 44; roster 59 → 59        | 16 20 20 → 16             | card grid, no separate list row | 24 → 24                                        |
| Files (`files.css`)                       | shell 44 → 44; content 107.875 → 64  | 14 16 → 16                | file 51 → 53                    | 24 → 24; grid 14 → 16                          |
| Observe (`observe.css`)                   | shell 44 → 44; detail 84.609375 → 64 | 12 16 → 16                | EN 92 → 90; ZH 78 → 76          | detail 0 → 24; grid 12 → 16                    |
| Tasks (`work-organization.css`)           | shell 44 → 44; detail 182 → 81       | 20 → 16                   | 90.1875 → 90.1875               | 28 → 24; grid 18 → 16                          |
| Boards (same CSS)                         | shell 44 → 44; toolbar 107.875 → 64  | 11 → 16                   | sidebar 68 → 70                 | 28 → 24; canvas gap 14 → 16                    |
| Whispers (`whispers.css`)                 | shell 44 → 44; observer 17 → 29      | 8 12 → 16                 | channel 61 → 57                 | message log 16 → 24                            |
| Trace (`run-trace.css`, rework recording) | embedded header 56 → 64              | canvas 14 14 28 → 16      | 85 → 105                        | canvas 14 → 16                                 |
| Sessions (`execution-transcript.css`)     | embedded heading 76 → 76             | summary 12 → 16           | session tab 66.84375 → 68.84375 | detail 36 → 16                                 |
| Stream (`transcript-stream.css`)          | shares session heading 76 → 76       | disclosure 10 13 → 12     | 46.4375 → 51.890625             | row summary 10 → 12; containing detail 36 → 16 |
| Dispatch (`dispatch-card.css`)            | inline event 24 → 24; no page header | 13 15 → 16                | status 17 → 17                  | card 15 → 16; details top margin 10 → 12       |

The permanent assertions live in `apps/web/src/test-support/surface-metrics.ts` and are called by the corresponding browser fixtures. They pin measured heights per locale and compare card padding, gutters, grid gaps and radii to root tokens. The two trace recordings have different natural row heights; the parallel fixture is separately pinned at 59px and the rework fixture at 105px.

Additional measured/aligned contracts:

- Agents and Files shell-bar top: 20 → 0; the bar's left edge was inset 24px from its main panel and is now aligned to it. Their content retains a 24px horizontal gutter. The final test compares actual main/bar rectangles.
- All measured page title bars have 22 → 24 horizontal padding, asserted against `--space-6`. Observe/Tasks/Boards received that final adjustment after the paired capture and it is verified by the final browser assertions.
- Observe filter height: 102 → 76 in both locales; its extra horizontal margins are 20 → 0. Work organization and Whispers list rows now start at the sidebar's own padding, checked by rectangle equality.
- Representative card radii: Tasks 16 → 12, Boards 11 → 12, Agents/Files/Observe/dispatch 12 → 12, Whispers messages 10 → 10. The inline message radius remains `--radius-md`.
- Stream row-summary padding: 6 10 → 8 12. Session tabs align vertically; the detail gutter and summary padding use `--space-4`.

No density claim is made for unmeasured authoring, menu, hover or drag-state permutations. They received token substitutions and existing behavior tests, not an exhaustive visual review.

## Drift inventory

Counts are declarations, not unique values. A declaration is counted once (shadow, colour, radius, spacing, then type). Spacing includes literal nonzero px/vw padding, margin and gaps; type includes literal sizes, stacks, weights, line heights and tracking. Zero resets, dimensions, borders, animation timing and already-tokenized declarations are excluded. This avoids treating diagram geometry as ordinary spacing except the explicit axis margin noted below.

| Stylesheet                                   | Spacing | Type | Radius | Colour | Shadow | Total before → after |
| -------------------------------------------- | ------: | ---: | -----: | -----: | -----: | -------------------: |
| `agents/agents.css`                          |      78 |   63 |     22 |      2 |      1 |             166 → 33 |
| `run-trace/run-trace.css`                    |      79 |   76 |     14 |      2 |      2 |             173 → 28 |
| `run-trace/execution-transcript.css`         |      43 |   41 |      7 |      0 |      0 |              91 → 15 |
| `run-trace/transcript-stream.css`            |      19 |   22 |      3 |      0 |      0 |              44 → 10 |
| `observe/observe.css`                        |       1 |    4 |      0 |      0 |      0 |                5 → 4 |
| `files/files.css`                            |      15 |   18 |      3 |      1 |      0 |               37 → 6 |
| `whispers/whispers.css`                      |       9 |    2 |      2 |      3 |      0 |               16 → 0 |
| `conversations/components/dispatch-card.css` |       5 |    3 |      0 |      0 |      0 |                8 → 3 |
| `work-organization/work-organization.css`    |      84 |   32 |     22 |     67 |      3 |              208 → 8 |

Total: **748 → 107** raw declarations. Remaining: 101 weights/line heights/tracking, three circular `50%` radii, one 286px diagram axis margin, two semantic trace selection/status shadows. All inventoried raw colours, font sizes and font stacks were replaced.

The remaining type values have no root tokens; the type scale belongs to ia-b and is unchanged here. The 286px margin equals the trace’s 116px + 170px structural columns. The two retained shadows encode a selected outline and a live underline rather than elevation. Circular geometry remains circular. Two-pixel microspacing and one-pixel seams derive from `--space-1` using `calc()`. No surface-local value warrants changing the existing global type scale.

The shared-file edit is only `--font-mono` in `apps/web/src/index.css`. It retains JetBrains Mono and the common system code fallbacks; nine computed-font assertions cover Agents source, Files, trace identifiers and both transcript implementations.

### Locations of the original drift

The following groups enumerate the original declarations by property and value, with selector families locating them. Exact replacements are in the CSS diff.

#### `agents/agents.css`

`.agents-*`: roster, profile, skill/source editor, grants, hierarchy, modal and list selectors

- Spacing (78): `gap`: `10px`, `12px`, `14px`, `16px`, `18px`, `20px`, `24px`, `2px`, `3px`, `4px`, `5px`, `6px`, `7px`, `8px`, `9px`; `padding`: `10px`, `10px 0`, `10px 12px`, `10px 18px`, `12px`, `14px 16px`, `18px`, `20px 24px`, `20px 28px 32px`, `2px 10px`, `2px 8px`, `3px 7px`, `5px 9px`, `6px 10px`, `8px 10px`, `8px 12px`, `9px 10px`, `9px 12px`; `padding-bottom`: `16px`; `margin`: `-4px 0 0`, `4px 0 0`, `8px 0 0`; `padding-top`: `14px`, `16px`, `8px`; `padding-left`: `11px`, `16px`, `17px`; `margin-left`: `6px`; `margin-top`: `2px`; `margin-bottom`: `10px`.
- Type (63): `font-weight`: `400`, `600`, `650`, `700`; `font-size`: `0.85em`, `11px`, `12px`, `13px`, `14px`; `line-height`: `1.25`, `1.45`, `1.5`, `1.55`; `letter-spacing`: `-0.02em`, `-0.04em`, `0.04em`; `font-family`: `ui-monospace, SFMono-Regular, Menlo, monospace`; `font`: `12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace`.
- Radius (22): `border-radius`: `10px`, `12px`, `8px`, `999px`, `9px`.
- Colour (2): `background`: `linear-gradient(135deg, #16b4f4, var(--skype-deep))`, `rgb(255 255 255 / 40%)`.
- Shadow (1): `box-shadow`: `0 8px 18px -12px rgb(0 120 200 / 72%)`.

#### `run-trace/run-trace.css`

`.run-trace*`: header, timing axis, item rows, events, inspector, tools and statuses

- Spacing (79): `margin-top`: `10px`, `24px`; `padding`: `0 0 12px`, `0 0 8px`, `0 18px 10px`, `0 3px 8px`, `0 6px`, `10px 11px`, `10px 18px`, `10px 4px`, `11px 0 4px`, `11px 4px`, `12px 18px`, `12px 8px 12px 12px`, `13px 8px`, `14px`, `14px 14px 28px`, `14px 4px 0`, `18px 16px`, `22px`, `2px 0 11px`, `2px 4px`, `2px 4px 12px`, `2px 6px`, `2px 8px`, `3px 6px`, `4px 0`, `4px 10px`, `4px 6px`, `4px 7px`, `5px 10px`, `6px 14px`, `7px 0`, `7px 18px`, `8px`, `8px 0`, `9px`, `9px 0 3px`, `9px 18px`, `9px 4px`; `margin`: `0 0 12px`, `0 0 2px`, `0 0 7px`, `0 0 8px`, `0 auto 2px`, `3px 0 0`, `4px 0 0`, `6px 0`, `8px 0 0`, `9px 6px`; `gap`: `10px`, `18px 24px`, `2px`, `3px`, `4px`, `5px`, `6px`, `8px`, `9px`; `margin-bottom`: `20px`; `margin-left`: `16px`, `286px`; `padding-left`: `8px`.
- Type (76): `font-size`: `10px`, `11px`, `12px`, `13px`, `15px`, `9px`; `font-weight`: `450`, `500`, `650`; `letter-spacing`: `-0.01em`, `-0.02em`, `0.01em`; `font-family`: `ui-monospace, monospace`; `line-height`: `1.35`, `1.45`.
- Radius (14): `border-radius`: `0 0 8px 8px`, `2px`, `3px`, `4px`, `50%`, `5px`, `6px`, `7px`, `8px 8px 0 0`, `999px`.
- Colour (2): `background-image`: `linear-gradient( 90deg, rgb(197 210 222 / 35%) 1px, transparent 1px )`; `background`: `rgb(110 197 106 / 35%)`.
- Shadow (2): `box-shadow`: `0 0 0 1px var(--trace-blue)`, `inset 0 -2px 0 var(--grass-deep)`.

#### `run-trace/execution-transcript.css`

`.execution-transcript__*`: heading, attempts, summary, detail, event, payload and tool rows

- Spacing (43): `margin-top`: `16px`, `2px`, `30px`, `5px`, `8px`; `padding-top`: `26px`, `8px`; `gap`: `10px`, `16px`, `18px`, `22px`, `3px`, `4px`, `5px`, `6px`, `8px`; `margin`: `0 0 8px`, `12px 0`, `18px 0 0`, `2px 0`, `2px 0 0`, `7px 0`, `8px 0 0`, `9px 0 0`; `padding`: `10px 11px`, `12px`, `13px 14px`, `20px clamp(18px, 3vw, 36px) 32px`, `24px`, `4px 8px`, `8px 10px`, `9px`, `9px 12px`; `padding-bottom`: `12px`; `padding-inline`: `8px`; `margin-bottom`: `4px`.
- Type (41): `font-weight`: `600`, `650`; `letter-spacing`: `-0.02em`, `0.04em`; `font-size`: `10px`, `11px`, `12px`, `13px`, `9px`; `line-height`: `1.35`, `1.45`, `1.5`, `1.6`; `font-family`: `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`.
- Radius (7): `border-radius`: `5px`, `6px`, `8px`, `999px`.

#### `run-trace/transcript-stream.css`

`.transcript__*`: row, summary, disclosure, tool, prose and count selectors

- Spacing (19): `gap`: `2px 10px`, `6px`, `8px`; `margin`: `0 -10px`, `0 -1px -1px`; `padding`: `10px 0`, `10px 13px`, `12px 0 12px 14px`, `4px 0 0`, `6px 10px`, `8px 0`; `margin-top`: `8px`; `padding-top`: `5px`; `margin-bottom`: `5px`.
- Type (22): `font-size`: `10px`, `11px`, `12px`, `14px`, `15px`, `9px`; `line-height`: `1`, `1.45`, `1.65`; `font-weight`: `600`, `650`, `700`; `letter-spacing`: `0.04em`, `0.06em`.
- Radius (3): `border-radius`: `0 0 8px 8px`, `50%`, `8px`.

#### `observe/observe.css`

`.observe-agent-chip`, `.observe-metric-card-value`, `.observe-section-title`, `.observe-summary-status-count`

- Spacing (1): `padding`: `2px var(--space-2)`.
- Type (4): `letter-spacing`: `-0.02em`, `0.06em`; `font-weight`: `800`.

#### `files/files.css`

`.files-*`: main/pane, scope/file lists, tabs, header/grid, viewer, code and notices

- Spacing (15): `gap`: `10px`, `12px`, `14px`, `2px`, `6px`, `8px`; `padding`: `10px 12px`, `14px 16px`, `16px`, `20px 24px`, `2px 9px`, `7px 10px`.
- Type (18): `font-size`: `11px`, `12px`, `13px`, `14px`; `font-weight`: `600`, `700`; `line-height`: `1.45`, `1.55`, `1.65`; `font-family`: `'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace`.
- Radius (3): `border-radius`: `10px`, `12px`, `999px`.
- Colour (1): `background`: `#fff8f6`.

#### `whispers/whispers.css`

`.whispers-list`, `.whisper-observer-badge`, `.whisper-message-log`, `.whisper-message`

- Spacing (9): `gap`: `10px`, `2px`, `4px`, `6px`; `padding`: `10px 12px`, `16px`, `8px`, `8px 12px`; `margin-bottom`: `2px`.
- Type (2): `font-size`: `12px`.
- Radius (2): `border-radius`: `10px`, `8px`.
- Colour (3): `background`: `var(--surface-active, rgba(0, 0, 0, 0.06))`, `var(--surface-raised, rgba(0, 0, 0, 0.04))`; `color`: `var(--ink-300, #6b7280)`.

#### `conversations/components/dispatch-card.css`

`.dispatch-card`, `.dispatch-card__event`, `__reason`, `__status`, `__details`

- Spacing (5): `padding`: `13px 15px`; `margin-top`: `10px`, `7px`, `8px`; `padding-top`: `8px`.
- Type (3): `line-height`: `1.5`; `font-weight`: `600`, `700`.

#### `work-organization/work-organization.css`

`.work-org-*`, `.work-board-*`: sidebar, content, forms, status pills, board columns/cards, drag states, menus and inspector

- Spacing (84): `gap`: `10px`, `12px`, `14px`, `16px`, `18px`, `4px`, `5px`, `6px`, `7px`, `8px`, `9px`; `padding`: `0 10px 18px`, `0 14px 12px`, `10px`, `10px 12px`, `11px`, `12px`, `13px`, `16px`, `1px 7px`, `1px 8px`, `20px`, `28px`, `3px 7px`, `3px 8px`, `4px`, `4px 6px`, `5px 9px`, `6px 10px`, `6px 7px`, `7px 8px`, `8px`, `8px 9px`, `9px 10px`; `margin`: `-1px 0`, `0 0 16px`, `0 0 8px`, `10px 0`, `2px 0`, `4px 0 0`, `4px 0 10px`, `6px 0 14px`; `margin-bottom`: `10px`, `16px`, `4px`, `8px`; `padding-bottom`: `12px`; `margin-top`: `6px`, `9px`; `padding-top`: `9px`.
- Type (32): `font-size`: `11px`, `12px`, `13px`, `14px`, `15px`, `9px`; `line-height`: `1.2`; `font-weight`: `600`, `700`, `800`; `letter-spacing`: `0.03em`.
- Radius (22): `border-radius`: `10px`, `11px`, `12px`, `14px`, `16px`, `5px`, `8px`, `999px`, `9px`.
- Colour (67): `background`: `#e6f7ed`, `#e8f1ff`, `#eef2f6`, `#fff`, `#fff3d6`, `#fff4f3`, `linear-gradient(145deg, #fffdf8, var(--gold-soft))`, `rgba(102, 112, 133, 0.12)`, `rgba(126, 87, 194, 0.14)`, `rgba(255, 255, 255, 0.72)`, `rgba(31, 111, 235, 0.06)`, `rgba(31, 111, 235, 0.08)`, `rgba(31, 111, 235, 0.1)`, `rgba(31, 111, 235, 0.12)`, `rgba(31, 111, 235, 0.16)`, `var(--accent, #1f6feb)`, `var(--panel, #fff)`, `var(--panel-subtle, #f7f8fa)`; `color`: `#245a9c`, `#276749`, `#6a3fb5`, `#8a5a00`, `#8e2722`, `#a12824`, `#fff`, `var(--accent, #1f6feb)`, `var(--muted, #667085)`; `border`: `1px solid #f2b8b5`, `1px solid var(--line, #d8dee8)`; `border-color`: `#e5a39f`, `rgba(31, 111, 235, 0.18)`, `rgba(31, 111, 235, 0.2)`, `rgba(31, 111, 235, 0.35)`; `outline`: `1px dashed rgba(31, 111, 235, 0.45)`, `2px dashed rgba(31, 111, 235, 0.45)`, `2px solid rgba(31, 111, 235, 0.35)`, `2px solid rgba(31, 111, 235, 0.45)`; `border-top`: `1px solid var(--line, #d8dee8)`.
- Shadow (3): `box-shadow`: `0 12px 28px rgba(16, 24, 40, 0.1)`, `0 12px 28px rgba(16, 24, 40, 0.14)`, `0 1px 2px rgba(16, 24, 40, 0.04)`.

## Verification

Every affected surface passed its final assertions across the targeted runs below (47 distinct tests in 10 files). The first final eight-file run exposed an incorrect shared trace-row expectation and a missed Boards title-bar selector. Both failures reproduced in single-file runs; both were corrected and the two files then passed together. No timeout was increased.

`pnpm test:web ObservePage.browser.test.tsx monospace.browser.test.tsx`:

```text
 Test Files  2 passed (2)
      Tests  2 passed (2)
   Start at  22:47:58
   Duration  33.78s (transform 0ms, setup 0ms, import 18.16s, tests 7.74s, environment 0ms)
```

`pnpm test:web AgentsPage.browser.test.tsx FilesPage.visual.browser.test.tsx TasksPage.browser.test.tsx BoardsPage.browser.test.tsx WhispersPage.browser.test.tsx run-trace.browser.test.tsx session-transcripts.browser.test.tsx ChatTranscript.browser.test.tsx` (initial final assertion run, before the two corrections):

```text
 Test Files  2 failed | 6 passed (8)
      Tests  2 failed | 43 passed (45)
   Start at  22:48:34
   Duration  75.07s (transform 0ms, setup 0ms, import 59.60s, tests 41.46s, environment 0ms)

[ELIFECYCLE] Command failed with exit code 1.
```

`pnpm test:web BoardsPage.browser.test.tsx run-trace.browser.test.tsx` (after both corrections):

```text
 Test Files  2 passed (2)
      Tests  16 passed (16)
   Start at  22:52:53
   Duration  70.90s (transform 0ms, setup 0ms, import 39.72s, tests 18.46s, environment 0ms)
```

`pnpm web:check:types` completed with exit 0:

```text
$ pnpm --filter @atomlink-ye/agent-server-web check:types
$ tsc -p tsconfig.app.json --noEmit
```

`pnpm lint` exited 1 because of the 16 formatting warnings described below. Its root and Web type-check stages completed without type errors. Verbatim tail:

```text
$ prettier --check .
Checking formatting...
[warn] .shoot.mjs
[warn] apps/web/src/features/agents/authoring.ts
[warn] apps/web/src/features/agents/AuthoringPanels.tsx
[warn] apps/web/src/features/observe/ObservePane.browser.test.tsx
[warn] apps/web/src/features/run-trace/events.tsx
[warn] apps/web/src/features/run-trace/inspector.tsx
[warn] apps/web/src/features/run-trace/run-trace-view.tsx
[warn] apps/web/src/features/work-organization/BoardCardPeek.tsx
[warn] BRIEF.md
[warn] docs/architecture/computer-placement-gap.md
[warn] docs/contracts/work-organization-api.md
[warn] docs/decisions/0013-task-ordering-in-the-description.md
[warn] REPORT-workui.md
[warn] src/adapters/paseo/paseo-turn-runner.test.ts
[warn] src/infrastructure/postgres/postgres-work-organization-repository.ts
[warn] tooling/dev/setup-providers.ts
[warn] Code style issues found in 16 files. Run Prettier with --write to fix.
[ELIFECYCLE] Command failed with exit code 1.
> pnpm typecheck
$ tsc -p tsconfig.json --noEmit && pnpm web:check:types
$ pnpm --filter @atomlink-ye/agent-server-web check:types
$ tsc -p tsconfig.app.json --noEmit
[ELIFECYCLE] Command failed with exit code 1.
```

`pnpm test:web` ran once at the end. **53 files / 302 tests passed; two files / three tests failed, exactly the supplied baseline reds. No additional failure remained.** Verbatim tail:

```text
 Test Files  2 failed | 53 passed (55)
      Tests  3 failed | 302 passed (305)
   Start at  22:55:19
   Duration  385.69s (transform 105.36s, setup 0ms, import 516.50s, tests 275.90s, environment 112ms)

[ELIFECYCLE] Command failed with exit code 1.
```

The three red tests are:

1. `router.browser.test.tsx > gives a first-time principal an onboarding empty state at /conversations`
2. `router.browser.test.tsx > serves the conversations list at /conversations instead of a route miss`
3. `FilesPage.browser.test.tsx > scrolls the real Files list to its final file on desktop`

All affected surface assertions passed in that full run. The suite is **not green** because those baseline failures remain. Tests emitted React `act(...)` warnings; no timeout or browser-connection error occurred in the final full run.

## Boundaries and remaining risks

- All nine requested CSS files were covered; none was skipped. Coverage is representative desktop geometry, not every state of each surface. No mobile target, additional breakpoint, live API canary or external font-loading verification was attempted.
- The supplied baseline failures in the two conversations router tests and the original Files scroll test are unchanged. This lane does not change authentication, routing, empty-state semantics or Files scroll ownership.
- Existing scroll assertions remain. No `overflow` was reintroduced to a Work list and no scroller ownership was changed.
- Lint formatting findings outside this diff were left untouched. Fifteen flagged tracked files are byte-identical to `fa344fcc`; the sixteenth is the supplied untracked `BRIEF.md`.
- Existing status colour meanings and trace selection/live affordances remain; the shapes and semantic outline/underline shadows are deliberate exceptions. No claim is made about hover/drag/authoring state pixel geometry.
- Earlier capture runs suffered browser connection failures and load-related timeouts. Two exploratory capture batches were intentionally interrupted to switch measurement strategy. They are not reported as passing. Temporary serialization settings were restored; `vitest.web.config.ts` has no diff.
- Capture JSON, CSS snapshots and screenshots remain ignored under `.local/`; the final browser assertions have no dependency on those files. No development server was started. Final test and lint processes have exited.
- This report is committed because the campaign explicitly requires `RESULTS.md`; raw runtime evidence is not committed. Only the monospace token touches shared `index.css`. There are no API, domain, dependency or translation-string changes, and no Human Gate is introduced.
- Commits are pushed to `wui3/lane-c`. No pull request, merge or rebase was performed.
