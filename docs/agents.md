# Agent handbook

This handbook turns repository instructions into an executable work protocol. Root [AGENTS.md](../AGENTS.md) contains the short mandatory rules; these pages explain how to orient, plan, implement, verify, finish, and hand off work.

## Current implementation-stage policy

The repository is in **Prove / MVE-first product implementation** until the user explicitly changes the stage. Root [AGENTS.md](../AGENTS.md#current-phase-and-development-cadence) is the single authority for the six-step cadence, finding classes, stop condition, and testing policy. This handbook expands the branches that need more detail; it does not add a broader completion bar.

The working rule is: prove one real representative path, fix only `BLOCKER-NOW`, record the rest, and stop. Automated tests and full CI are optional unless explicitly requested or required by a Human Gate. Security, tenant, credential, public API, migration, durable-state, destructive-operation, and core-dependency Human Gates remain mandatory.

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
