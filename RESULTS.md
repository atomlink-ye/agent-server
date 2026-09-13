# Lane C — Work page UX

## UX job audit (before product-code changes)

This audit is based on the current routed UI and code before this lane changes it. “Clicks” start on an already-open Work detail page; “scrolls” means a deliberate page/pane scroll, not incidental pointer movement.

| User job                        | Element serving it today                                                                                        | Cost today                                                                                                                                                           | UX finding                                                                                                                                                                                                        |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start work                      | Header `RunTrigger` on a Work with no selected Run; pre-run `Preparation` tab provides context                  | 1 click to start; 0 scrolls at 1440 desktop                                                                                                                          | The primary action is visible, but the page does not frame what will happen next or connect preparation to starting.                                                                                              |
| See whether work is progressing | `History` tab, then each `.work-run-list` row state; a selected Run also has a state pill in `.work-run-header` | 0 clicks for the newest/history state on the default Work view; 1 click from another Work-level tab; 1 click to inspect a Run; potentially 1+ scrolls for older Runs | History is the correct default, but state, latest output, and next action are separated. A user must infer which row is current before opening it.                                                                |
| Find out why it failed          | Failed Run row state → `Activity`; detailed operational trace is another `Observe` link from `Output`           | 2 clicks from Work history to operational trace (`Output`, then `Observe`), or 1 click to the less diagnostic `Activity`; 0–many transcript scrolls                  | Failure diagnosis is split across Activity and Observe. The row offers three equal links and gives no explicit “inspect failure” path.                                                                            |
| Get the output                  | Run row → `Output`, then optional `Open result file`                                                            | 1 click to read captured output; 2 clicks to open the result file; up to 1 internal output scroll                                                                    | Output is correctly Run-scoped, but it is hidden behind a generic row action even for a completed latest Run—the most common post-completion job.                                                                 |
| Resume/retry                    | Work header `RunTrigger` only on the Work-level surface; selected Run has `All runs` then header action         | 0 clicks to act from Work history; 1 click back from a selected Run, then 1 action click; 0 scrolls                                                                  | The action exists but is detached from the Run that motivates it. A failed Run does not present a contextual retry/continue route.                                                                                |
| Hand off                        | No dedicated hand-off control on Work detail; users can use Run `Conversation` or copy/share the addressed URL  | 1 click to Conversation plus message composition, or out-of-product URL sharing; variable scrolls                                                                    | Conversation is the closest collaboration surface, but “hand off” has no explicit affordance or status/context bundle. This lane should clarify the collaboration route without inventing a new backend workflow. |

### IA conclusion before implementation

The baseline is already partly split into Work-level `History`/`Definition` and Run-level `Conversation`/`Output`/`Activity`/`Definition used`, so it is no longer literally one six-tab strip. The remaining problem is task orientation: history rows expose data destinations with equal weight, while the page header communicates identity more strongly than “what needs attention now.” The currently selected Run is identified by breadcrumb ordinal and `?run=`, but the selector is the History list rather than a recognizable persistent selector; once inside a Run, switching to a sibling takes a trip back through `All runs`.

The planned change will preserve `?run=` and `/observe?work=&run=`. It will prioritize the latest/current Run and its state, make the next task explicit (monitor, inspect problem, read output, or continue the conversation), and keep Definition as secondary reference material. No competing Run route or new product state will be introduced.

## Implementation

- Preserved the existing Work → WorkRun scope split and every `?run=` URL.
- Turned the newest history row into a visually distinct latest-Run summary. It names the latest Run, keeps its Product state visible, explains the state in user terms, and promotes one next action: Output when complete, Conversation when the Run needs the user, and Activity for running/problem/uncaptured states.
- Kept all three direct destinations available, with older Runs remaining compact history rather than repeating the summary treatment.
- Reordered selected-Run navigation to `Output → Activity → Conversation → Definition used`, aligning the first three choices with the jobs of retrieving work, diagnosing/monitoring it, and responding. Definition remains available as audit context.
- Added English and zh-CN action copy, browser assertions for state-sensitive routing and geometry, and updated `docs/frontend.md` to record the current IA.
- Did not add a retry/handoff workflow the Product API cannot support, a new status, a new Run route, or a competing trace surface.

## Measurements at 1440px

All values below were taken with `getBoundingClientRect()` in real Chromium at a 1440×900 viewport. The before values were re-measured from the specified `origin/master` base (`dc63a056`) in a detached worktree; the after values were measured from this branch.

| Locale | Element                                  |      Before |  After |
| ------ | ---------------------------------------- | ----------: | -----: |
| en     | Work content width / latest row width    |       964px |  964px |
| en     | Latest row height                        |        78px |  124px |
| en     | Latest guidance max rendered width       | not present |  620px |
| en     | First Work content offset from shell top |      99.5px | 99.5px |
| zh-CN  | Work content width / latest row width    |       964px |  964px |
| zh-CN  | Latest row height                        |        78px |  124px |
| zh-CN  | Latest guidance max rendered width       | not present |  620px |
| zh-CN  | First Work content offset from shell top |      99.5px | 99.5px |

The 46px increase is deliberate information capacity for the state explanation and primary action. Width and initial content position remain unchanged in both locales, so the task summary adds no horizontal overflow and does not push the first content lower.

## Verification

- `CI=true pnpm test:web apps/web/src/features/work/components/work-detail.browser.test.tsx --reporter=verbose` — pass:

  ```text
   Test Files  1 passed (1)
        Tests  26 passed (26)
  ```

- `CI=true pnpm lint` — exit 0; output included `All matched files use Prettier code style!` and both root/Web TypeScript checks completed.
- `CI=true pnpm web:check:types` — exit 0.
- `CI=true pnpm test:web` — completed with these verbatim final lines:

  ```text
   Test Files  4 failed | 68 passed (72)
        Tests  5 failed | 548 passed (553)
  ```

  Three failures are the exact declared master reds (two Conversation router tests and the Files scroll test). The full run also reported an unrelated `/observe` oversized-scroll timeout and `work-feedback.browser.test.tsx > en long card report...` height mismatch. The latter was reproduced unchanged on `origin/master` at `dc63a056` (`expected 133`, `received 124`), so it is not introduced by this lane. The `/observe` timeout is outside the Work detail code changed here; the focused Work detail suite passed all 26 tests. No lane-owned failure remains in the focused surface.

- The timed-out Observe case passed on immediate focused rerun:

  ```text
   Test Files  1 passed (1)
        Tests  2 passed | 106 skipped (108)
  ```

## zh-CN typography and density follow-up

### Audit and decision

At baseline, English and zh-CN inherited exactly the same type scale: 12px metadata, 13px list/body text, 20px pane titles, and 24px display titles. Their line-height ratios were also identical: 1.35 tight, 1.5 UI, and 1.6 body. That preserves mechanical equality but not optical equality: Chinese glyphs fill more of the em square, so the larger roles read heavier and more crowded at the same size.

The fix is centralized in shared `:root:lang(zh-CN) [data-work-surface]` tokens. The explicit surface marker keeps the optical adjustment within the Work page instead of leaking through legacy class names shared by Observe and other pages. It keeps the 12px metadata floor, reduces larger CJK roles by 1–2px (`md 13→12`, `lg 14→13`, `heading 16→15`, `title 20→18`, `display 24→22`), raises body leading from 1.6 to 1.75, and raises tight leading from 1.35 to 1.5. Compact UI leading stays 1.5 so the deliberate 49.5px Work row and 26px tab remain stable. Work metadata timestamps now use the shared `--ink-metadata` role backed by `--ink-500`, matching the value/status tier instead of the faint `--ink-300` previously used.

### Before/after at 1440×900

Measured with CSSOM and `getBoundingClientRect()` in real Chromium:

| Metric                          |            en before |            en after |         zh-CN before |         zh-CN after |
| ------------------------------- | -------------------: | ------------------: | -------------------: | ------------------: |
| Work list title size / line box |        13px / 19.5px |       13px / 19.5px |        13px / 19.5px |         12px / 18px |
| Metadata size / line box        |          12px / 18px |         12px / 18px |          12px / 18px |         12px / 18px |
| Pane title size / line box      |          20px / 30px |         20px / 30px |          20px / 30px |         18px / 27px |
| Landing title size / line box   |          24px / 36px |         24px / 36px |          24px / 36px |         22px / 33px |
| Landing body size / line box    |        13px / 20.8px |       13px / 20.8px |        13px / 20.8px |         12px / 21px |
| Work row height                 |               49.5px |              49.5px |               49.5px |              49.5px |
| Fully visible Work items        |                   14 |                  14 |                   14 |                  14 |
| Work list viewport              |                788px |               788px |                788px |               791px |
| Metadata timestamp color        | `rgb(148, 168, 188)` | `rgb(91, 113, 134)` | `rgb(148, 168, 188)` | `rgb(91, 113, 134)` |

The 3px zh-CN viewport gain comes from the smaller pane heading; it does not alter the deliberately pinned row height or above-fold item count. The 624px Work card and 26px Work tabs are unchanged.

### Follow-up verification

```text
typography.browser.test.tsx
 Test Files  1 passed (1)
      Tests  2 passed (2)

typography.test.ts
 Test Files  1 passed (1)
      Tests  6 passed (6)

work-list.browser.test.tsx
 Test Files  1 passed (1)
      Tests  14 passed (14)

work-detail.browser.test.tsx
 Test Files  1 passed (1)
      Tests  26 passed (26)

work-vocabulary.browser.test.tsx
 Test Files  1 passed (1)
      Tests  1 passed (1)

CI=true pnpm test:web
 Test Files  4 failed | 68 passed (72)
      Tests  5 failed | 549 passed (554)
```

The complete web run retained the three declared baseline failures (two Conversations router tests and the Files scroll test), plus the independently reproduced `en` Work-card pin (`expected 133`, measured `124`). Its fifth failure was the known intermittent 30-second `/observe` concurrency timeout; the targeted rerun result is recorded below.

```text
CI=true pnpm test:web apps/web/src/app/router/scroll.browser.test.tsx -t "keeps 'oversized' 'en' content reachable at 1440 on '/observe"
 Test Files  1 passed (1)
      Tests  2 passed | 106 skipped (108)
```
