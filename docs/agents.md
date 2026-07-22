# Agent handbook

This handbook turns repository instructions into an executable work protocol. Root [AGENTS.md](../AGENTS.md) contains the short mandatory rules; these pages explain how to orient, plan, implement, verify, finish, and hand off work.

## Handbook map

- [Repository orientation](agents/repository-orientation.md): authority, reading order, maps, and conflict checks.
- [Work lifecycle](agents/work-lifecycle.md): standard understand-to-archive loop.
- [Exec Plan protocol](agents/exec-plan-protocol.md): when and how to maintain a plan.
- [Verification and completion](agents/verification-and-completion.md): evidence and finish contract.
- [Human Gates and handoff](agents/human-gates-and-handoff.md): decisions an agent cannot take alone and cross-session state.

## Task routing

| Task type                    | Mandatory authority                                                       |
| ---------------------------- | ------------------------------------------------------------------------- |
| New Feature                  | Product, Feature ledger, relevant Components, Contracts, Quality          |
| API/event/schema change      | Contracts, consumers, compatibility tests, ADR if ownership changes       |
| Paseo/runtime change         | Paseo component, Runtime contract, process runbook, external smoke        |
| Task/Run/Team change         | Domain model, Orchestration component, execution/recovery, release gates  |
| Identity/credential/security | Tenancy/security, Control Plane, Tool Gateway, security tests, Human Gate |
| Storage/migration            | Domain model, Data/Operations, migration/recovery plan, ADR               |
| Bug fix                      | Related Feature/Component/Contract, existing tests, Active Plans          |
| Test/eval work               | Acceptance requirement, test taxonomy, evidence and failure semantics     |

## Authority order

When sources disagree, use this order and record the conflict:

1. explicit current user decision and accepted ADR;
2. Product/Feature status and public Contracts;
3. Component/Architecture/Quality/Operations documents;
4. current Active Exec Plan decisions;
5. code and passing tests as implementation evidence;
6. legacy branch or external research as non-authoritative evidence.

Do not silently choose between incompatible authorities. If the choice changes scope, contract, security, or data, stop at a Human Gate.
