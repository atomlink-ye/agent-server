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
- A change in public API, tenant/security/credential boundary, migration or durable state model, destructive behavior, or core dependency is a Human Gate.

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

## Current phase and development cadence

The repository is in **Prove / MVE-first product implementation** until the user explicitly changes the stage. The current goal is fast product learning through the smallest real vertical slice, not production hardening or a comprehensive regression bar.

Use this cadence for every slice:

1. **Bound the bet.** State one observable outcome, a small appetite, one representative scenario, and explicit non-goals.
2. **Probe only a blocker.** If one technical unknown can invalidate the path, answer it with the shortest real-boundary experiment. Otherwise start the slice.
3. **Build the thinnest real path.** Connect a real entry point through the changed code and affected real critical boundary to an observable result. Prefer fixed configuration, one provider, one tenant, or a manual setup step over a generalized subsystem.
4. **Exercise it early.** As soon as the path can run, use the canonical smoke/manual flow. A focused existing check is optional when it is cheaper or helps keep the change honest.
5. **Classify findings.** Fix `BLOCKER-NOW`: the path cannot complete, the evidence is false, a critical boundary is bypassed, or the slice is unsafe. Record `DEFERRED-FEATURE`, `HARDENING`, and `QUESTION` findings without expanding the slice.
6. **Stop at proof.** Finish when the representative path works, the observable result is reproducible through the canonical smoke/manual flow, no `BLOCKER-NOW` remains, and no required Human Gate is unresolved. Do not polish past that exit condition.

Plans and handoffs must be only as large as safe continuation requires. Use an Active Exec Plan for work that spans sessions, crosses Human Gates, or needs durable coordination; a small reversible slice may use a compact task note or the current task context. Documentation ceremony must not delay the real path.

The default verification budget is the canonical real flow plus, at the implementer's discretion, one focused existing check when it is useful. Automated test authoring is not a default deliverable in this stage. Do not require TDD, a red baseline, new unit/contract/integration/E2E tests, coverage growth, `make check`, `make test`, or `make ci` unless the user explicitly requests that gate or the changed risk makes it necessary for a Human Gate. Full suites and CI belong to an explicitly requested merge/release gate, not ordinary feature completion.

Preserve security, tenant, credential, public API, migration, durable-state, destructive-operation, and core-dependency Human Gates. MVE-first reduces scope and ceremony; it does not weaken these boundaries or permit unverifiable claims.

When Paseo, provider resolution, process isolation, model selection, readiness, or runtime result mapping changes, exercise the smallest real affected runtime path. `make paseo-smoke` is one available supporting command, not an automatic full-slice gate.

## Completion definition

A Prove-stage slice is complete when:

- the scoped implementation produces the promised observable result on the representative real path;
- the evidence actually run is reported truthfully, with documentation-only work marked as not applicable;
- no `BLOCKER-NOW` remains and no required Human Gate is unresolved;
- non-blocking findings and unfinished ambitions are recorded as deferred rather than silently absorbed into the slice;
- the intended diff contains no credential, debug residue, or generated evidence; and
- any plan used for the slice is truthful: finished items are closed and remaining items are explicitly transferred. Archival and broad documentation convergence may follow as separate work unless the user made them part of this slice.

Human Gates, handoff format, failure recovery, and the full lifecycle are defined in [docs/agents](docs/agents.md).

## Cloned Dependency Source

Read-only dependency source repositories are available under
`.slim/clonedeps/repos/` for inspection. Do not edit these clones.

- `.slim/clonedeps/repos/getpaseo__paseo/` — `getpaseo/paseo` at `v0.1.110`; inspect the Web app, client, protocol, and server implementation for runtime integration work. An org-level reusable copy is also available at `/Volumes/AgentsWorkspace/orgs/0xdtech/tmp/paseo-v0.1.110`.
