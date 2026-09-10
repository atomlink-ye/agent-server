# Results

## What changed

- `apps/web/src/features/work/WorkPane.tsx`
  - Removed the initiator chooser, initiator-specific state, and `initiator` query-string generation.
  - Every catalog Definition now has one primary action that opens the start flow directly from the Definition and its published version.
  - Moved Coworker visibility management outside the primary action row into a quiet `•••` overflow disclosure. This keeps the accepted capability reachable without presenting it as the purpose of the card or as ownership of a Work.
  - Continued to read `availableTo`, but use it only to describe which Coworkers can see and operate the current Definition version.
- `apps/web/src/features/work/WorkPage.tsx`
  - Removed `initiator` query-parameter handling and stopped threading an initiator into `NewWork`.
- `apps/web/src/features/work/components/new-work.tsx`
  - Removed `initialInitiatorId` and the initiator explanation from the Definition-first flow.
  - Definition-first creation still resolves the published Definition version into its Capability. Work creation sends the pinned Definition and Definition-version IDs, and Run start sends the typed input. Neither API call requires an Agent ID; execution is derived from the Definition's pinned Worker or Team.
- `apps/web/src/features/work/components/work-list.css`
  - Deleted the dead initiator styles and replaced the binding-menu selectors with quiet visibility-menu styling.
- `apps/web/src/i18n/en.ts` and `apps/web/src/i18n/zh-CN.ts`
  - Deleted the initiator keys.
  - Reworded the remaining availability copy around seeing and operating a Definition, not assignment, binding, ownership, or initiation.
  - Added localized overflow-menu labels.
- `apps/web/src/features/work/components/new-work.browser.test.tsx`
  - Added coverage that the Definition-first start flow exposes no Coworker/initiator choice and performs Work creation followed immediately by a Run-start request.
- `apps/web/src/features/work/components/work-list.browser.test.tsx`
  - Replaced the old catalog-card behavior with assertions that even a Definition visible to multiple Coworkers starts directly, produces no initiator query parameter, and keeps visibility management reachable outside the primary action row.
- `apps/web/src/features/work/clients/work-definition-client.test.ts`
  - Added an explicit assertion that Coworker visibility data remains preserved in the catalog view model.

## Verification

### Red browser run before the implementation

Command:

```text
pnpm vitest run --config vitest.web.canonical.config.ts apps/web/src/features/work/components/new-work.browser.test.tsx apps/web/src/features/work/components/work-list.browser.test.tsx
```

Output:

```text
RUN  v4.1.10 /home/agent/wui/lane-b/apps/web

❯ |chromium| src/features/work/components/work-list.browser.test.tsx (4 tests | 1 failed) 4212ms
  × starts any catalog Definition directly and keeps Coworker visibility in a secondary menu 1649ms

FAIL  |chromium| src/features/work/components/work-list.browser.test.tsx > starts any catalog Definition directly and keeps Coworker visibility in a secondary menu
AssertionError: expected <details …(1)>…(2)</details> to be null

❯ src/features/work/components/work-list.browser.test.tsx:377:8

Test Files  1 failed | 1 passed (2)
Tests  1 failed | 6 passed (7)
Duration  19.26s (transform 0ms, setup 0ms, import 12.91s, tests 4.82s, environment 0ms)
```

This failed because the old Coworker control was still inside `.work-catalog-card__actions`.

### Green browser run after the implementation

Command:

```text
pnpm vitest run --config vitest.web.canonical.config.ts apps/web/src/features/work/components/new-work.browser.test.tsx apps/web/src/features/work/components/work-list.browser.test.tsx
```

Output:

```text
RUN  v4.1.10 /home/agent/wui/lane-b/apps/web

Test Files  2 passed (2)
Tests  7 passed (7)
Start at  05:31:01
Duration  15.26s (transform 0ms, setup 0ms, import 10.83s, tests 2.33s, environment 0ms)
```

### Focused node-side client test

Command:

```text
pnpm vitest run --config vitest.web.config.ts --project web-node apps/web/src/features/work/clients/work-definition-client.test.ts
```

Output:

```text
RUN  v4.1.10 /home/agent/wui/lane-b

Test Files  1 passed (1)
Tests  4 passed (4)
Start at  05:31:22
Duration  2.26s (transform 726ms, setup 0ms, import 1.45s, tests 145ms, environment 0ms)
```

### Types

Command:

```text
pnpm web:check:types
```

Output:

```text
$ pnpm --filter @atomlink-ye/agent-server-web check:types
$ tsc -p tsconfig.app.json --noEmit
```

Exit code: `0`.

### Required full node-side web run

Command:

```text
pnpm vitest run --config vitest.web.config.ts --project web-node
```

Output:

```text
RUN  v4.1.10 /home/agent/wui/lane-b

❯ |web-node| apps/web/src/i18n/i18n.test.ts (6 tests | 1 failed) 31ms
  × leaves no message untranslated by copying the English through 22ms

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
+  "work.tab.chat",
   "work.tab.definition",

❯ apps/web/src/i18n/i18n.test.ts:19:24

Test Files  1 failed | 20 passed (21)
Tests  1 failed | 157 passed (158)
Duration  16.19s (transform 4.52s, setup 0ms, import 12.66s, tests 1.17s, environment 6ms)
```

The failing `work.tab.chat` equality/allowlist mismatch exists outside the strings changed in this lane. The focused Work Definition client suite passes, and both modified dictionaries remain type-safe.

## Known limitations

- The visibility menu retains the existing add/make-available behavior; it does not add a new revoke operation because the brief limits this change to presentation and preserves the backend contract.
- Internal API/client method names such as `bindAgent` remain unchanged because the backend contract and `work-definition-client` behavior are explicitly out of scope. User-facing copy no longer describes this as binding or ownership.

## What I could not get working

- The required full node-side web suite does not pass because of the unrelated pre-existing `work.tab.chat` translation-equality allowlist mismatch shown above. I did not broaden this lane to alter that test.
- No backend/API blocker requires an initiator. The scoped browser tests, focused client tests, and frontend type check all pass.
