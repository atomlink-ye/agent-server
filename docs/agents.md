# Agent handbook

This handbook turns repository instructions into an executable work protocol. Root [AGENTS.md](../AGENTS.md) contains the short mandatory rules; these pages explain how to orient, plan, implement, verify, finish, and hand off work.

## Current implementation-stage policy

The repository is in product implementation stage until the user explicitly changes the phase. Default every slice to the smallest complete user-visible/main-flow real E2E and run it as early as prerequisites allow; that real flow is the primary acceptance target. Fix only blockers or issues that make the minimum path invalid, unsafe, or unverifiable. Defer non-blocking hardening, uncommon recovery, concurrency, generalized abstractions, performance, polish, and review findings.

Do not proactively author or expand unit, contract, integration, deterministic E2E, eval-dataset, or test-fixture work. Test authoring requires an explicit user request. Existing CI/checks may run and must be reported truthfully, but they are supporting merge signals, not a default reason to delay the first real E2E. Minimum truthful plan/handoff documentation comes first; ceremony must not delay the real path. Security, tenant, credential, public API, migration, durable-state, and core-dependency Human Gates remain mandatory.

## Handbook map

- [Repository orientation](agents/repository-orientation.md): authority, reading order, maps, and conflict checks.
- [Work lifecycle](agents/work-lifecycle.md): standard understand-to-archive loop.
- [Exec Plan protocol](agents/exec-plan-protocol.md): when and how to maintain a plan.
- [Verification and completion](agents/verification-and-completion.md): evidence and finish contract.
- [Human Gates and handoff](agents/human-gates-and-handoff.md): decisions an agent cannot take alone and cross-session state.

## Task routing

| Task type                    | Mandatory authority                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------------------- |
| New Feature                  | Product, Feature ledger, relevant Components, Contracts, Quality                                    |
| API/event/schema change      | Contracts, consumers, ADR if ownership changes; existing compatibility evidence is supporting       |
| Paseo/runtime change         | Paseo component, Runtime contract, process runbook, external smoke                                  |
| Task/Run/Team change         | Domain model, Orchestration component, execution/recovery, release gates                            |
| Identity/credential/security | Tenancy/security, Control Plane, Tool Gateway, Human Gate; existing security evidence is supporting |
| Storage/migration            | Domain model, Data/Operations, migration/recovery plan, ADR                                         |
| Bug fix                      | Related Feature/Component/Contract, existing tests, Active Plans                                    |
| Test/eval work               | Acceptance requirement, test taxonomy, evidence and failure semantics                               |

## Authority order

When sources disagree, use this order and record the conflict:

1. explicit current user decision and accepted ADR;
2. Product/Feature status and public Contracts;
3. Component/Architecture/Quality/Operations documents;
4. current Active Exec Plan decisions;
5. observed real flow and current code as primary implementation evidence; passing existing tests as supporting evidence;
6. legacy branch or external research as non-authoritative evidence.

Do not silently choose between incompatible authorities. If the choice changes scope, contract, security, or data, stop at a Human Gate.
