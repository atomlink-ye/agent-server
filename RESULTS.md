# Work / Run information architecture results

Branch: `workui2/ia-b`. Base: `239fa8ab`. Scope includes both manager addenda.
This report is committed at the manager's explicit request and is intended to
be removed before the integration PR. No PR is opened by this lane.

## Implemented

- The directory lists Work titles, **Active / Archived** record state from
  `archived_at`, and actual Run counts. It no longer presents the selected or
  latest Run's execution state or timestamp as the Work's own state/subtitle.
- Work has a compact single-line header with Start Run and its own **Summary /
  Runs / Definition / Files** navigation. Summary renders the Work's current
  Definition, dates, and Run count. It does not reuse the Run Overview renderer.
- The existing `/work/:workId?run=:runId` selection opens a separate bordered
  Run surface: Work breadcrumb, `RUN #N`, execution state, and **Conversation /
  Trace / Result** navigation. No new route, page competing with Observe,
  framework, state library, or dependency was introduced.
- The existing Overview result, journey, trace, and executor cards live in the
  Run Result view. Historical Definition links retain the exact pinned version
  and a Run header; the Work's Definition link opens the current version.
- Runs are newest-first rows with chronological ordinals, timestamps, projected
  execution states, and Open links into each Run's Conversation. The empty
  index offers Start Run. The Work header can start another Run even when a
  previous Run is complete; existing RunTrigger state-specific behavior remains
  available to its other callers.
- Preparation chat is available only before any Run exists. An existing Run
  never renders the old Work-scoped chat pane as its conversation.
- Removed the directory catalog's still-present Coworker binding menu and
  binding/roster presentation. The brief's assertion that this menu was already
  gone did not match HEAD. Definition creation remains directly available.
- Preserved `.work-pane-scroll` as the directory/catalog scroller, with the list
  itself remaining expanded and the heading stationary.
- Work record reads no longer require a child Run projection to be available.
  English and Simplified Chinese labels are included.

## Red then green evidence

### Initial test-first run

Before changing the detail implementation or layout, ran the prescribed command:

```sh
pnpm test:web -- apps/web/src/features/work/components/work-detail.browser.test.tsx apps/web/src/features/work/components/work-list.browser.test.tsx
```

Observed command correction: the extra `--` reaches Vitest and the command
actually runs **all 51 files**, including unrelated Boards/Conversations tests.
Subsequent focused invocations use `pnpm test:web <paths>` without that separator.
The full final verification uses the exact `pnpm test:web` command.

Initial RED output excerpts:

```text
Work-only navigation:
AssertionError: expected [ 'Overview', 'Work Chat', …(4) ] to deeply equal [ 'Overview', 'Runs', …(2) ]
Run-only navigation:
AssertionError: expected [ 'Overview', 'Work Chat', …(4) ] to deeply equal [ 'Conversation', 'Trace', 'Result' ]
Run ordinals:
AssertionError: expected [ 'Latest Run', 'Historical Run' ] to deeply equal [ 'Run #2', 'Run #1' ]
Empty Runs action:
AssertionError: expected undefined to be 'Start Run'
Directory record state/count presentation:
AssertionError: expected 'WWork 1RunningRun Aug 16, 10:00 AM' to contain 'Active'
Binding-control removal:
AssertionError: expected <details …(1)>…(2)</details> to be null
Compactness:
Runs first content row y-offset: 375.390625px (Chromium 1440x900)
AssertionError: expected 375.390625 to be less than or equal to 160

Test Files  5 failed | 46 passed (51)
     Tests  13 failed | 282 passed (295)
```

That run included the two known router failures, the known Files failure, and
an additional **Conversations desktop-scroll timeout** under shared-host load.
The timeout is not classified as one of the manager's pre-existing failures.
The new Work summary tab was subsequently named **Summary** to distinguish it
from the existing Run Overview renderer.

### Final assertions against unchanged HEAD

After implementation, temporarily saved the owned implementation files under
ignored `.local/`, restored those files from `239fa8ab`, and ran the final detail
assertions. This is a supplementary baseline comparison, not a claim that these
later assertions were all written before implementation:

```sh
pnpm test:web apps/web/src/features/work/components/work-detail.browser.test.tsx
```

```text
Test Files  1 failed (1)
     Tests  9 failed | 3 passed (12)
Runs first content row y-offset: 375.390625px (Chromium 1440x900)
```

The new unavailable-child test exposed a missing Router in the old happy-path
render helper. Added a MemoryRouter and repeated that single case on HEAD:

```sh
pnpm test:web apps/web/src/features/work/components/work-detail.browser.test.tsx -t 'can read a Work record'
```

```text
FAIL can read a Work record even when a child Run projection is unavailable
AssertionError: expected null not to be null
Test Files  1 failed (1)
     Tests  1 failed | 11 skipped (12)
```

All implementation files were restored afterward; no baseline restoration is
part of the committed diff.

### GREEN

```sh
pnpm test:web apps/web/src/features/work/components/work-detail.browser.test.tsx apps/web/src/features/work/components/work-list.browser.test.tsx apps/web/src/features/work/components/run-trigger.browser.test.tsx
```

```text
Test Files  3 passed (3)
     Tests  26 passed (26)
```

This covers both tab levels, record/count presentation, binding-control absence,
Run ordinals and links, the empty index action, directory scrolling, historical
Definitions, preparation composer scrolling, and all **six** RunTrigger tests.

After restoring the implementation and correcting the test render helper:

```sh
pnpm test:web apps/web/src/features/work/components/work-detail.browser.test.tsx --silent=false
```

```text
Test Files  1 passed (1)
     Tests  12 passed (12)
```

An intermediate full run was stopped after the source changed and shared-host
load produced additional screenshot/test timeouts. It is not presented as a
completed green run. Its logs remain in ignored `.local/`.

## Browser measurement

Same Chromium viewport (**1440 × 900**), fixture, Runs tab, and selector before
and after. The metric is the top of `.work-run-list > li:first-child` relative
to the rendered WorkDetailPage host's top, measured with
`getBoundingClientRect()`. This is a real browser component measurement, not an
estimated screenshot coordinate or a full-shell viewport claim.

| Measurement             |        Before |  After |     Reduction |
| ----------------------- | ------------: | -----: | ------------: |
| First Runs row y-offset | 375.390625 px | 103 px | 272.390625 px |

The repeatable assertion requires the row to start within 160 px. Vitest's
agent reporter suppresses successful console output even with `--silent=false`;
used its default reporter for the numeric evidence:

```sh
pnpm test:web apps/web/src/features/work/components/work-detail.browser.test.tsx -t 'places the first Runs content row' --reporter=default
```

```text
Runs first content row y-offset: 103px (Chromium 1440x900)
Test Files  1 passed (1)
     Tests  1 passed | 11 skipped (12)
```

## Deliberately updated existing assertions

- The directory's five execution-state fixtures now all assert the Work's
  Active record state, an actual count, and absence of Run summary/timestamp.
- Catalog binding-menu styling, keyboard opening, and mutation expectations
  were replaced by absence checks because that control was removed. Description
  wrapping, direct Definition creation, and generic/preselected creation paths
  remain covered.
- The Work-detail result assertions moved to a dedicated selected-Run Result
  test, including result-unavailable copy, journey, trace, and excluded execution
  coverage. Work Summary instead asserts record-only content.
- The existing composer scroll test uses a zero-Run preparation fixture; it no
  longer claims that Work-scoped chat is a selected Run conversation.
- Historical Definition tests keep exact-version reads and now assert Run
  context rather than a mixed navigation strip. Missing-current-Definition
  coverage still asserts a disabled Start Run and its explanation.
- Both directory scroll tests remain, including the final Work/catalog rows and
  fixed heading. WorkCard, new-work, and the six run-trigger test cases were not
  removed or rewritten. Protected chat-pane tests were not edited.

## Boundary and absence checks

No changes under `src/**`, `apps/web/src/features/work/clients/**`, or either
protected `panes/work-chat-pane` file. Verified using `git diff --name-only`
restricted to those paths; output was empty. `git diff --check` passed.

```sh
rg -n 'bindCoworker|bindAgent|work-coworker|initiator|expose' apps/web/src/features/work/WorkPane.tsx apps/web/src/features/work/components/new-work.tsx apps/web/src/features/work/components/work-header.tsx apps/web/src/features/work/components/work-tabs.tsx apps/web/src/features/work/components/panes/runs-pane.tsx
```

No matches (rg exit 1). This is an absence check of the affected UI surfaces;
it does not claim that the protected client APIs were deleted.

## INTEGRATION REQUESTS

The other lane/manager must replace the section marked
`data-run-conversation={runId}` in `WorkDetailPage.tsx` with the Run-scoped
conversation pane, using `detail.work.id` and the selected `runId`. This lane
intentionally supplies the Conversation navigation and slot without rendering
the old Work-only chat API as a Run conversation. Keep WorkChatPane only for
preparation before any Run exists. Run startup/status copy belongs to the
protected chat-pane lane and was not changed here.

## Remaining limitations

The current Work-list contract has no Run count and Run summaries have no
execution state. Exact counts and ordinal identities therefore read every page
of each Work's existing Runs endpoint; row states use existing Run detail reads.
This adds per-Work/per-Run requests and should eventually be replaced by a
bounded aggregate projection when backend/client scope is authorized. Failed
count reads remain explicitly unavailable instead of becoming zero. Run row
states are read when the index loads; opening the Run uses the existing live
Run-detail refresh behavior.

Formal Artifacts remain the existing bounded Files placeholder. This change
makes no new claim of Artifact support or completion of Run chat integration.

## Final verification

The final restored implementation was checked with the required full command:

```sh
pnpm test:web
```

```text
Test Files  3 failed | 48 passed (51)
     Tests  4 failed | 293 passed (297)
Duration  260.95s
```

The only failures are the four explicitly listed in the brief:

1. Router: serves the conversations list at `/conversations` instead of a route miss.
2. Router: gives a first-time principal an onboarding empty state at `/conversations`.
3. Files: scrolls the real Files list to its final file on desktop.
4. Protected Work Chat pane: auto-scrolls on arrival only while the reader is near the bottom.

There are **no additional failures** in this final run. In particular, the
intermediate Conversations/catalog/new-work timeouts did not recur.

Other commands actually run:

| Command                               | Result                                                                                                                              |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm web:check:types`                | Final run passed, exit 0; actual command was `tsc -p tsconfig.app.json --noEmit`.                                                   |
| `pnpm web:check:architecture`         | Passed: `single Vite frontend guard passed`.                                                                                        |
| `pnpm check:architecture-replacement` | Passed: `4 current violations, 4 baseline entries`; `architecture-replacement: ok`.                                                 |
| `pnpm docs:check`                     | Passed; 2 files / 5 tests passed.                                                                                                   |
| `pnpm lint`                           | Failed, exit 1, on repository-wide formatting. The run reported 29 files; changed implementation files were subsequently formatted. |
| `git diff --check`                    | Passed.                                                                                                                             |

Lint also reported untouched files including Agents authoring, Observe tests,
Run Trace components, BoardCardPeek, architecture/contract/decision docs,
`src/adapters/paseo/paseo-turn-runner.test.ts`,
`src/infrastructure/postgres/postgres-work-organization-repository.ts`, and
`tooling/dev/setup-providers.ts`, plus existing/supplied root inputs
`.shoot.mjs`, `BRIEF.md`, and `REPORT-workui.md`. These files are outside this
lane's intended diff; the two `src/**` files are explicitly protected. They were
not reformatted to manufacture a green repository-wide lint result. The first
Web type run caught a missing response-shape guard in the new Run state read;
that was fixed and the final dedicated Web type check passed.

No Docker, PostgreSQL, provider runtime, `pnpm verify`, or `pnpm test` was started.
Vitest runs exited or were explicitly stopped; no development server was left
running. Logs, baseline-comparison backups, and generated browser output remain
ignored local evidence, not committed source.

The final targeted Prettier check passed for all 19 changed/new files.
