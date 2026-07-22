# Contributing

Start with [AGENTS.md](AGENTS.md), even when working manually. All substantive changes use an [Active Exec Plan](docs/exec-plans.md) and preserve the Product → Feature → Component → Contract → Code → Test trace.

## Local loop

```bash
make setup
make ci
```

Use focused commands while developing. Run `make paseo-smoke` for runtime-boundary changes. The external smoke is evidence, not a deterministic merge gate.

## Pull requests

- Keep one coherent outcome per pull request.
- Explain current behavior, changed behavior, impact, and actual verification.
- Update the relevant Feature status only when code and acceptance evidence justify it.
- Do not weaken a test to make a change pass without documenting and approving the contract change.
- Archive the Exec Plan only after all completion checks are satisfied.

Commit messages should be terse and intentional. Generated dependencies, `.local/`, runtime homes, credentials, and smoke evidence must stay untracked.
