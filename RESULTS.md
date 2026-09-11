# Work directory and state feedback

Status: implementation checkpoint `65a4135c` is pushed to `wui3/lane-d`; browser verification is still in progress. No PR opened.

Implemented: latest Run attention markers and state labels, recency ordering, visible title suffixes, stale-list retry feedback, disabled-feature and permission guidance, stable loading placeholders, and navigation from empty artifact/transcript views. Work identity remains separate from latest Run state.

## Measured baseline (Chromium, 1440 × 900)

Measurements came from `getBoundingClientRect()` against the original source, before implementation. Temporary intentionally failing measurement assertions exposed browser values; they are being replaced by final regression assertions.

- Directory: 12 complete rows; row 57 × 292 px; title 236 × 17 px. Both English and Chinese 200-character titles remained within the row, but their suffixes were hidden by ellipsis.
- Actual list scroller: top 90 px, height 794 px. The list itself was not the scroller.
- Main loading/empty/error/unavailable heights: English 212 / 303 / 209 / 146 px; Chinese 212 / 285 / 191 / 146 px.
- Sidebar loading/empty/error/unavailable heights: English 18 / 78.5 / 103.5 / 71 px; Chinese 18 / 60.5 / 103.5 / 53 px.
- Detail loading and starting: 137 px. Generic error, permission and disabled-feature error: 352 px. Root-not-found: 399.390625 px. These dimensions were the same in both locales.

Directory/state after measurements remain pending. Assertions target 15 complete rows at 48 px; this is not yet claimed as verified.

Work Card measurements are complete at 1440 × 900 with an 800 px conversation host: card width 624 → 624 px. Loading 44 → 124 px; error 70 → 124 px; 200-character English title 149 → 124 px; 200-character Chinese title 185 → 124 px. Loading-to-ready height change is 105 → 0 px (English) and 141 → 0 px (Chinese). The original component and original stylesheet were rendered for the before readings; that temporary source copy has been removed. Final tests assert 124 × 624 px, title suffix visibility and Open Work actions in both locales.

## Checks so far

`pnpm web:check:types` exited 0:

```text
$ pnpm --filter @atomlink-ye/agent-server-web check:types
$ tsc -p tsconfig.app.json --noEmit
```

Original-source targeted browser runs passed (9 list tests and 20 state rendering tests). Measurement collection subsequently ran with intentional sentinel failures: 21 failed / 8 passed, solely to print baseline dimensions.

Revised targeted runs, including a single-file retry, hit browser startup failures before executing tests:

```text
Error: Failed to connect to the browser session "123d2182-3d05-464c-bffa-f041738032b9" [web-dom (chromium)] within the timeout.
 Test Files   (1)
      Tests  no tests
     Errors  1 error
   Start at  22:18:12
   Duration  70.11s (transform 0ms, setup 0ms, import 0ms, tests 0ms, environment 0ms)
```

Sandbox contention is not treated as a product regression. Full suite and lint have not yet run. Final per-state verdicts and final tails will replace this progress note.

## Scope notes

The conversations-route baseline failures lack the auth fixture the router now requires; they are unrelated to Work state rendering and were left unchanged. The Files baseline failure is outside this lane. Shared edits are a small contiguous addition to each locale dictionary; `index.css` is untouched. No public API or durable state contract changed.
