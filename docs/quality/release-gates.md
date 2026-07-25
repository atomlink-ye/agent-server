# Release gates

## Current product implementation-stage gate

The repository remains in product implementation stage until the user explicitly changes the phase. The default acceptance target for every slice is the smallest complete user-visible/main-flow real E2E, run as early as prerequisites allow. Fix only blockers or issues that make that path invalid, unsafe, or unverifiable; defer non-blocking hardening, uncommon recovery, concurrency, generalized abstractions, performance, polish, and review findings.

Do not proactively author or expand unit, contract, integration, deterministic E2E, eval-dataset, or test-fixture work. Test authoring requires an explicit user request. Existing CI/checks may run and should be reported truthfully, but are supporting merge signals rather than a default reason to delay the first real E2E. Human Gates remain mandatory for security, tenant, credential, public API, migration, durable-state, and core-dependency changes.

## Pull-request gate

A pull request must have:

- complete Active Exec Plan status and documentation-impact review;
- the real main-flow E2E run and recorded with its actual result; for a documentation-only diff that changes no product behavior, record not applicable and the reason;
- no secret, runtime home, generated evidence, or unrelated file;
- applicable supporting checks recorded truthfully; new tests are not implied by this gate;
- ADR and Human Gate for core dependency, public contract, storage, tenant/security, or irreversible behavior changes;
- external smoke evidence when Paseo/OpenCode/process/model/readiness behavior changed, or a recorded environmental blocker.

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
