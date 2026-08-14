# Contributing

Start with [AGENTS.md](AGENTS.md), even when working manually. The repository is in Prove / MVE-first development until the user explicitly changes the stage.

## Local loop

Install dependencies and use pnpm directly:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test:unit
```

Use `pnpm env -- up <profile>` for interactive infrastructure and `pnpm env -- run <profile> -- <command>` for one-off infrastructure-backed commands. Tests that need infrastructure should normally start it through the shared TestEnvironment support rather than depending on a manual pre-step.

## Repository hygiene

Keep one coherent outcome per change. Do not commit task-specific logs, screenshots, recordings, evidence packets, phase/lane/worker reports, mutation output, or other generated run material. Generated diagnostics belong in `.local/test-runs/` and CI artifacts.

Do not create scenario setup scripts when the real problem is missing environment or fixture support. Improve `tooling/environment/` or `tests/support/` instead.

Long-lived names describe product or engineering semantics, not the development phase that created them.

## Verification

Run the cheapest honest check that touches the changed risk and report only what actually ran. Useful commands include:

```bash
pnpm test:repository
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm test:real-pg
pnpm test:e2e
pnpm smoke:runtime
```

External smokes are opt-in and may require credentials. Deterministic tests must not require live model availability.

## Pull requests and handoff

Explain current behavior, changed behavior, impact, actual verification, and residual risk. Never weaken a test just to obtain green output without approving the contract change. If work is interrupted, hand off the exact next action, changed files, running infrastructure, latest verification, blockers, and cleanup state.

Commit messages should be terse and intentional. `.local/`, runtime homes, credentials, and generated test output must stay untracked.
