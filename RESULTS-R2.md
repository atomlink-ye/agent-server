# Typography round 2

Branch: `wui3/ia-b-r2`, based on round-one `d80697de`. The frozen `wui3/ia-b` branch was not pushed again. No PR, merge, rebase, backend change, dependency, or framework change.

## Diagnosis and change

Round one's literal conversion had already reached every authored stylesheet. The remaining defect was inherited browser heading sizes in the shared Markdown renderer: Work report H5/H6 rendered at 9.96/8.04px. Added a renderer-owned stylesheet using the existing six heading/body size steps and UI leading, imported by the renderer. This covers report, transcript, and chat Markdown without changing their page layouts or another lane's stylesheet. The title layout was measured separately and left unchanged.

## Real Chromium measurements at 1440 × 900

Both `en` and `zh-CN` produced the following values. Every cell is font size / element `getBoundingClientRect().height` in px. The new browser test pins every after size, line height, and element height. These are real renderer components inside their production surface wrappers, not full report/chat routes. Font readiness was awaited; Vitest uses the installed fallback stack, not the remote Google font link from index.html.

| Heading | Work report before | Transcript prose before |     Chat before | After, all three |
| ------- | -----------------: | ----------------------: | --------------: | ---------------: |
| H1      |       24 / 32.3906 |            28 / 46.1875 |    32 / 51.1875 |          24 / 36 |
| H2      |       18 / 28.7969 |            21 / 34.6406 |    24 / 38.3906 |          20 / 30 |
| H3      |    14.04 / 22.4688 |         16.38 / 27.0156 | 18.72 / 29.9375 |          16 / 24 |
| H4      |       12 / 19.1875 |            14 / 23.0938 |    16 / 25.5938 |          14 / 21 |
| H5      |     9.96 / 15.9219 |         11.62 / 19.1719 |   13.28 / 21.25 |        13 / 19.5 |
| H6      |      8.04 / 12.875 |          9.38 / 15.4688 | 10.72 / 17.1406 |          12 / 18 |

Larger chat/transcript headings become shorter; small report headings become taller so they meet the floor. This is a consistent hierarchy, not a claim that every surface becomes denser. No new overall row-density gain is claimed.

## Long Chinese titles

Mounted the real AppRouter at `/work/:id`, including the Work directory pane and detail page, using a 180-character Chinese title with commas and parentheses. The fixture has no Runs and an unavailable current Definition; header action text therefore differs by locale. These widths describe that explicit state, not all possible action combinations.

| Element             | Locale |    Width before → after | Height before → after | Font / line advance | Lines |
| ------------------- | ------ | ----------------------: | --------------------: | ------------------: | ----: |
| Directory title     | both   |               236 → 236 |           19.5 → 19.5 |           13 / 19.5 |     1 |
| Detail header title | en     |   207.15625 → 207.15625 |               27 → 27 |             20 / 27 |     1 |
| Detail header title | zh-CN  | 314.734375 → 314.734375 |               27 → 27 |             20 / 27 |     1 |

Per-character DOM Range measurements place row glyphs at y=1…18 inside 19.5px and header glyphs at y=1…26 inside 27px. Both intentionally stay on one line, with native ellipsis; text scroll widths are 2340px and 3528px. Thus the measurements contradicted a vertical-clipping hypothesis; no title CSS was changed. Widths, heights, font sizes, single-line behavior, and glyph containment are asserted.

Paint verification also passed: a browser screenshot of each native ellipsis exactly equals the screenshot after replacing the text with a complete-character prefix plus “…” (17 characters for the row; 9/en and 15/zh-CN for the header). This is a dynamic bitmap equality assertion, with no committed golden images. It proves no partial glyph is painted in these measured cases; DOM Range alone would not prove that. No wrapping or ellipsis change was warranted.

## Complete machine census

The audit inventories all tracked and unignored new files under `apps/web`, including files outside `src`, HTML, SVG, inline React styles, configuration, and fixtures. Installed dependencies and ignored generated output are not authored application code and are excluded explicitly. Before counting, it asserts the known-true `src/index.css` symbol `font-size: var(--text-title)` and tests synthetic CSS, HTML/SVG, React numeric, quoted property, clamp, and shorthand violations. It then checks every file without truncating the inventory or matches. CSS additionally requires tokenized sizes (or inherit), including multiline font shorthands, and tokenized leading.

Initial census: 201 authored files, 326 CSS font-size declarations, 0 raw font-size declarations (captured in the initial complete tool output; not saved as a separate JSON artifact). Final census: 203 authored files (91 TSX, 86 TS, 17 CSS, 6 JSON, 2 Markdown, 1 HTML), 332 CSS font-size declarations, **0 raw declarations**. Both counts are complete machine totals, with no truncated matches used as evidence. Token definitions intentionally contain px values; they are not font-size declarations. No universal claim is made about third-party node_modules or generated browser output.

## Red first, then green

Before the stylesheet change:

```text
pnpm test:web apps/web/src/typography-content.browser.test.tsx
AssertionError: expected [ 24, 18, 14.04, 12, 9.96, 8.04 ] to deeply equal [ 24, 20, 16, 14, 13, 12 ]
 Test Files  1 failed (1)
      Tests  2 failed | 2 passed (4)
   Start at  23:14:47
   Duration  78.62s (transform 0ms, setup 0ms, import 30.37s, tests 9.92s, environment 0ms)
```

After explicit Markdown tokens and size/height assertions:

```text
pnpm test:web apps/web/src/typography.test.ts apps/web/src/typography-content.browser.test.tsx
 Test Files  2 passed (2)
      Tests  9 passed (9)
   Start at  23:18:18
   Duration  57.65s (transform 1.71s, setup 0ms, import 18.53s, tests 7.88s, environment 0ms)
```

Further completed browser verification:

```text
pnpm test:web apps/web/src/typography.test.ts apps/web/src/typography.browser.test.tsx apps/web/src/typography-content.browser.test.tsx apps/web/src/features/conversations/components/ChatTranscript.browser.test.tsx apps/web/src/features/work/components/work-detail.browser.test.tsx apps/web/src/features/work/components/panes/work-chat-pane.browser.test.tsx apps/web/src/features/run-trace/session-transcripts.browser.test.tsx
 Test Files  7 passed (7)
      Tests  35 passed (35)
   Start at  23:24:45
   Duration  208.79s (transform 1.58s, setup 0ms, import 137.58s, tests 119.17s, environment 0ms)
```

After correcting the typed recording fixture and extending the source detector's quoted-property control:

```text
pnpm test:web apps/web/src/typography.test.ts apps/web/src/typography-content.browser.test.tsx
 Test Files  2 passed (2)
      Tests  9 passed (9)
   Start at  23:29:51
   Duration  149.96s (transform 1.73s, setup 0ms, import 54.10s, tests 47.23s, environment 0ms)
```

The full web suite was not rerun in round two. The three manager-listed baseline failures (two router Conversations cases and Files scrolling) were outside this scoped consumer run. No suspect browser timeout occurred, so no new regression is being inferred from concurrent timing.

| Check                             | Clean base                                                                     | Concurrent lanes                    | Isolated file                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| New Markdown size probe           | Not present at fa344fcc; failed against unchanged round-one CSS before the fix | Final focused run: 9 passed         | Initial content file: 2 expected size failures / 2 title passes; after fix, all 4 passed (118.68s) |
| Existing consumers and typography | Not rerun on clean base in R2                                                  | 7 files / 35 tests passed (208.79s) | No timeout rerun required                                                                          |

Standalone `pnpm web:check:types` initially exited 2 with a real new test error:

```text
src/typography-content.browser.test.tsx(85,57): error TS2339: Property 'work' does not exist on type '{ actors: { id: string; name: string; source_refs: { root_task_id: string; team_member_run_id: string; team_run_id: string; }; }[]; edges: ({ assignee_actor_id: string; attempt_id: string; guarantee: string; ... 7 more ...; sequence?: undefined; } | { ...; } | { ...; })[]; ... 52 more ...; work_run_id?: undefined; }...'.
Exit status 2
[ELIFECYCLE] Command failed with exit code 2.
```

The recording contains multiple document shapes; the fixture now uses `ProductRunTraceSuccessSchema.parse(...)` before reading Work. This fixes the type boundary without a cast. Corrected standalone `pnpm web:check:types` completed with process exit **0**:

```text
$ pnpm --filter @atomlink-ye/agent-server-web check:types
$ tsc -p tsconfig.app.json --noEmit
```

`pnpm lint` completed its formatting phase with exit 1: 15 existing files need formatting, and all 15 are byte-identical to `fa344fcc` (independent explorer comparison). No changed file appears in that list. These baseline files were deliberately left alone. The clean-base lint command was not rerun in R2; the comparison is of the warning files' bytes.

`pnpm lint` finished with process exit **1**. Its repository compiler progressed to the nested web compiler; no compiler diagnostics were emitted. The independent standalone web typecheck exit 0 is recorded above. Final verbatim lint tail:

```text
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

No browser or typography correctness regression remains observed in the scoped checks. Formatting debt is baseline, outside this lane, and remains for repository maintenance. All implementation changes are confined to the shared Markdown renderer, typography verification, and frontend documentation. `BASELINE.md` remains an untracked manager-provided input.

The complete browser consumer run, final focused run, and standalone web typecheck returned exit 0. The intentional pre-fix Markdown probe and initial fixture type error returned nonzero as reported above. No full-suite, clean-base lint, or remote-font verification is claimed. Raw JSON, screenshots, and logs remain ignored under `.local/typography-r2/`; this requested report is the only new committed evidence document.
