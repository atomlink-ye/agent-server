# WORKUI — Transcript readability and log terminology

## Delivered

- Kept the existing `activity_id` coalescing and assistant-snapshot merge. The
  projector now retains each merged activity's first and last capture time.
- Made the visible title data-first: meaningful `summary`, then a command
  present in `label`, then a non-generic label, then the actual `category`.
  Provider fallbacks such as `Other activity` and `Read activity` can no longer
  become the primary description.
- Added a structured status/time treatment. A merged activity shows its final
  captured status, its measured elapsed time, and its capture time. A lone
  event shows only its capture time: the UI deliberately does not invent a
  `0 ms` duration where the provider did not record a start/end pair.
- Improved the reading layout: action/title and result/time occupy stable
  columns, long commands wrap, and status remains scannable without crowding
  the title. The 966px reader column is retained.
- Work Transcript Chinese now reads `日志` / `执行日志`; session content uses
  `会话日志`. `conversations.*` was not changed.

## Evidence

### Real data

Against `agent_server_demo`, WorkRun
`448560a5-fefd-40a8-961c-15ae55729278` resolves through root Task
`13a11eec-1ad0-4ee0-ab1e-563af095f6cd` to technical Run
`8a2da7da-7647-44ee-8c66-88380dfc4485`.

```sql
SELECT type, count(*)
FROM run_events
WHERE run_id = '8a2da7da-7647-44ee-8c66-88380dfc4485'
GROUP BY type ORDER BY type;
```

Output: `output | 95`, `started | 1`, `succeeded | 1`.

The first output payloads demonstrate the defect: activity 1 has running and
completed events, `category = other`, `summary = Other activity.`, and a later
label of `Other activity: pwd && ls -la`; activity 2 has `category = read`
and `label/summary = Read activity`. The after view renders the first as
`pwd && ls -la`, the latter as `Read`, and combines the activity-1 events into
one `Completed · 730 ms` row.

### Browser screenshots at 1440px

Both images use the real running API and the same 97-entry WorkRun. The after
view is served from this worktree on temporary port 4173, with the existing
API still on 3000 and the existing demo Web still on 3001; no existing service
was restarted. The temporary server was stopped after capture.

| View   | Screenshot                            | Observed result                                                                                                                                  |
| ------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Before | `.local/workui-transcript-before.png` | Generic `Other activity` / `Read activity` titles repeat and the row lacks elapsed time.                                                         |
| After  | `.local/workui-transcript-after.png`  | Commands or exact categories are readable, completed status and real elapsed time are visible, and the reader column has no overlap or clipping. |

I visually inspected the after image: the 1440px shell, 966px reading column,
row metadata, wrapping, and tab/layout alignment are intact.

## Adjacent-surface audit

- `run-trace/events.tsx` renders recorded collaboration MCP calls, not this
  provider activity stream; it has no generic activity-title path.
- The Work overview reads the same projected transcript, so it keeps the
  coalescing correction without a duplicate implementation.
- Observe renders aggregate attempt/run metrics rather than activity rows.
- Not changed: several SessionTranscript sentences remain direct English
  strings. Converting that complete surface to i18n is a larger localization
  migration than the requested Work Chinese terminology and needs broader
  locale coverage.

## Verification

- Passed: `node_modules/.bin/vitest run --config vitest.web.config.ts apps/web/src/features/run-trace/transcript-projection.test.ts apps/web/src/features/run-trace/transcript-presentation.test.ts apps/web/src/features/run-trace/session-transcripts.browser.test.tsx` — 13 tests.
- Passed: `node_modules/.bin/tsc --noEmit -p apps/web/tsconfig.app.json`.
- Passed: `git diff --check`.
- Passed: `transcript-stream.css` brace count, `42` opening / `42` closing.

`pnpm exec` itself was not used for the focused test because its dependency
status guard tried to reinstall the worktree's linked dependencies in a
non-interactive shell. The direct project binary uses the existing linked
dependency tree and ran the named tests successfully.
