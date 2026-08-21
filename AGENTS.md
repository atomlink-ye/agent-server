# Agent repository instructions

This file is the mandatory entrypoint for every coding agent. Read it before changing code or documentation.

## Repository purpose

Agent Server is an enterprise control plane around external Agent execution. Paseo is the current first-class execution plane. This repository owns Product Work/WorkRun semantics, technical Task/Run execution semantics, policy, durable orchestration, channels, memory governance, and the adapters that keep execution-plane details out of the core.

Repository documentation must remain usable without private Drive access. Current explicit user decisions and accepted architecture decisions override older repository prose when they conflict.

## Required reading order

1. [README](README.md) for the runnable baseline and commands.
2. [Development](docs/development.md) for the host-native developer/test boundary.
3. [Frontend architecture](docs/frontend.md) when changing Web, browser API/BFF, Chat, Work UI, routing, or frontend dependencies.
4. [Product](docs/product.md) and [Features](docs/features.md) for scope/status.
5. The relevant [Component](docs/components.md) and [Contract](docs/contracts.md).
6. [Testing and evaluations](docs/quality/testing-and-evaluations.md) when changing verification/runtime setup.
7. [Agent handbook](docs/agents.md) for implementation and handoff rules.

Never infer that a documented target is implemented. Current code and observed behavior are primary implementation facts; tests are supporting repeatable verification.

## Non-negotiable architecture boundaries

- Product-facing execution is `Work Definition -> Work -> WorkRun`; inside that Product boundary, `Task` is the canonical execution-node invocation and technical `Run` is one Task attempt.
- Domain and application code cannot import Paseo packages. Execution-plane details stay behind the runtime/execution boundary.
- Team coordination, joins, approvals, retry, budget, and durable state belong to the control plane, not to a runtime prompt.
- HTTP callers cannot choose arbitrary paid models. Automatic selection must never silently select a paid model.
- Prompts, credentials, tokens, raw provider errors, and private local paths must not enter ordinary responses or logs.
- A public API, tenant/security/credential boundary, migration/durable-state contract, destructive behavior, or core dependency change is a Human Gate.
- `apps/web` is the only browser application. It is React 18 + Vite + React Router with the Cumora-inspired coworker shell. Do not reintroduce Next.js, `apps/web-vite`, a second product shell, or frontend-held service credentials.

## Repository hygiene — mandatory

Git HEAD stores durable product/engineering truth and repeatable verification. It does **not** store the history of how one task, phase, lane, or PR was proven.

Do not commit:

- generated logs, browser screenshots/recordings, one-run API captures, DB dumps, or runtime observations;
- task-specific evidence ledgers, mutation outputs, manager/worker handoffs, acceptance reports, or completed task plans;
- long-lived files/commands named after temporary development phases such as `phase-b`, `c3`, `e8`, `worker-c`, or `lane-h` unless that term is literally a product concept;
- scenario-specific setup runners created only because a test is inconvenient to start.

Generated test/runtime output belongs under ignored `.local/` paths and may be uploaded as a CI artifact. Git history and PR/Issue history are the archive for development history.

`package.json` + pnpm is the sole repository command surface. Do not reintroduce a Makefile or a second command wrapper whose only job is to rename package scripts.

## Developer/environment model

The normal development boundary is the existing host/sandbox, not Docker.

Canonical commands:

```bash
pnpm setup
pnpm doctor
pnpm dev
pnpm dev:runtime
pnpm test:scenario
pnpm test:pg
pnpm canary:runtime
pnpm canary:golden-path
```

- `pnpm dev` is host-native API + Web with the execution runtime disabled/mock-gated.
- `pnpm dev:runtime` is host-native API + Web + Paseo/provider helper.
- `pnpm dev:docker*` is an explicit production-like/compatibility topology, not a prerequisite for local edits/tests.
- `tooling/dev/` owns host-native developer orchestration.
- `tooling/environment/` + `config/local-environments.yaml` own Compose/production-like topology.
- `apps/web` is the canonical Vite browser application on port 3001; browser-safe `/api/*` BFF routes are hosted by the Agent Server API process.

Do not add an implicit Docker startup to a normal test command.

## Test model

Use the cheapest boundary that proves the changed behavior:

```text
unit
  -> PGlite integration
  -> deterministic product scenario
  -> local real-Postgres semantics when required
  -> real runtime canary
  -> browser/product canary
  -> production-like acceptance
```

PGlite is the default persistence test database. Real PostgreSQL is reserved for PostgreSQL-specific lock/transaction/index/migration behavior and is opt-in through a dedicated `*test*` database URL. The `test:pg` runner must never silently point at a development or production database.

Deterministic scenarios use `tests/harness/` and semantic fixtures. Fake the probabilistic runtime/model decision boundary, not the product system. Keep production handlers/repositories real whenever the scenario is claiming product wiring correctness.

Important background workers expose deterministic `step()` seams. Test a single state transition by calling `step()` rather than starting the infinite polling loop and sleeping.

If setup is hard, improve `tooling/dev/`, `tests/harness/`, or semantic fixture APIs instead of adding a task-specific runner.

Deterministic software behavior belongs in Vitest. Model/Agent quality belongs in `evals/`. Real external compatibility belongs in a small number of explicit canaries. Milestone/release evidence belongs in acceptance/CI artifacts.

## Repository map

```text
apps/web/                    single React/Vite browser application and Cumora-style workspace shell
src/domain/                 framework-free state and invariants
src/application/            use cases and ports
src/adapters/               external-system translations
src/infrastructure/         storage/process-neutral infrastructure
src/entrypoints/            HTTP/channel/CLI entrypoints, including browser-safe Web BFF routes
tests/harness/              reusable deterministic scenario composition + semantic seeds
tests/contract/             public contract checks
tests/integration/          component/datastore boundaries
tests/support/              lower-level test support
tests/repository/           small structural repository invariants
tests/scenarios/            deterministic product journeys
e2e/                        explicit browser/process E2E
evals/                      Agent/model-quality evaluation
tooling/dev/                host-native developer/test/canary orchestration
tooling/environment/        Docker/production-like topology lifecycle
scripts/dev/                reusable runtime/bootstrap helpers
scripts/smoke/              canonical real external main flows
scripts/ops/                migrations/recovery/operator utilities
docs/                       durable product/engineering authority
```

## Current stage and cadence

The repository is in **Prove / MVE-first product implementation** until the user explicitly changes the stage. The goal is fast learning through the smallest real vertical slice, not production hardening or comprehensive test growth.

Bounded code gardening is allowed when it removes a proven transitional seam or lowers the modification radius for the next MVE probe. It does **not** change the stage, justify broad hardening, or create a standing refactor phase.

For each slice:

1. Bound one observable outcome and explicit non-goals.
2. Probe only a technical unknown that can invalidate the path.
3. Build the thinnest real path.
4. Exercise the path early.
5. Fix `BLOCKER-NOW`; record non-blocking follow-up without absorbing it into scope unless the current user explicitly asks for the full follow-up scope.
6. Stop at proof.

Automated test authoring is not a default feature deliverable. Add a test when the user requests it, the changed risk warrants it, or it is the cheapest durable replacement for behavior previously encoded in an ad-hoc script. Do not create a second harness merely to prove the harness.

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
