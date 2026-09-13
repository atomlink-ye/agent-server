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

Pending.

## Measurements at 1440px

Pending in English and zh-CN.

## Verification

Pending.
