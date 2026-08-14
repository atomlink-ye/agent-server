# C3/E8 execution evidence

Candidate: `02328517a0fe887464d0661d772a49ad9d88451b` on C box
`8174cc0c35a44a568688d8492fe15745` (`/root/workspace/mgr-frontend`).

## Environment and baseline

- Dockerfile `web-testing` retry: exit 1, INVALID/MISSING because the remote
  Docker daemon rejected Dockerfile `RUN --mount=type=cache` with BuildKit
  disabled. Raw output: `01-web-testing-build-retry/`.
- `PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers pnpm exec playwright
  install --with-deps --only-shell chromium`: exit 0. Playwright remained
  1.62.1; package and lock hashes were unchanged and `cmp` returned 0 for both.
  Raw output: `02-playwright-install-retry/`, `03-post-install/`.
- Fixed baseline command: exit 0; one browser test file collected, two tests
  passed. Raw output: `04-baseline/`.

## Single-factor red arms

Each arm started from the candidate in an isolated remote worktree and wrote
its result before artifact pull. Valid semantic arms were non-zero:

| arm | isolated mutation | exit | result |
| --- | --- | ---: | --- |
| a3 | recorder `runs[0].status === "succeeded"` appends `Completed` | 1 | forbidden product-status language assertion failed |
| b4 | removed per-Work unavailable disclosure | 1 | unavailable disclosure assertion failed |
| c2 | added one `/api/works/{id}/runs` fetch per Work | 1 | exact GET assertion/N+1 count failed |
| d2 | changed `data-testid="work-list"` to `work-list-mutated` | 1 | list identity assertion failed |
| e | moved the test file away | 1 | Vitest reported no test files; direct command cannot satisfy required `MISSING=2` |
| f | moved imported parallel recorder fixture away | 1 | Vite import failure, zero tests; direct command cannot satisfy required `MISSING=2` |

Raw arm logs, exits, mutation diffs, and mutation status are under
`08-arm-evidence/{a,b,c,d,e,f}/`; the remote aggregate is in
`06-remote-evidence/` and `07-evidence-summary/`. The candidate remained at
the required SHA after all arms. The only pre-existing remote changes remain
deleted dependency directories and the remote evidence directory; no candidate
source/config/script was left modified.

## Final remote state

`09-final-remote/` records candidate HEAD, status, package/lock hashes, and the
best-effort process probe. The minimal remote image lacks `ps` and `pgrep`, so
those probes report command-not-found rather than claiming a process inventory.
No C3 command was intentionally left running after the arm results were
written.
