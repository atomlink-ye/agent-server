# Agent repository instructions

This file is the mandatory entrypoint for every coding agent. Read it before changing code or documentation.

## Repository purpose

Agent Server is an enterprise control plane around external Agent execution. Paseo is the current first-class execution plane. This repository owns product Task/Run semantics, policy, durable orchestration, channels, memory governance, and the adapters that keep execution-plane details out of the core.

Repository documentation must remain usable without private Drive access. Current explicit user decisions and accepted architecture decisions override older repository prose when they conflict.

## Required reading order

1. [README](README.md) for the runnable baseline and commands.
2. [Product](docs/product.md) and [Features](docs/features.md) for scope/status.
3. The relevant [Component](docs/components.md) and [Contract](docs/contracts.md).
4. [Quality](docs/quality.md) when changing verification/test/runtime setup.
5. [Agent handbook](docs/agents.md) for implementation and handoff rules.

Never infer that a documented target is implemented. Current code and observed behavior are primary implementation facts; tests are supporting repeatable verification.

## Non-negotiable architecture boundaries

- Product `Task` is the canonical invocation; `Run` is an attempt.
- Domain and application code cannot import Paseo packages. Execution-plane details stay behind the runtime/execution boundary.
- Team coordination, joins, approvals, retry, budget, and durable state belong to the control plane, not to a runtime prompt.
- HTTP callers cannot choose arbitrary paid models. Automatic selection must never silently select a paid model.
- Prompts, credentials, tokens, raw provider errors, and private local paths must not enter ordinary responses or logs.
- A public API, tenant/security/credential boundary, migration/durable-state contract, destructive behavior, or core dependency change is a Human Gate.

## Repository hygiene — mandatory

Git HEAD stores durable product/engineering truth and repeatable verification. It does **not** store the history of how one task, phase, lane, or PR was proven.

Do not commit:

- generated logs, browser screenshots/recordings, one-run API captures, DB dumps, or runtime observations;
- task-specific evidence ledgers, mutation outputs, manager/worker handoffs, acceptance reports, or completed task plans;
- long-lived files/commands named after temporary development phases such as `phase-b`, `c3`, `e8`, `worker-c`, or `lane-h` unless that term is literally a product concept;
- scenario-specific setup runners created only because a test is inconvenient to start.

Generated test/runtime output belongs under ignored `.local/test-runs/<run-id>/` and may be uploaded as a CI artifact. Git history and PR/Issue history are the archive for development history.

`package.json` + pnpm is the sole repository command surface. Do not reintroduce a Makefile or a second command wrapper whose only job is to rename package scripts.

## Test/environment model

Use **Topology × Fixture × Test Case**.

- Topology describes infrastructure only: `in-process`, `postgres`, `core`, `runtime`, `full`.
- Fixture describes initial product data only, preferably through typed TypeScript builders.
- Test Case owns assertions only.

Dev and Test share `config/local-environments.yaml` and `tooling/environment/`.

An infrastructure-backed test should start the environment it needs. Manual setup through `pnpm env -- up ...` is for interactive debugging, not a prerequisite for tests. For one-off infrastructure commands use `pnpm env -- run <profile> -- <command>`.

If you are about to add `scripts/run-<scenario>` because setup is hard, improve `TestEnvironment`, the environment library, or fixture APIs instead.

Deterministic software behavior belongs in Vitest. Model/Agent quality belongs in `evals/`. Only a small number of canonical real external flows belong in `scripts/smoke/`.

## Repository map

```text
src/domain/                 framework-free state and invariants
src/application/            use cases and ports
src/adapters/               external-system translations
src/infrastructure/         storage/process-neutral infrastructure
src/entrypoints/            HTTP/channel/CLI entrypoints
tests/contract/             public contract checks
tests/integration/          component/datastore boundaries
tests/support/              TestEnvironment and typed test support
tests/repository/           small structural repository invariants
e2e/                        deterministic process/socket E2E
evals/                      Agent/model-quality evaluation
tooling/environment/        shared Dev/Test topology lifecycle
scripts/dev/                durable local-development helpers
scripts/smoke/              canonical real external main flows
scripts/ops/                migrations/recovery/operator utilities
docs/                       durable product/engineering authority
```

## Current stage and cadence

The repository is in **Prove / MVE-first product implementation** until the user explicitly changes the stage. The goal is fast learning through the smallest real vertical slice, not production hardening or comprehensive test growth.

For each slice:

1. Bound one observable outcome and explicit non-goals.
2. Probe only a technical unknown that can invalidate the path.
3. Build the thinnest real path.
4. Exercise the path early.
5. Fix `BLOCKER-NOW`; record non-blocking follow-up without absorbing it into scope.
6. Stop at proof.

Automated test authoring is not a default feature deliverable. Add a test when the user requests it, the changed risk warrants it, or it is the cheapest durable replacement for a behavior previously encoded in an ad-hoc script. Do not create a new harness to prove the harness.

## Completion definition

A Prove-stage slice is complete when:

- the scoped implementation produces the promised observable result;
- checks that actually ran are reported truthfully;
- no `BLOCKER-NOW` or unresolved required Human Gate remains;
- the intended diff contains no credentials, debug residue, generated runtime evidence, or task-history artifacts;
- temporary infrastructure is stopped or explicitly handed off;
- non-blocking findings are recorded in the appropriate durable issue/roadmap/decision context instead of being smuggled into the current scope.

See [docs/agents](docs/agents.md) for the detailed workflow and handoff contract.

## Cloned dependency source

Read-only dependency source repositories may be available under `.slim/clonedeps/repos/`. Do not edit these clones.
