# Non-Work visual system — verification in progress

The first commit preserves the desktop measurement fixtures. Token convergence and final browser assertions are in progress. This is not a completion claim.

## Browser baseline at 1440 × 900

All numbers below came from `getBoundingClientRect()` and `getComputedStyle()` in Chromium against the original CSS. Layout numbers are English fixture measurements.

| Surface   | Workspace bar | Content header | Card padding   | First list/trace row | Content inset / grid gap |
| --------- | ------------- | -------------- | -------------- | -------------------- | ------------------------ |
| agents    | 44            | 90.5           | 14px 16px      | 57                   | 20px 24px / 24px         |
| files     | 44            | 107.875        | 14px 16px      | 51                   | 20px 24px / 14px         |
| observe   | 44            | 84.609375      | 12px 16px      | 92                   | 0px / 12px               |
| tasks     | 44            | 182            | 20px           | 90.1875              | 28px / 18px              |
| boards    | 44            | 107.875        | 11px           | 68                   | 28px / 14px              |
| run-trace | embedded      | 56             | 14px 14px 28px | 85                   | 14px 14px 28px / normal  |

Whispers, dispatch and session/stream transcript measurements remain pending. Final before → after measurements and assertions will replace this baseline-only table.

## Checks so far

The baseline Files route test renders sign-in instead of Files. It remains unchanged; the new Files visual fixture renders the real AppShell and Files components to measure their layout independently of authentication.

`pnpm test:web FilesPage.visual.browser.test.tsx` completed with this verbatim tail:

```text
 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  22:02:27
   Duration  133.15s (transform 0ms, setup 0ms, import 47.46s, tests 8.05s, environment 0ms)
```

Other baseline batches encountered CPU-starvation timeouts and one browser-connection timeout before tests ran. An overlapping measurement batch was interrupted intentionally, not diagnosed as hung. Those runs are not green verification. Full-suite, types and lint checks have not yet run.

A temporary local Vitest configuration serializes browser files and limits workers to one; it is not part of the implementation commit. No test timeout was increased.

## Scope and ownership

All nine requested stylesheets are inventoried in ignored `.local/visual-system/`. Type token values remain owned by ia-b. The planned shared-file change is only one `--font-mono` token in index.css. The three manager-listed baseline failures remain outside this lane. No PR, merge or rebase has been performed.
