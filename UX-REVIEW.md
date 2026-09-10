# Work UX review

Reviewed from `175b63b5` on `workui/lane-d-ux-review` at 1440×900 in real Chromium. This is a component/browser-harness review with fixture-backed API responses, not a live-provider acceptance run. The current brief explicitly requests this report; screenshots and raw logs remain local generated artifacts.

## Findings, ranked by user impact

1. **FIXED — The main create flow required a Coworker.** Heading `+`, landing-page Create Work, and the empty directory action opened a Coworker → Capability form. With no Coworkers, it instructed the user to create one even when a published Definition existed. Catalog cards already bypassed this. All generic create actions now offer published Definitions, with an explicit initial choice; selecting one loads its description, title, and typed inputs. Existing profile links resolve their Definition version directly, without treating their `agent` query parameter as an owner or initiator. Empty and failed catalog reads have distinct messages and recovery.
2. **FIXED — Recovery could create a duplicate Work.** After creating the record and failing to start its Run, the primary Start Work action was still enabled. It is now disabled once a record exists, with a matching handler guard. Open the created Work and Retry Run remain available. The browser test submits a required boolean, observes one Work-create request, retries, and observes two Run requests against that same Work. This is an in-form guard, not a claim of cross-tab/server idempotency.
3. **FIXED — Overview had no return tab.** A Work opened on the result-first Overview, but its navigation listed only Work Chat, Runs, Execution record, Files, and Definition. Added Overview to the existing navigation and translated the touched tab labels and navigation label. The selected Overview now has `aria-current="page"`.
4. **NOT FIXED (already acceptable) — Existing Work versus reusable Definitions.** The rendered directory has a distinct Work catalog divider and “Reusable Definitions” heading, and catalog cards have a Create Work action; existing rows show state and time. More headings would add density without fixing a demonstrated confusion.
5. **NOT FIXED (already acceptable) — Coworker visibility on catalog cards.** The text explicitly says who can see and operate the Definition; visibility controls are secondary, and an unshared Definition remains launchable. Those are visibility facts, not Work ownership.
6. **NOT FIXED (already acceptable after the navigation fix) — Work detail information density.** The title, latest/historical Run context, state explanation, result area, and key steps answer what this is and what happened. Run history and execution details are separately available. The fixture's missing result is honestly shown as unavailable.
7. **NOT FIXED (lower impact) — Work Chat's “everyone is User” wording is awkward.** Empty-state guidance, Lead/User/System labels, the “Message the Work lead” composer, and the separate execution record make its purpose discernible. I did not change conversation semantics or repeat the previous lane's layout work.
8. **NOT FIXED (intentional separate path) — Task promotion creates a Work record before execution.** The Task's formal-execution card selects a published Definition and creates a linked Work; Task assignment remains a separate control. It does not add a Work owner.
9. **NOT FIXED (advanced-only scope) — Raw Definition authoring is not novice-friendly.** It is explicitly collapsed under Advanced. Replacing the authoring experience is substantially broader than repairing the normal start flow; its UI copy was translated where this file was touched.
10. **NOT FIXED (honest product limitation) — Files does not expose a formal Artifact collection.** Its existing explanation points to completed Run results. I did not invent artifacts or extend backend contracts.

## Start-a-Work walkthrough

### Heading `+`

Before: New Work → “Choose a Coworker and one of its saved Capabilities” → Coworker → Capability → title → typed inputs → Start Work. The old implementation also preselected the first available Coworker/Capability. A novice cannot reasonably answer which Coworker owns an independently defined Work. With an empty roster, the form stopped at “Create a Coworker before starting Work.” The first regression reproduced that state while supplying a published catalog Definition.

After: `+` → choose a Definition by its name → read its description and executor explanation → accept/edit Work Title → answer Definition-specific inputs → Start Work. No Coworker choice exists. I rendered both the full WorkPage entry and a required-boolean form. Submitting the unanswered boolean focuses it and creates nothing; choosing No submits `false`, creates the record, and sends the first Run request in sequence. A fixture deliberately rejects that Run so the recovery state can be inspected and retried without browser navigation leaving Vitest.

### Catalog cards

Before: Create Work on either a visible-to-Coworkers or unshared Definition → preselected Definition summary → title → required inputs → Start Work. This path was already aligned with the product principle, which made its disagreement with `+` especially conspicuous.

After: the same Definition-first flow, sharing the corrected start/recovery implementation. I inspected both cards, their actual destination URLs, and the visibility menu; then rendered the actual unshared-card destination in WorkPage. It has no initiator or Coworker selector. The fixture has no required inputs, so the title and Start Work are sufficient. A separate catalog-definition test observes the real create-client and start-client requests.

### Recent-Work landing, empty landing, and empty directory

Each Create Work/New Work action calls WorkPage's same create callback. I exercised each of these three buttons in Chromium, not merely inferred them from the shared callback. Each reaches the Definition picker, including the honest no-published-Definitions state, without a Coworker selector.

### Coworker profile Capability link

The profile's Start action constructs `/work?new=1&agent=…&capability=…`. Previously NewWork checked that Coworker's roster/profile and could reject the link because that Coworker was missing. The route now consumes the Definition version in `capability`; the Agent query parameter is not passed into the form. The destination is exercised through NewWork with that version: Definition summary → title → inputs → create → Run request. A missing version is shown as unavailable and is not silently replaced. I inspected the profile link construction in code; I did not claim a separate full-profile screenshot.

### Task promotion

Rendered the existing Task test: title is already present in the Task editor; the formal-execution card asks for a published Definition by display name, then Create Work. The promotion request carries canonical Definition/version IDs. The resulting linked Work is opened separately and its Run can then be started. The neighboring Assignee field edits the Task; it is not a Work initiator selection. This path is unchanged and its browser test passes.

### Advanced authoring

Expand Advanced → provide Work Title and raw Definition YAML/JSON → Apply Definition & create Work. The existing browser test exercises validate → plan → apply → create. This path creates the record and targets its Definition page, rather than immediately executing a Run. It is useful to an author who knows the schema, not an appropriate replacement for the novice Definition picker.

### Work Chat and subsequent Runs

Work Chat is the Work's shared conversation with its Definition Lead, separate from the execution transcript and from a long-lived Coworker conversation. The component also displays preparation inputs, missing/ambiguous fields, and an explicit Confirm and start action when preparation is ready. I reviewed that logic and rendered empty, short, and long conversations. I did not exercise a live Lead reply or the preparation-confirmation backend. An existing Work also exposes Start Run; that executes the existing record and is not another Work-creation path.

## Files changed

- `apps/web/src/features/work/components/new-work.tsx`: replaced the Coworker/profile selection branches with catalog/version selection; retained typed-input and create/start clients; guarded record creation after success; extracted touched form/validation/authoring strings.
- `apps/web/src/features/work/WorkPage.tsx`: stopped consuming/passing the Agent query parameter into Work creation.
- `apps/web/src/features/work/components/work-presentation.ts` and `work-tabs.tsx`: added Overview and rendered translated navigation labels.
- `apps/web/src/features/work/clients/errors.ts`, `apps/web/src/i18n/en.ts`, and `zh-CN.ts`: localized the touched form, validation, tab, and bounded Run-failure copy in both languages.
- Work browser tests: regressions for Definition entry, record-preserving recovery, Overview navigation, catalog load states, and each landing/empty entry; screenshots use the requested artifact directory.
- `apps/web/src/features/work-organization/TasksPage.browser.test.tsx`: one screenshot added to the existing promotion test; no Task behavior changed.

## Screenshots

All paths below are under `apps/web/__screenshots__/ux-review/` and are local, ignored artifacts, not committed images. The early `*-before.png` captures are minimally styled component diagnostics; use the full-page directory/entry images for layout judgment.

- `apps/web/__screenshots__/ux-review/catalog-entry.png`
- `apps/web/__screenshots__/ux-review/catalog-start-before.png`
- `apps/web/__screenshots__/ux-review/catalog-start.png`
- `apps/web/__screenshots__/ux-review/empty-catalog-zh.png`
- `apps/web/__screenshots__/ux-review/empty-state.png`
- `apps/web/__screenshots__/ux-review/generic-inputs.png`
- `apps/web/__screenshots__/ux-review/generic-start-before.png`
- `apps/web/__screenshots__/ux-review/generic-start.png`
- `apps/web/__screenshots__/ux-review/heading-plus.png`
- `apps/web/__screenshots__/ux-review/long-conversation.png`
- `apps/web/__screenshots__/ux-review/run-start-failure.png`
- `apps/web/__screenshots__/ux-review/short-conversation.png`
- `apps/web/__screenshots__/ux-review/task-promotion.png`
- `apps/web/__screenshots__/ux-review/work-chat-composer-bottom-desktop.png`
- `apps/web/__screenshots__/ux-review/work-detail-transcript-scroll-desktop.png`
- `apps/web/__screenshots__/ux-review/work-directory.png`
- `apps/web/__screenshots__/ux-review/work-overview.png`

## Verification

The following blocks contain actual captured command output, with terminal color escape codes removed. They are not reconstructed expected output. Successful type checking prints no test count.

### Definition entry: red

```text
$ pnpm vitest run --config vitest.web.canonical.config.ts apps/web/src/features/work/components/new-work.browser.test.tsx
RUN  v4.1.10 /home/agent/wui/lane-d/apps/web

6:04:45 AM [vite] (client) [optimizer] scanning dependencies...
6:04:47 AM [vite] (client) [optimizer] bundling dependencies...
 ❯ |chromium| src/features/work/components/new-work.browser.test.tsx (4 tests | 1 failed) 2045ms
   × offers Definitions at the generic start entry without requiring a Coworker 765ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |chromium| src/features/work/components/new-work.browser.test.tsx > offers Definitions at the generic start entry without requiring a Coworker
AssertionError: expected <select id="work-coworker">…(1)</select> to be null

Failure screenshot:
  - apps/web/src/features/work/components/__screenshots__/new-work.browser.test.tsx/offers-Definitions-at-the-generic-start-entry-without-requiring-a-Coworker-2.png

- Expected:
null

+ Received:
<select
  id="work-coworker"
>
  <option
    value=""
  >
    Choose a Coworker…
  </option>
</select>

 ❯ src/features/work/components/new-work.browser.test.tsx:329:49
    327|     await settle();
    328|     await page.screenshot({ path: '../../../../__screenshots__/ux-revi…
    329|     expect(host.querySelector('#work-coworker')).toBeNull();
       |                                                 ^
    330|     expect(host.querySelector('#work-definition-choice')).not.toBeNull…
    331|     expect(host.textContent).toContain('Competitor Research');

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 3 passed (4)
   Start at  06:04:44
   Duration  12.58s (transform 0ms, setup 0ms, import 1.96s, tests 2.04s, environment 0ms)
```

### Record recovery: red

```text
$ pnpm vitest run --config vitest.web.canonical.config.ts apps/web/src/features/work/components/new-work.browser.test.tsx -t 'blocks an unselected'
RUN  v4.1.10 /home/agent/wui/lane-d/apps/web

 ❯ |chromium| src/features/work/components/new-work.browser.test.tsx (4 tests | 1 failed | 3 skipped) 1425ms
   × blocks an unselected required boolean, then starts Run in the same turn after Work creation 1419ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |chromium| src/features/work/components/new-work.browser.test.tsx > blocks an unselected required boolean, then starts Run in the same turn after Work creation
AssertionError: expected false to be true // Object.is equality

Failure screenshot:
  - apps/web/src/features/work/components/__screenshots__/new-work.browser.test.tsx/blocks-an-unselected-required-boolean--then-starts-Run-in-the-same-turn-after-Work-creation-2.png

- Expected
+ Received

- true
+ false

 ❯ src/features/work/components/new-work.browser.test.tsx:167:29
    165|     });
    166|     await page.screenshot({ path: '../../../../__screenshots__/ux-revi…
    167|     expect(submit!.disabled).toBe(true);
       |                             ^
    168|     const retry = [...host.querySelectorAll('button')].find((button) =…
    169|     await act(async () => { retry.click(); await settle(); });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 3 skipped (4)
   Start at  06:08:32
   Duration  8.41s (transform 0ms, setup 0ms, import 1.59s, tests 1.43s, environment 0ms)
```

### Definition entry and record recovery: green

```text
$ pnpm vitest run --config vitest.web.canonical.config.ts apps/web/src/features/work/components/new-work.browser.test.tsx apps/web/src/features/work/components/work-list.browser.test.tsx
RUN  v4.1.10 /home/agent/wui/lane-d/apps/web


 Test Files  2 passed (2)
      Tests  9 passed (9)
   Start at  06:09:27
   Duration  17.73s (transform 0ms, setup 0ms, import 12.03s, tests 8.32s, environment 0ms)
```

### Overview navigation: red

```text
$ pnpm vitest run --config vitest.web.canonical.config.ts apps/web/src/features/work/components/work-detail.browser.test.tsx -t 'renders a result-first'
RUN  v4.1.10 /home/agent/wui/lane-d/apps/web

 ❯ |chromium| src/features/work/components/work-detail.browser.test.tsx (6 tests | 1 failed | 5 skipped) 1411ms
   × renders a result-first Work shell and fixture-backed Overview through Product reads only 1389ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |chromium| src/features/work/components/work-detail.browser.test.tsx > renders a result-first Work shell and fixture-backed Overview through Product reads only
AssertionError: expected [ 'Work Chat', 'Runs', …(3) ] to deeply equal [ 'Overview', 'Work Chat', …(4) ]

Failure screenshot:
  - apps/web/src/features/work/components/__screenshots__/work-detail.browser.test.tsx/renders-a-result-first-Work-shell-and-fixture-backed-Overview-through-Product-reads-only-1.png

- Expected
+ Received

@@ -1,7 +1,6 @@
  [
-   "Overview",
    "Work Chat",
    "Runs",
    "Execution record",
    "Files",
    "Definition",

 ❯ src/features/work/components/work-detail.browser.test.tsx:416:6
    414|         (item) => item.textContent?.trim(),
    415|       ),
    416|     ).toEqual(['Overview', 'Work Chat', 'Runs', 'Execution record', 'F…
       |      ^
    417|     expect(host.textContent).toContain(
    418|       'The result summary is still unavailable.',

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 5 skipped (6)
   Start at  06:09:59
   Duration  13.92s (transform 0ms, setup 0ms, import 5.63s, tests 1.41s, environment 0ms)
```

### Required type gate

```text
$ pnpm web:check:types
$ pnpm --filter @atomlink-ye/agent-server-web check:types
$ tsc -p tsconfig.app.json --noEmit
```

### Required browser gate, including Overview green and all create-entry checks

```text
$ pnpm vitest run --config vitest.web.canonical.config.ts
RUN  v4.1.10 /home/agent/wui/lane-d/apps/web

6:20:30 AM [vite] (client) [console.error] Warning: An update to AdvancedDefinitionAuthoring inside a test was not wrapped in act(...).

When testing, code that causes React state updates should be wrapped into act(...):

act(() => {
  /* fire events that update state */
});
/* assert on the output */

This ensures that you're testing the behavior the user would see in the browser. Learn more at https://reactjs.org/link/wrap-tests-with-act
    at AdvancedDefinitionAuthoring (http://localhost:63315/src/features/work/components/new-work.tsx:769:40)
    at details
    at section
    at NewWork (http://localhost:63315/src/features/work/components/new-work.tsx:13:27)
6:20:30 AM [vite] (client) [console.error] Warning: An update to AdvancedDefinitionAuthoring inside a test was not wrapped in act(...).

When testing, code that causes React state updates should be wrapped into act(...):

act(() => {
  /* fire events that update state */
});
/* assert on the output */

This ensures that you're testing the behavior the user would see in the browser. Learn more at https://reactjs.org/link/wrap-tests-with-act
    at AdvancedDefinitionAuthoring (http://localhost:63315/src/features/work/components/new-work.tsx:769:40)
    at details
    at section
    at NewWork (http://localhost:63315/src/features/work/components/new-work.tsx:13:27)
6:20:30 AM [vite] (client) [console.error] Warning: An update to AdvancedDefinitionAuthoring inside a test was not wrapped in act(...).

When testing, code that causes React state updates should be wrapped into act(...):

act(() => {
  /* fire events that update state */
});
/* assert on the output */

This ensures that you're testing the behavior the user would see in the browser. Learn more at https://reactjs.org/link/wrap-tests-with-act
    at AdvancedDefinitionAuthoring (http://localhost:63315/src/features/work/components/new-work.tsx:769:40)
    at details
    at section
    at NewWork (http://localhost:63315/src/features/work/components/new-work.tsx:13:27)
6:20:30 AM [vite] (client) [console.error] Warning: An update to AdvancedDefinitionAuthoring inside a test was not wrapped in act(...).

When testing, code that causes React state updates should be wrapped into act(...):

act(() => {
  /* fire events that update state */
});
/* assert on the output */

This ensures that you're testing the behavior the user would see in the browser. Learn more at https://reactjs.org/link/wrap-tests-with-act
    at AdvancedDefinitionAuthoring (http://localhost:63315/src/features/work/components/new-work.tsx:769:40)
    at details
    at section
    at NewWork (http://localhost:63315/src/features/work/components/new-work.tsx:13:27)
6:20:30 AM [vite] (client) [console.error] Warning: An update to AdvancedDefinitionAuthoring inside a test was not wrapped in act(...).

When testing, code that causes React state updates should be wrapped into act(...):

act(() => {
  /* fire events that update state */
});
/* assert on the output */

This ensures that you're testing the behavior the user would see in the browser. Learn more at https://reactjs.org/link/wrap-tests-with-act
    at AdvancedDefinitionAuthoring (http://localhost:63315/src/features/work/components/new-work.tsx:769:40)
    at details
    at section
    at NewWork (http://localhost:63315/src/features/work/components/new-work.tsx:13:27)
6:20:30 AM [vite] (client) [console.error] Warning: An update to AdvancedDefinitionAuthoring inside a test was not wrapped in act(...).

When testing, code that causes React state updates should be wrapped into act(...):

act(() => {
  /* fire events that update state */
});
/* assert on the output */

This ensures that you're testing the behavior the user would see in the browser. Learn more at https://reactjs.org/link/wrap-tests-with-act
    at AdvancedDefinitionAuthoring (http://localhost:63315/src/features/work/components/new-work.tsx:769:40)
    at details
    at section
    at NewWork (http://localhost:63315/src/features/work/components/new-work.tsx:13:27)

 Test Files  10 passed (10)
      Tests  43 passed (43)
   Start at  06:19:31
   Duration  61.08s (transform 0ms, setup 0ms, import 35.96s, tests 40.75s, environment 0ms)
```

### Required node gate: first run exposed an untranslated new source label

```text
$ pnpm vitest run --config vitest.web.config.ts --project web-node
RUN  v4.1.10 /home/agent/wui/lane-d

 ❯ |web-node| apps/web/src/i18n/i18n.test.ts (6 tests | 1 failed) 66ms
   × leaves no message untranslated by copying the English through 45ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |web-node| apps/web/src/i18n/i18n.test.ts > leaves no message untranslated by copying the English through
AssertionError: expected [ 'shell.nav.work', …(9) ] to deeply equal [ 'shell.nav.work', …(8) ]

- Expected
+ Received

@@ -6,6 +6,7 @@
    "workCard.eyebrow",
    "coworker.role.fallback",
    "boards.title",
    "work.title",
    "work.tab.definition",
+   "work.start.source",
  ]

 ❯ apps/web/src/i18n/i18n.test.ts:19:24
     17|   // Product nouns and one shared symbol are the same word in both lan…
     18|   // anything else identical to the English is a translation nobody wr…
     19|   expect(untranslated).toEqual([
       |                        ^
     20|     'shell.nav.work',
     21|     'conversations.eyebrow.workspace',

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed | 20 passed (21)
      Tests  1 failed | 157 passed (158)
   Start at  06:12:04
   Duration  41.45s (transform 12.39s, setup 0ms, import 36.02s, tests 3.88s, environment 52ms)
```

### Required node gate: green after translating the label

```text
$ pnpm vitest run --config vitest.web.config.ts --project web-node
RUN  v4.1.10 /home/agent/wui/lane-d


 Test Files  21 passed (21)
      Tests  158 passed (158)
   Start at  06:16:50
   Duration  23.38s (transform 5.78s, setup 0ms, import 16.85s, tests 1.76s, environment 90ms)
```

### Additional unchanged Task-promotion entry

```text
$ pnpm vitest run --config vitest.web.config.ts --project web-dom apps/web/src/features/work-organization/TasksPage.browser.test.tsx -t 'selects a published'
RUN  v4.1.10 /home/agent/wui/lane-d

Port 63315 is in use, trying another one...
6:12:13 AM [vite] (client) [optimizer] scanning dependencies...
6:12:18 AM [vite] (client) [optimizer] bundling dependencies...

 Test Files  1 passed (1)
      Tests  1 passed | 9 skipped (10)
   Start at  06:12:08
   Duration  34.32s (transform 0ms, setup 0ms, import 10.94s, tests 2.33s, environment 0ms)
```

## Known limitations

- This proves frontend behavior with real Chromium and fixture-backed clients; it does not prove real execution-plane availability, model quality, or live backend integration.
- Successful browser navigation after Run start is not driven through a live server. The request chain and failure recovery are exercised; Work Overview is separately rendered from existing product recordings.
- The generic selector reuses the existing catalog client's version/visibility/planning reads. This review does not establish large-catalog performance or introduce new backend pagination.
- Form-generated copy is translated in both languages. Authored Definition names/input keys and backend-authored diagnostics remain content, not translation keys.
- The raw Advanced authoring branch and its existing browser test emit React `act(...)` warnings in the full browser run; these are included in the pasted output. They did not fail the gate and were not suppressed.
- Screenshots are available in this worktree only unless separately collected as artifacts. The report is committed because the brief explicitly requests it; generated screenshots/logs and the supplied BRIEF.md are not part of the commit.

## What I could not get working

No unresolved required-gate blocker remains. The first node run failed the translation guard because the new “Definition YAML / JSON” label was identical in both dictionaries; the Chinese label is now “Definition 源码（YAML / JSON）” and the node gate is green. One intermediate recovery-test run also had a mistaken expected phrase (“This Definition” instead of the existing “This Work Definition”); correcting the assertion left the genuine enabled-Start-Work failure, whose clean red run is pasted above.

A live provider-backed Work completion and live Work Chat preparation/confirmation were not attempted in this harness-only review. The intentionally rejected first-Run fixture is a recovery test, not evidence that a real execution service failed. No backend change or unresolved Human Gate was needed for the three selected fixes.
