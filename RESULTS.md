# Results — Work sidebar scroll and rhythm

## What changed and why

- `apps/web/src/features/work/WorkPane.tsx`
  - Added one `.work-pane-scroll` region below the fixed `.pane-heading`.
  - Put the Work list before the catalog in that single reading-order column.
  - Removed the nested scroll ownership from the Work list, so list and catalog content are reachable through the same local scrollbar.
- `apps/web/src/features/work/components/work-list.css`
  - Made the heading non-shrinking and the new pane body the only flexing scroll owner.
  - Overrode the shared list flex/overflow behavior only inside this Work pane.
  - Tightened Work row padding and made the list-to-catalog divider spacing more deliberate without changing catalog-card content.
- `apps/web/src/features/work/components/work-list.browser.test.tsx`
  - Updated the existing real-scroll test to drive the pane-level scroller.
  - Added a 1440×900-equivalent laid-out case with 25 Work items and 8 catalog definitions. It measures real overflow geometry, scrolls to the bottom, verifies the heading does not move, verifies the final catalog entry is visible, and verifies the document itself does not scroll.

Before the fix, measured browser geometry confirmed the reported mechanism: the sidebar was `clientHeight=900` / `scrollHeight=1676` with `overflow-y:hidden`; the catalog was 1436px tall; and the Work list was squeezed to `clientHeight=30` while retaining `scrollHeight=1675` and `overflow-y:auto`. Thus the sidebar overflow was clipped and the list alone owned a competing scrollbar.

## Commands and real output

### Red browser run (before implementation)

Command:

```text
pnpm vitest run --config vitest.web.canonical.config.ts apps/web/src/features/work/components/work-list.browser.test.tsx -t "scrolls the Work list and catalog together"
```

Output:

```text
 RUN  v4.1.10 /home/agent/wui/lane-a/apps/web

stdout | src/features/work/components/work-list.browser.test.tsx > scrolls the Work list and catalog together while its heading stays fixed
work sidebar geometry {
  "catalog": [
    1436,
    1436,
  ],
  "list": [
    30,
    1675,
  ],
  "listOverflow": "auto",
  "pane": [
    900,
    1676,
  ],
  "paneOverflow": "hidden",
}
 ❯ |chromium| src/features/work/components/work-list.browser.test.tsx (5 tests | 1 failed | 4 skipped) 2792ms
   × scrolls the Work list and catalog together while its heading stays fixed 2779ms

 FAIL  |chromium| src/features/work/components/work-list.browser.test.tsx > scrolls the Work list and catalog together while its heading stays fixed
AssertionError: expected null not to be null

 ❯ src/features/work/components/work-list.browser.test.tsx:550:25
    548|       listOverflow: getComputedStyle(list).overflowY,
    549|     });
    550|     expect(scroller).not.toBeNull();
       |                         ^

 Test Files  1 failed (1)
      Tests  1 failed | 4 skipped (5)
```

### Green browser run (after implementation and formatting)

Command:

```text
pnpm vitest run --config vitest.web.canonical.config.ts apps/web/src/features/work/components/work-list.browser.test.tsx
```

Output:

```text
 RUN  v4.1.10 /home/agent/wui/lane-a/apps/web

 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  05:36:35
   Duration  13.98s (transform 0ms, setup 0ms, import 4.79s, tests 2.90s, environment 0ms)
```

### Node-side web unit tests

Command:

```text
pnpm vitest run --config vitest.web.config.ts --project web-node
```

Output:

```text
 RUN  v4.1.10 /home/agent/wui/lane-a

 FAIL  |web-node| apps/web/src/i18n/i18n.test.ts > leaves no message untranslated by copying the English through
AssertionError: expected [ 'shell.nav.work', …(9) ] to deeply equal [ 'shell.nav.work', …(8) ]

- Expected
+ Received

@@ -5,7 +5,8 @@
    "dispatch.recipient.fallback",
    "workCard.eyebrow",
    "coworker.role.fallback",
    "boards.title",
    "work.title",
+   "work.tab.chat",
    "work.tab.definition",

 ❯ apps/web/src/i18n/i18n.test.ts:19:24

 Test Files  1 failed | 20 passed (21)
      Tests  1 failed | 157 passed (158)
   Duration  27.09s (transform 6.70s, setup 0ms, import 18.93s, tests 1.64s, environment 8ms)
```

This failure is outside the changed surface: `work.tab.chat` was already identical in the English and Chinese dictionaries but absent from the existing allowlist. No i18n files were changed here.

### Types

Command:

```text
pnpm web:check:types
```

Output (exit 0):

```text
$ pnpm --filter @atomlink-ye/agent-server-web check:types
$ tsc -p tsconfig.app.json --noEmit
```

### Formatting and diff hygiene

Command:

```text
pnpm exec prettier --write apps/web/src/features/work/WorkPane.tsx apps/web/src/features/work/components/work-list.css apps/web/src/features/work/components/work-list.browser.test.tsx && git diff --check
```

Output (exit 0):

```text
apps/web/src/features/work/WorkPane.tsx 688ms (unchanged)
apps/web/src/features/work/components/work-list.css 296ms (unchanged)
apps/web/src/features/work/components/work-list.browser.test.tsx 734ms
```

## Known limitations

- The full web-node gate remains red because of the pre-existing `work.tab.chat` translation-allowlist mismatch described above; 157 other node-side tests pass.
- The test covers the specified desktop viewport and intentionally adds no mobile behavior because this product is desktop-only.

## What I could not get working

- I could not make the complete web-node suite green without changing unrelated i18n behavior or its allowlist, which is outside this lane's Work-sidebar scope.
