# Lane A results

## Changed

- Verified persistence writes `work_run_id` for both user and lead messages, Run-filtered reads/retries, and distinct `{ kind: 'work_run_chat', id: workRunId }` runtime scopes.
- Extended WorkRun chat runtime isolation so both preparation and Run chat replace reused provider sessions and disable provider-native tools.
- Proved switching between two Runs replaces the rendered transcript.
- Split Work Chat load and send failures so a recovered poll clears only the load failure and send retry remains available.
- Prevented overlapping/older Work Chat polls from erasing a message that just posted successfully.
- Kept Work and Coworker bubbles within their transcript for long unbroken Latin text, CJK, and code blocks.
- Added initial/new-arrival pinning to Coworker chat while preserving the reader's position after they scroll up.
- Replaced the baseline Work Card font-geometry pins with platform-independent assertions of the product contract: 624px width, 124px minimum height, condensed preview, and contained content/action.

## 1440px measurements

Measured in real Chromium at a 1440x900 viewport with `getBoundingClientRect()`. The “before” pass disabled the new wrapping rule in the same rendered fixture; the “after” pass restored it. The wrapping fix intentionally changes overflow behavior without changing the container geometry.

| Locale | State  | Work chat history (x, y, w, h) | Long user bubble (x, y, w, h)        |
| ------ | ------ | ------------------------------ | ------------------------------------ |
| en     | before | 180, 154, 820, 572 px          | 319.34375, -16, 621.65625, 612.25 px |
| en     | after  | 180, 154, 820, 572 px          | 319.34375, -16, 621.65625, 612.25 px |
| zh-CN  | before | 180, 154, 820, 572 px          | 319.34375, -16, 621.65625, 612.25 px |
| zh-CN  | after  | 180, 154, 820, 572 px          | 319.34375, -16, 621.65625, 612.25 px |

The post-change browser assertions additionally prove transcript and bubble `scrollWidth <= clientWidth + 1`; fenced code retains its own horizontal scroller.

## Verification

- `CI=true pnpm exec vitest run src/application/runtime/ensure-runtime-session.test.ts`: passed, 1 file / 9 tests.
- `CI=true pnpm test:web apps/web/src/features/work/components/panes/work-chat-pane.browser.test.tsx`: passed, 1 file / 12 tests.
- `CI=true pnpm test:web apps/web/src/features/conversations/components/ChatTranscript.browser.test.tsx`: passed, 1 file / 7 tests.
- `CI=true pnpm test:web apps/web/src/features/work/components/work-feedback.browser.test.tsx`: passed, 1 file / 12 tests.
- `pnpm lint`: exited 0 after each committed product change.
- `CI=true pnpm test:web`: only the three declared baseline failures remained. Verbatim summary:

```text
 Test Files  2 failed | 70 passed (72)
      Tests  3 failed | 556 passed (559)
```

The remaining failures are the brief's baseline reds: two `router.browser.test.tsx` conversation-route tests and the desktop Files scrolling test.
