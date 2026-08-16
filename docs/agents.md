# Agent handbook

Root [AGENTS.md](../AGENTS.md) contains mandatory repository rules. This handbook expands how to orient, implement, verify, and hand off work without turning task history into repository source.

## Current stage

Agent Server is in **Prove / MVE-first** development. Prove one representative path, fix only `BLOCKER-NOW`, preserve Human Gates, and stop when the bounded outcome works.

## Handbook map

- [Repository orientation](agents/repository-orientation.md)
- [Work lifecycle](agents/work-lifecycle.md)
- [Verification and completion](agents/verification-and-completion.md)
- [Human Gates and handoff](agents/human-gates-and-handoff.md)

## Task routing

| Task type                    | Mandatory authority                                                      |
| ---------------------------- | ------------------------------------------------------------------------ |
| New feature                  | Product, Feature ledger, relevant Components/Contracts                   |
| API/event/schema change      | Contracts, consumers, ADR when ownership changes                         |
| Paseo/execution change       | Runtime/Execution component and contract, real affected path when needed |
| Task/Run/Team change         | Domain model and orchestration component                                 |
| Identity/credential/security | Security/tenancy docs and Human Gate                                     |
| Storage/migration            | Domain/data ownership, migration/recovery guidance, ADR when needed      |
| Test/eval/environment work   | Quality docs, topology/fixture boundary, actual consumer                 |

## Authority order

When sources disagree, use this order and surface material conflict:

1. explicit current user decision and accepted ADR;
2. Product/Feature status and public Contracts;
3. Component/Architecture/Quality/Operations documents;
4. observed current code and real behavior;
5. existing tests as repeatable supporting evidence;
6. legacy branches/external research as non-authoritative evidence.

Do not persist ordinary task plans, worker handoffs, or one-run proof artifacts in HEAD. Durable architecture decisions belong in ADR/Decision docs; product/engineering roadmaps may live in the project documentation system; GitHub PR/Issue history carries execution history.
