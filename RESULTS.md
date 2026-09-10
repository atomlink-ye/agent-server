# Lane C results

## What changed and why

- `apps/web/src/features/work/components/panes/work-chat-pane.tsx`
  - Made the history the pane's single scroll owner and added bottom-aware auto-scroll.
  - Preserved a reader's manual position when polling refreshes while they are away from the bottom.
  - Avoided state churn for unchanged poll responses.
  - Moved loading, empty, error, and preparation states into the history rhythm and localized role labels.
- `apps/web/src/features/work/components/work-detail.css`
  - Added the bounded flex layout, readable message measure, role-specific alignment/background/avatar treatment, consecutive-role grouping, centered empty state, and an in-flow preparation card.
- `apps/web/src/features/work/components/work-shell.css`, `apps/web/src/features/work/work-page.css`, and `apps/web/src/features/work/pages/WorkDetailPage.tsx`
  - Marked the active tab and made the chat variant fill the available Work shell without allowing the outer Work content to become a competing scroll region.
- `apps/web/src/i18n/en.ts` and `apps/web/src/i18n/zh-CN.ts`
  - Added localized Lead/System/You labels and translated the existing Chinese Work Chat tab label.
- `apps/web/src/features/work/components/panes/work-chat-pane.browser.test.tsx`
  - Added real Chromium geometry coverage for overflow, initial/new-message bottom scrolling, and preserving manual scroll position during polling.
  - Captured the required empty, short, and long visual states.
- `vitest.web.canonical.config.ts`
  - Added the new browser test to the canonical include list.

## Screenshots

The browser suite runs with the configured 1440x900 desktop viewport.

- `apps/web/__screenshots__/work-chat/empty-state.png`
- `apps/web/__screenshots__/work-chat/short-conversation.png`
- `apps/web/__screenshots__/work-chat/long-conversation.png`

## Verification

### Red run before the implementation

Command:

```text
pnpm vitest run --config vitest.web.canonical.config.ts src/features/work/components/panes/work-chat-pane.browser.test.tsx
```

Real failure output:

```text
❯ |chromium| src/features/work/components/panes/work-chat-pane.browser.test.tsx (3 tests | 1 failed) 6180ms
   × keeps one overflowing history between a pinned heading and composer 1433ms

FAIL  |chromium| src/features/work/components/panes/work-chat-pane.browser.test.tsx > keeps one overflowing history between a pinned heading and composer
AssertionError: expected 4059 to be greater than 4059

 ❯ src/features/work/components/panes/work-chat-pane.browser.test.tsx:65:31
     65|   expect(history.scrollHeight).toBeGreaterThan(history.clientHeight);

Test Files  1 failed (1)
Tests  1 failed | 2 passed (3)
Duration  21.24s (transform 0ms, setup 0ms, import 3.12s, tests 6.18s, environment 0ms)
```

### Green browser run after the implementation

Command:

```text
pnpm vitest run --config vitest.web.canonical.config.ts src/features/work/components/panes/work-chat-pane.browser.test.tsx
```

Real output:

```text
RUN  v4.1.10 /home/agent/wui/lane-c/apps/web

Test Files  1 passed (1)
Tests  3 passed (3)
Start at  05:37:29
Duration  12.87s (transform 0ms, setup 0ms, import 2.53s, tests 5.12s, environment 0ms)
```

### Node-side web unit tests

Command:

```text
pnpm vitest run --config vitest.web.config.ts --project web-node
```

Real output:

```text
RUN  v4.1.10 /home/agent/wui/lane-c

Test Files  21 passed (21)
Tests  158 passed (158)
Start at  05:35:13
Duration  28.41s (transform 7.46s, setup 0ms, import 21.22s, tests 1.96s, environment 31ms)
```

### Web types

Command:

```text
pnpm web:check:types
```

Real output:

```text
$ pnpm --filter @atomlink-ye/agent-server-web check:types
$ tsc -p tsconfig.app.json --noEmit
```

### Existing Work detail browser regression suite

Command:

```text
pnpm vitest run --config vitest.web.canonical.config.ts src/features/work/components/work-detail.browser.test.tsx
```

Real output:

```text
Test Files  1 passed (1)
Tests  6 passed (6)
Start at  05:33:11
Duration  36.09s (transform 0ms, setup 0ms, import 13.06s, tests 8.36s, environment 0ms)
```

## Known limitations

- Bottom stickiness uses an 80px near-bottom tolerance; there is no separate “jump to latest” control when a reader remains scrolled up.
- Polling remains at the existing 1000ms interval; this change prevents unchanged polls from causing render/scroll churn but does not alter the transport strategy.

## What I could not get working

Nothing. The requested browser behavior, screenshots, required gates, and existing Work detail browser regression suite all completed successfully.
