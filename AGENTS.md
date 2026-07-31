# Agent repository instructions

This file is the mandatory entrypoint for every coding agent. Read it before changing code or documentation.

## Repository purpose

Agent Server is a greenfield enterprise control plane around Paseo. Paseo executes leaf agents. This repository owns product Task/Run semantics, policy, durable orchestration, channels, evidence, and the adapters that keep runtime details out of the core.

Do not copy the legacy `backup` implementation into this branch. Treat it as behavior evidence only. Repository documentation must remain usable without private Drive access.

## Required reading order

1. [README](README.md) for the runnable baseline and commands.
2. [Product](docs/product.md) and [Features](docs/features.md) for scope and status.
3. The relevant [Component](docs/components.md) and [Contract](docs/contracts.md).
4. Existing plans in `docs/exec-plans/active/`.
5. [Agent handbook](docs/agents.md) before implementation.

Never infer that a documented V1 target is implemented. `docs/features.md` is the status ledger; observed real flows and current code are primary implementation evidence, with existing tests as supporting evidence.

## Non-negotiable boundaries

- Product `Task` is the canonical invocation; `Run` is an attempt. The baseline Run API is a temporary walking skeleton, not a competing V1 model.
- Domain and application code cannot import Paseo packages. Paseo stays behind `AgentRuntimePort`.
- Team coordination, joins, approvals, retry, budget, and durable state belong to the control plane, not a runtime prompt.
- HTTP callers cannot choose arbitrary models. Automatic model selection must never silently select a paid model.
- Prompts, credentials, tokens, raw provider errors, and local paths must not enter normal responses or logs.
- Deterministic pull-request gates cannot require an external model or free-model availability.
- A change in public API, tenant/security boundary, durable state model, or core dependency is a Human Gate.

## Repository map

```text
src/domain/             framework-free state and invariants
src/application/        use cases and ports
src/adapters/           Paseo and future boundary implementations
src/infrastructure/     storage and process-neutral infrastructure
src/entrypoints/        HTTP and future channel entrypoints
tests/contract/         public HTTP contracts
tests/integration/      adapter/component boundaries with fakes
e2e/                    deterministic real-socket tests
scripts/smoke/          optional external-system verification
docs/                   product and engineering authority
```

## Work protocol

The repository is in product implementation stage until the user explicitly changes the phase. Create or take ownership of an Active Exec Plan before substantive work, but keep the minimum truthful plan and handoff needed for safe continuation. Documentation ceremony must not delay the real main-flow E2E.

Default every slice to the smallest complete user-visible/main-flow real E2E and run that flow as early as prerequisites allow; it is the primary phase acceptance target. Fix only issues that block that flow or make the minimum path invalid, unsafe, or unverifiable. Record and defer non-blocking hardening, uncommon recovery, concurrency, generalized abstractions, performance, polish, and review findings rather than expanding the slice.

Do not proactively author or expand unit, contract, integration, deterministic E2E, eval-dataset, or test-fixture work. Test authoring happens only when the user explicitly requests it. Existing CI/checks may run and must be reported truthfully, but they are supporting merge signals and must not delay the first real E2E unless the user asks or the requested GitHub operation requires them. Preserve security, tenant, credential, public API, migration, durable-state, and core-dependency Human Gates.

Use the smallest relevant loop first. Existing test, smoke, and CI commands are optional supporting checks: run them only when already applicable to the changed behavior or when the user explicitly requests them, and report the exact result. They are not a default implementation-stage requirement and must not delay the first real main-flow E2E.

```bash
# Optional supporting checks, only when applicable or explicitly requested:
make test-unit
make test-contract
make test-integration
make e2e-smoke
make ci
```

Run `make paseo-smoke` when changing Paseo, OpenCode resolution, process isolation, model selection, readiness, or runtime result mapping.

## Completion definition

A task is complete only when:

- implementation and documented scope agree;
- the primary real main-flow E2E ran, and any supporting checks are reported truthfully; for a documentation-only diff that changes no product behavior, record why the E2E is not applicable;
- external smoke ran when product runtime behavior changed, or the reason it could not run is recorded;
- Feature, Component, Contract, ADR, and Runbook impact is resolved;
- no unexplained TODO, skipped test, debug output, credential, or generated evidence remains;
- every Exec Plan item is checked or explicitly transferred;
- the plan is moved to `completed/`, has `status: completed`, and contains no unchecked boxes.

Human Gates, handoff format, failure recovery, and the full lifecycle are defined in [docs/agents](docs/agents.md).

## Cloned Dependency Source

Read-only dependency source repositories are available under
`.slim/clonedeps/repos/` for inspection. Do not edit these clones.

- `.slim/clonedeps/repos/getpaseo__paseo/` — `getpaseo/paseo` at `v0.1.110`; inspect the Web app, client, protocol, and server implementation for runtime integration work. An org-level reusable copy is also available at `/Volumes/AgentsWorkspace/orgs/0xdtech/tmp/paseo-v0.1.110`.
