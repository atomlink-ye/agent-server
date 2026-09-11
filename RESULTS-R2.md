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
The first green browser run passed all 25 tests. Header + tabs are now 62px for
Work and 54px for WorkRun. Exact first-pane and first-text assertions pass in both
locales (the same fixtures and viewport as the red run).

| View                 | Header + tabs, before → after | First pane, before → after | First text, before → after |
| -------------------- | ----------------------------- | -------------------------- | -------------------------- |
| Work history         | 78 → 62px                     | 102 → 78px                 | 123.5 → 99.5px             |
| WorkRun output       | 70 → 54px                     | 95 → 71px                  | 116 → 92px                 |
| WorkRun conversation | 70 → 54px                     | 103 → 71px                 | 103 → 71px                 |
| WorkRun Definition   | 70 → 54px                     | 95 → 71px                  | 95 → 71px                  |

All offsets are relative to the Work detail shell, not the window. First text is
respectively the first history identity, output kicker inside the padded card,
conversation heading, or Definition scope heading. The AppShell title bar is not
included or changed. The pane boundary is not substituted for visible content.

Red output, verbatim assertion excerpts:

```text
AssertionError: expected 78 to be 62 // Object.is equality
AssertionError: expected 102 to be 78 // Object.is equality
```

Green output for the same command after the spacing change:

```text
 Test Files  1 passed (1)
      Tests  25 passed (25)
   Start at  23:17:00
   Duration  106.51s (transform 0ms, setup 0ms, import 36.59s, tests 34.58s, environment 0ms)
```

### Pane corrections

The UI now calls the captured-session pane Output and the snippet “Latest captured
assistant message”. Its source note warns that this may be worker progress. A
completed WorkRun still links to its result file. The former “Updating” promise is
replaced by a snapshot caveat and a direction to Activity: this output read is not
polled while the WorkRun runs.

Conversation is labeled as a WorkRun conversation that cannot change execution,
with the responding role named Assistant. This preserves the service's actual
constraint; a writable composer does not imply execution steering. Preparation's
started callback navigates through the owning page into the selected WorkRun and
preserves conversation origin. The legacy Files tab says Files unavailable.

Only the two locale dictionaries are shared-file edits: ten new scoped keys and
eleven corrected values in each. No global CSS, backend, contracts, dependencies,
or other lane components were changed.

### Remaining scope blocker

`apps/web/src/features/work/components/definition-panel.tsx` is outside the explicit
lane file set. Its inner viewer still says “Historical Run version” and describes
all read-only versions as historical, even when a selected WorkRun used today's
current version. Its current-version editor also calls WorkRun start actions Run
and contains hardcoded English. The owning lane/integration manager must correct
these labels. The wrapper selects the right exact version and names its scope,
but that does not make the inner copy correct. No claim of an entirely clean pane
audit is made.

In progress. Logs stay under ignored `.local/work-detail-r2/`. No green result is
claimed until the corresponding command completes.

The first semantic verification run had one real assertion failure: the existing
Output-empty test still expected “The result summary is still unavailable.” The
new pane correctly says “Captured assistant text is unavailable.” The assertion
was updated to the new data claim, not weakened. Geometry and the new preparation
navigation scenario passed in that run (25 passed, 1 failed). This was not a timeout.
