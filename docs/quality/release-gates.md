# Release gates

## Current Prove-stage gate

The repository remains in Prove / MVE-first product implementation until the user explicitly changes the stage. Root [AGENTS.md](../../AGENTS.md#current-phase-and-development-cadence) defines the gate: one representative real path reproducibly produces its observable result, no `BLOCKER-NOW` remains, no required Human Gate is unresolved, and non-blocking findings are deferred.

Opening or updating a pull request does not change the stage and does not automatically require new tests, a full local suite, or waiting for CI. Report checks that actually ran. A user-requested merge/release gate or a Human Gate may add stronger evidence for that operation.

## Pull-request record

A Prove-stage pull request records:

- the scoped outcome and representative real-path result, with documentation-only work marked not applicable;
- no secret, runtime home, generated evidence, or unrelated file;
- supporting checks that actually ran, without implying unrun checks passed;
- deferred findings and known residual risk; and
- ADR and Human Gate for core dependency, public contract, tenant/security/credential boundary, migration or durable-state contract, destructive operation, or irreversible behavior change.

An Exec Plan, external smoke, full deterministic suite, or CI result is included only when the current slice, user instruction, or Human Gate requires it.

## Baseline acceptance gate when release criteria are in scope

- supported-platform dependency resolution succeeds;
- applicable deterministic checks and build pass when already available or explicitly requested;
- three consecutive zero-model-credential live smokes succeed;
- no caller-selected model or automatic paid fallback exists;
- readiness identifies dependency failure before accepting work;
- smoke cleanup leaves no managed process or tracked evidence;
- completed bootstrap plan contains no unchecked item.

## Single-Agent Core gate when that product path is in scope

- durable idempotent admission and outbox survive process failure;
- atomic Run claim/fence and stale-write rejection are observed in the required real datastore/concurrency path; existing fault checks are supporting evidence;
- cancel/retry/reconcile/unknown outcomes converge;
- tenant and Workspace isolation, credential broker, approval, and audit are observed in the required real security path; existing adversarial checks are supporting evidence;
- Artifact/Evidence lineage and Web/API/Lark flows pass end to end;
- backup/restore and migration recovery are rehearsed.

The Phase G memory-policy MVP, when explicitly in scope, is a deterministic
development gate only: default-off policy, an existing versioned dataset,
aggregate zero-tolerance counters, and proposal-only gardening must pass. It is
not a production rollout or approval to enable auto-safe or model-based
gardening; do not author the dataset or new checks without an explicit request.

## Team V1 Beta gate when that product path is in scope

- Agent and Team implement the same Invokable/Task completion contracts;
- sequential, parallel-plus-join, and human approval exhibit the required success and failure behavior; existing matrices are supporting evidence;
- depth, fan-out, concurrency, iteration, budget, and credential attenuation are enforced;
- child completion replay is effectively-once and parent waiting/resume is recoverable;
- root cancel/retry/budget/trace cover descendants;
- root Artifact preserves all required child/version/Task/Run/evidence/source lineage;
- Team quality or turnaround benefit is measured against a single-Agent baseline.

Manager-worker, bounded review loops, schedules, and triggers are `V1_SHOULD`; their documented fallback controls may satisfy Beta when the feature is disabled.
