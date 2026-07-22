# Release gates

## Pull-request gate

A pull request must have:

- complete Active Exec Plan status and documentation-impact review;
- `make ci` passing on a clean install;
- no secret, runtime home, generated evidence, or unrelated file;
- contract tests for public/API/adapter changes;
- ADR and Human Gate for core dependency, public contract, storage, tenant/security, or irreversible behavior changes;
- external smoke evidence when Paseo/OpenCode/process/model/readiness behavior changed, or a recorded environmental blocker.

## Baseline acceptance gate

- supported-platform dependency resolution succeeds;
- deterministic suites and build pass;
- three consecutive zero-model-credential live smokes succeed;
- no caller-selected model or automatic paid fallback exists;
- readiness identifies dependency failure before accepting work;
- smoke cleanup leaves no managed process or tracked evidence;
- completed bootstrap plan contains no unchecked item.

## Single-Agent Core gate

- durable idempotent admission and outbox survive process failure;
- atomic Run claim/fence and stale-write rejection pass concurrency/fault tests;
- cancel/retry/reconcile/unknown outcomes converge;
- tenant and Workspace isolation, credential broker, approval, and audit pass adversarial tests;
- Artifact/Evidence lineage and Web/API/Lark flows pass end to end;
- backup/restore and migration recovery are rehearsed.

## Team V1 Beta gate

- Agent and Team implement the same Invokable/Task completion contracts;
- sequential, parallel-plus-join, and human approval pass success and failure matrices;
- depth, fan-out, concurrency, iteration, budget, and credential attenuation are enforced;
- child completion replay is effectively-once and parent waiting/resume is recoverable;
- root cancel/retry/budget/trace cover descendants;
- root Artifact preserves all required child/version/Task/Run/evidence/source lineage;
- Team quality or turnaround benefit is measured against a single-Agent baseline.

Manager-worker, bounded review loops, schedules, and triggers are `V1_SHOULD`; their documented fallback controls may satisfy Beta when the feature is disabled.
