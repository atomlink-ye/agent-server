# Contributing

Start with [AGENTS.md](AGENTS.md), even when working manually. The repository is in product implementation stage until the user explicitly changes the phase. Keep the minimum truthful [Active Exec Plan](docs/exec-plans.md) needed for safe continuation and preserve the Product → Feature → Component → Contract → Code → evidence trace.

## Local loop

Run the smallest complete user-visible/main-flow real E2E as soon as prerequisites allow; it is the primary acceptance target. Fix only blockers to that flow or issues that make it invalid, unsafe, or unverifiable. Record all other hardening, recovery, concurrency, abstraction, performance, polish, and review findings as deferred work.

Do not author or expand unit, contract, integration, deterministic E2E, eval-dataset, or test-fixture work unless the user explicitly requests it. Existing CI/checks may run and should be reported truthfully, but they are supporting merge signals rather than a reason to delay the first real E2E.

```bash
make setup
```

Use focused commands while developing. Run `make paseo-smoke` for runtime-boundary changes. The external smoke is evidence, not a deterministic merge gate.

## Pull requests

- Keep one coherent outcome per pull request.
- Explain current behavior, changed behavior, impact, and actual verification.
- Update the relevant Feature status only when code and acceptance evidence justify it.
- Do not weaken a test to make a change pass without documenting and approving the contract change.
- Archive the Exec Plan only after all completion checks are satisfied.

Commit messages should be terse and intentional. Generated dependencies, `.local/`, runtime homes, credentials, and smoke evidence must stay untracked.
