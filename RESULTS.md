# Lane A results

## Changed

- Verified persistence writes `work_run_id` for both user and lead messages, Run-filtered reads/retries, and distinct `{ kind: 'work_run_chat', id: workRunId }` runtime scopes.
- Extended WorkRun chat runtime isolation so both preparation and Run chat replace reused provider sessions and disable provider-native tools.
- Proved switching between two Runs replaces the rendered transcript.
- Split Work Chat load and send failures so a recovered poll clears only the load failure and send retry remains available.
- Prevented overlapping/older Work Chat polls from erasing a message that just posted successfully.
- Merged Work Chat poll and send results by durable message identity, preventing a poll-before-POST race from duplicating a sent message and preventing the rolling latest-200 response window from discarding history already present in the session.
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
 Test Files  2 failed | 71 passed (73)
      Tests  3 failed | 565 passed (568)
```

The remaining failures are the brief's baseline reds: two `router.browser.test.tsx` conversation-route tests and the desktop Files scrolling test.

## Real-user chat stress pass

| Stress case                                      | Intended behavior                                                                                                          | Observed gap and disposition                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Very long single message                         | Latin/CJK text wraps inside the bubble; only code blocks scroll horizontally.                                              | Fixed and covered in Work and Coworker browser tests.                                                                                                                                                                                                                                                                                    |
| Rapid consecutive sends                          | A physical duplicate submit must never create duplicate requests; accepted messages retain order.                          | Fixed Work's render-state race with an imperative admission fence. Coworker's serialized store retained all 20 accepted messages in order while rejecting each immediate duplicate submission. The composers intentionally disable admission while a request is pending; an offline/outbound queue would be a separate product contract. |
| Arrival while scrolled up                        | Preserve the reader's position; pin only when already within 80px of the bottom.                                           | Fixed and covered for both chat surfaces.                                                                                                                                                                                                                                                                                                |
| Switch WorkRuns mid-stream                       | Old Run responses must never appear in the newly selected Run; all send/retry calls remain bound to their originating Run. | Correct after the keyed Run scope and active-effect guard; a deferred Run A response resolving after Run B is selected is now covered.                                                                                                                                                                                                   |
| Navigate away/back while the Agent is processing | Returning reloads durable status/transcript and converges to the eventual reply.                                           | Correct for persisted processing/replied state and now covered. A failed Work send that rejects only after its component is unmounted still loses its local draft/retry identity. Fixing that requires moving mutation state to a Work+Run keyed store above the route; recorded as wrong but outside this bounded correctness pass.     |
| Mixed Chinese/English                            | Preserve both scripts and markdown structure without clipping or widening the transcript in either UI locale.              | Correct and covered at 1440x900 in `en` and `zh-CN`.                                                                                                                                                                                                                                                                                     |

Work's list endpoint returns the latest 200 messages and exposes no older-history cursor. The merge fix preserves every message already loaded while that window advances, but a user entering an already longer transcript cannot reach messages older than the initial 200. That is a real history-access limitation and needs an API pagination contract, so it remains outside this client race fix.

The 1440x900 bilingual `getBoundingClientRect()` checks were repeated for mixed Coworker content: in both locales the principal bubble's right edge remained at or inside the transcript's right edge (1px rendering tolerance), while the Work measurements in the table above remained unchanged. No new layout dimensions were introduced by this stress pass.

Additional focused verification:

```text
Work chat stress:     Test Files  1 passed (1)
                      Tests  18 passed (18)
Coworker mixed chat:  Test Files  1 passed (1)
                      Tests  8 passed (8)
Coworker store races: Test Files  1 passed (1)
                      Tests  2 passed (2)
```
