# Contributing

Start with [AGENTS.md](AGENTS.md), even when working manually. The repository is in Prove / MVE-first product implementation until the user explicitly changes the stage. Keep only the planning record needed for safe continuation and preserve the Product → Feature → Component → Contract → Code → evidence trace.

## Local loop

Bound one observable outcome and appetite, build the thinnest representative real path, exercise it early, fix only `BLOCKER-NOW`, record other findings, and stop at proof.

Do not author or expand unit, contract, integration, deterministic E2E, eval-dataset, or test-fixture work unless the user explicitly requests it or a Human Gate requires it. Existing CI/checks may run and should be reported truthfully, but they are supporting merge signals rather than a reason to delay the first real E2E.

```bash
make setup
```

Use focused existing commands only when they are useful. For runtime-boundary changes, exercise the smallest real affected runtime path; `make paseo-smoke` is one supporting option, not an automatic gate.

## Pull requests

- Keep one coherent outcome per pull request.
- Explain current behavior, changed behavior, impact, and actual verification.
- Update the relevant Feature status only when code and acceptance evidence justify it.
- Do not weaken a test to make a change pass without documenting and approving the contract change.
- Archive an Exec Plan only when archival is in scope and all remaining items are completed or explicitly transferred.

Commit messages should be terse and intentional. Generated dependencies, `.local/`, runtime homes, credentials, and smoke evidence must stay untracked.
