# Work page information architecture — round 2

The user comes here to check execution progress, find output, inspect current activity,
ask about an execution, prepare a new execution, and compare execution history with
the exact Definition each used. The Work record should answer history/progress in
one glance and offer each execution's output, conversation, and activity in one click.
The selected WorkRun should identify its scope immediately. Actual execution steering
is not provided by its separate conversation service; the UI must say so.

## Investigation before implementation

Round 1 split scope but preserved 78px Work / 70px WorkRun header-and-tab budgets.
The current CSS stacks 12px shell inset, 8px header bottom padding plus a border,
8px tab top padding, 8px link bottom padding, and 12px pane margins (20px for chat).
Hypothesis: remove the redundant header separator and padding, halve tab padding,
and use 8px shell/pane spacing without shrinking text or the start action. Browser
assertions are being run red-first before changing this CSS.

| Pane               | Actual data and job                                                                                                   | Audit                                                                                                                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WorkRuns           | This Work's execution history, each row's own state and execution links                                               | Correct Work-level scope; progress/history one glance, output/activity/conversation one click.                                                                                                                       |
| Current Definition | Work's currently pinned version, editor and version apply/start actions                                               | Correct data; embedded editor contains hardcoded English and calls WorkRun actions “Run”. Shared `definition-panel.tsx` is outside this lane's allowed files.                                                        |
| Preparation        | Work's null WorkRun chat bucket, candidate input and confirmation                                                     | Correct until confirmation: child switches bucket without updating the Work shell. Must navigate to the started WorkRun.                                                                                             |
| Conversation       | Selected WorkRun's separate chat bucket; writes messages, but runtime prompt limits it to supplied state/conversation | “Run’s Lead” is misleading. It is not the live lead execution session. Keep the inability to change execution explicit.                                                                                              |
| Result             | Latest assistant segment across all selected WorkRun sessions; completed execution's result-file link                 | “Result” overstates the transcript snippet. Rename to Output and explicitly identify the snippet as latest captured assistant text, not an attributed lead result.                                                   |
| Activity           | Selected WorkRun trace plus session transcripts grouped by agents/attempts                                            | Correct WorkRun scope containing technical Run activity. No new competing Observe surface.                                                                                                                           |
| Definition used    | Exact selected WorkRun version, read-only                                                                             | Wrapper correct. Embedded viewer calls a version “Historical Run version” or “Current Work version”, and calls all read-only versions historical. Shared-file blocker, not evidence that every inner label is fixed. |
| Legacy Files link  | Unavailable capability notice, no files                                                                               | Label must say Files unavailable and direct users to a WorkRun's Output.                                                                                                                                             |

No `Run.lead` field is used or introduced. Output remains unattributed captured text;
selecting the last assistant message does not establish lead ownership.

## Verification

Red-first command: `pnpm test:web apps/web/src/features/work/components/work-detail.browser.test.tsx`.
The eight geometry cases failed on the unchanged round-1 layout; the other 17 tests passed.
Verbatim tail:

```text
 Test Files  1 failed (1)
      Tests  8 failed | 17 passed (25)
   Start at  23:14:15
   Duration  92.59s (transform 0ms, setup 0ms, import 21.11s, tests 52.05s, environment 0ms)

[ELIFECYCLE] Command failed with exit code 1.
```

Actual browser measurements were identical in English and Chinese:

| View                 | Header | Tabs | Header + tabs | Shell inset | Pane gap | First pane top from shell | First text top from shell |
| -------------------- | -----: | ---: | ------------: | ----------: | -------: | ------------------------: | ------------------------: |
| Work history         |     44 |   34 |            78 |          12 |       12 |                       102 |                     123.5 |
| WorkRun output       |     36 |   34 |            70 |          13 |       12 |                        95 |                       116 |
| WorkRun conversation |     36 |   34 |            70 |          13 |       20 |                       103 |                       103 |
| WorkRun Definition   |     36 |   34 |            70 |          13 |       12 |                        95 |                        95 |

The Work first-text hypothesis was corrected: it is 123.5px, not the estimated
119px, because the row aligns its two-line identity vertically. The intended
reduction comes from shell/navigation/pane spacing, not shrinking history rows.
After-values remain pending the real browser run.

In progress. Logs stay under ignored `.local/work-detail-r2/`. No green result is
claimed until the corresponding command completes.
