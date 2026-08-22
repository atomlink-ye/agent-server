# Agent repository instructions

This file is the mandatory entrypoint for every coding agent. Read it before changing code or documentation. It is a map to the repository's detailed procedures.

## Repository purpose

Agent Server is an enterprise control plane around external Agent execution. Paseo is the current first-class execution plane. This repository owns Product Work/WorkRun semantics, technical Task/Run execution semantics, policy, durable orchestration, channels, memory governance, and the adapters that keep execution-plane details out of the core.

Repository documentation must remain usable without private Drive access. Current explicit user decisions and accepted architecture decisions override older repository prose when they conflict.

## Required reading order

1. [README](README.md) for the runnable baseline and commands.
2. [Development](docs/development.md) for the host-native developer/test boundary.
3. [Architecture](docs/architecture.md) plus the relevant architecture leaf for module/data/recovery work.
4. [Frontend architecture](docs/frontend.md) for Web, browser API/BFF, Chat, Work UI, routing, or frontend dependencies.
5. [Product](docs/product.md) and [Features](docs/features.md) for scope/status.
6. The relevant [Component](docs/components.md) and [Contract](docs/contracts.md).
7. [Testing and evaluations](docs/quality/testing-and-evaluations.md) for verification/runtime setup.
8. [Agent handbook](docs/agents.md) for implementation and handoff rules.

Never infer that a documented target is implemented. Current code and observed behavior are primary implementation facts; tests are supporting repeatable verification.

## Non-negotiable architecture boundaries

- Product-facing execution is `Work Definition -> Work -> WorkRun`; inside that Product boundary, `Task` is the canonical execution-node invocation and technical `Run` is one Task attempt.
- Durable Agent Server identity must not be replaced by Paseo/provider identity. RuntimeSession owns stable control-plane identity; provider sessions are execution bindings/generations.
- Domain and application code cannot import Paseo packages or concrete Postgres/Hono entrypoints. External details stay behind application ports and adapter/infrastructure boundaries.
- Team coordination, joins, approvals, retry, budget, and durable state belong to the control plane, not to a runtime prompt.
- HTTP callers cannot choose arbitrary paid models. Automatic selection must never silently select a paid model.
- Prompts, credentials, bearer tokens, raw provider errors, and private local paths must not enter ordinary responses or logs.
- A public API, tenant/security/credential boundary, migration/durable-state contract, destructive behavior, or core dependency change is a Human Gate.
- `apps/web` is the only browser application. It is React + Vite + React Router with the Cumora-inspired coworker shell. Do not reintroduce Next.js, `apps/web-vite`, a second product shell, or frontend-held service credentials.

## Repository hygiene — mandatory

Git HEAD stores durable product/engineering truth, active execution plans, reusable Agent Skills, and repeatable verification. It does **not** store one-run evidence or completed implementation history.

Do not commit:

- generated logs, browser screenshots/recordings, one-run API captures, DB dumps, or runtime observations;
- task-specific evidence ledgers, mutation outputs, manager/worker handoffs, or acceptance bundles that belong in CI/PR artifacts;
- long-lived files/commands named after temporary development phases such as `phase-b`, `c3`, `e8`, `worker-c`, `lane-h`, or `n3` unless that term is literally a product concept;
- scenario-specific setup runners created only because a test is inconvenient to start.

Generated test/runtime output belongs under ignored `.local/` paths and may be uploaded as a CI artifact. Git history and PR/Issue history are the archive for development choreography.

`package.json` + pnpm is the sole repository command surface. Do not reintroduce a Makefile or a second command wrapper whose only job is to rename package scripts.

## Canonical quality commands

```bash
pnpm scope:changed --base <verified-base-ref>
pnpm lint
pnpm check:imports
pnpm check:compatibility-surfaces
pnpm check:package-commands
pnpm docs:check
pnpm gates:changed --base <verified-base-ref>
pnpm test:scenario
pnpm test:pg
pnpm canary:runtime
pnpm canary:golden-path
```

Select the smallest credible evidence for the outgoing diff. Report only commands that actually ran.

## Developer/environment model

The normal development boundary is the existing host/sandbox, not Docker.

```bash
pnpm setup
pnpm doctor
pnpm dev
pnpm dev:runtime
```

- `pnpm dev` is host-native API + Web with the execution runtime disabled/mock-gated.
- `pnpm dev:runtime` is host-native API + Web + Paseo/provider helper.
- `tooling/dev/` owns host-native developer/test/canary orchestration.
- `apps/web` is the canonical Vite browser application on port 3001; browser-safe `/api/*` BFF routes are hosted by the Agent Server API process.
- CI may provide PostgreSQL as a service container; local development does not own a container topology.

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
apps/web/                    single React/Vite browser application
src/domain/                 framework-free state and invariants
src/application/            use cases, policies and ports
src/adapters/               external-system translations
src/infrastructure/         storage/files/process implementations
src/contracts/              HTTP/event/MCP/browser-safe contracts
src/entrypoints/            API/channel/CLI process entrypoints
tests/harness/              reusable deterministic scenario composition + semantic seeds
tests/contract/             public contract checks
tests/integration/          component/datastore boundaries
tests/support/              lower-level test support
tests/repository/           small structural repository invariants
tests/scenarios/            deterministic product journeys
e2e/                        explicit browser/process E2E
evals/                      Agent/model-quality evaluation
tooling/dev/                host-native developer/test/canary orchestration
scripts/dev/                reusable runtime/bootstrap helpers
scripts/quality/            repository mechanical gates
scripts/smoke/              canonical real external main flows
scripts/ops/                migrations/recovery/operator utilities
docs/                       durable product/engineering authority
```

## Current stage and current exception

The product remains **Prove / MVE-first** for feature development. However, the user explicitly authorized one repository-wide convergence pass before additional features. Its complete R0–R6 scope is authorized and is not constrained by the ordinary “bounded gardening only” rule.

After that plan is completed/archived, normal MVE-first cadence resumes:

1. bound one observable outcome and non-goals;
2. probe only invalidating unknowns;
3. build the thinnest real path;
4. exercise early;
5. fix current blockers;
6. stop at proof.

Automated test authoring is not a default feature deliverable. Add a test when the changed risk warrants it or it is the cheapest durable replacement for behavior previously encoded in an ad-hoc script.

## Completion definition

A change is complete when:

- the scoped implementation produces the promised observable result;
- checks that actually ran are reported truthfully;
- no unresolved required Human Gate remains;
- the intended diff contains no credentials, debug residue, generated runtime evidence, or stale implementation-history artifacts;
- temporary infrastructure is stopped or explicitly handed off;
- current docs/contracts are updated;
- remaining risk is explicitly owned rather than hidden in a compatibility shim or TODO.

## Cloned dependency source

Read-only dependency source repositories may be available under `.slim/clonedeps/repos/`. Do not edit these clones.
