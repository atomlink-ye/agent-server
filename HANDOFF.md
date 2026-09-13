# Lane B session handoff

Branch: `r3/lane-b`

## Completed

- `eee6da9` — gave Work authoring inputs unique labels so the real user journey can distinguish title, instructions, and worker selection.
- `e73a27e` — made a newly started WorkRun open on its Output/Result surface instead of an empty Conversation tab.
- `6011f42` — recorded and documented the first real PostgreSQL + Paseo/Codex product journey in `docs/ux/r3/real/` and `RESULTS.md`.
- `7dcdd55` — added a visible localized “Waiting for Coworker…” state while a coworker response is pending.
- `7e5b71d` — separated initial Output hydration from a genuinely absent captured result.
- `952e07e` — initially explained starter Maya when she was the only coworker.
- `81633d2` — corrected that explanation for the real shared-roster behavior: Maya is identified as a sample even when other coworkers already exist.
- `01e0fe4` — completed the deeper Output hydration fix discovered in the confirmation journey. While a WorkRun is running, an empty/erroring transcript remains a neutral loading state and is polled; the absent-output fallback is only eligible after the run becomes terminal. Added focused regression coverage.

All commits above were pushed to `origin/r3/lane-b`.

## Deliberately not completed

- I did not finish the final fixed-build real-provider rerun or overwrite the old real-flow GIF. The wrap-up instruction arrived immediately after the deeper hydration regression was fixed and tested. Partial ignored frames are under `.local/real-flow-fixed/frames`; they are not durable evidence and may be discarded.
- I did not run another browser suite during wrap-up. The final focused Work detail suite had already passed, and the instruction was to start no new work.
- I did not run the full `test:web`. The manager explicitly limited this round to focused suites because concurrent browser load caused misleading timeouts and unreaped Chromium zombies.
- I did not rerun the focused composer test after correcting its test-only global-CSS assumption. Its earlier failure was caused by asserting computed global CSS in an isolated component harness; the semantic class assertion was corrected, but the subsequent browser-stop instruction prevented confirmation.
- I did not modify or commit untracked `BRIEF.md` or `default/`. `BRIEF.md` is manager-provided task context. `default/` is a runtime artifact from the real-provider exercise.

## Broken or risky items left for the next agent

1. Repeat the entire real journey on the fixed build: register a fresh account, confirm Maya’s sample explanation, create a coworker, send a real chat message, create a Worker/Work, run it through local Paseo using Codex, and observe streaming/status/result surfaces. Confirm there is never a flash of “Captured assistant text is unavailable.” while the run is active. Then replace the real journey GIF and update `RESULTS.md`.
2. Real runtime startup must use `dev:runtime`; `pnpm dev` intentionally mock-gates/disables Product Work execution. Working environment was `DATABASE_URL=postgres://user:dev@127.0.0.1:5432/agent_server PASEO_PROVIDER=codex PASEO_ADDITIONAL_PROVIDERS=claude PASEO_MODEL=gpt-5.6-luna`. The default OpenCode model required a missing API key, while local Codex OAuth worked.
3. Port 3000 was owned by lane D’s real runtime during the last confirmation attempt. Lane B successfully used a Vite frontend on 3101 proxying that API. Do not kill another lane’s runtime. Lane B’s 3101 Vite process was stopped during this wrap-up.
4. Each browser invocation exited cleanly via the repository harness, but the system zombie-Chromium count still rose by two (for example 417→419 and 423→425). PID 1 appears not to reap already-dead children. Treat this as sandbox infrastructure behavior, ensure each harness exits, and avoid broad concurrent browser runs.
5. The real shared database contains coworkers/runs created by multiple lanes. A fresh account therefore sees a shared tenant roster, not necessarily a single pristine Maya row. The `81633d2` fix intentionally does not depend on roster length.

## Verification actually run

Commands and verbatim final Vitest totals:

```text
CI=true pnpm test:web apps/web/src/features/work/components/work-list.browser.test.tsx apps/web/src/features/work/components/definition-authoring.browser.test.tsx
 Test Files  2 passed (2)
      Tests  17 passed (17)

CI=true pnpm test:web apps/web/src/features/work/work-presentation.test.ts apps/web/src/features/work/components/new-work.browser.test.tsx
 Test Files  2 passed (2)
      Tests  7 passed (7)

CI=true pnpm test:web apps/web/src/features/work/components/work-detail.browser.test.tsx
 Test Files  1 passed (1)
      Tests  27 passed (27)

CI=true pnpm test:web apps/web/src/features/agents/agents-page.browser.test.tsx
 Test Files  1 passed (1)
      Tests  10 passed (10)

CI=true pnpm test:web apps/web/src/features/work/components/work-detail.browser.test.tsx
 Test Files  1 passed (1)
      Tests  28 passed (28)
```

The final `28 passed` run covers the completed active-run polling fix in `01e0fe4`. The browser harness reported `browser_exit=0` for these focused successful runs. `pnpm lint` was run successfully after the earlier self-contained fixes; during final wrap-up its last invocation progressed through repository lint and type checking and exited before commit, but its captured console output was interrupted, so there is no honest Vitest-style totals line to quote. `git diff --check` passed immediately before the final implementation commit.

Real-stack checks also run:

```text
DATABASE_URL=postgres://user:dev@127.0.0.1:5432/agent_server pnpm run setup
pnpm doctor
```

The setup applied migrations, and doctor reported `78/78 durable migrations applied`.

## Next session

First, run the one focused Work detail suite and the corrected coworker-composer focused suite if sandbox load permits. Then boot/reuse exactly one real runtime, repeat the genuine end-to-end journey at 1440, verify both Maya onboarding and Output hydration visually, overwrite the GIF under `docs/ux/r3/real/`, update `RESULTS.md` with honest observations, and push each self-contained change. Finish with focused Files/Tasks/Boards suites plus lint/types; only run a full browser suite if the manager explicitly asks for final-report evidence and system load is safe.
