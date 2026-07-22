# Architecture decisions

Accepted decisions are recorded as ADRs. A superseding ADR points to the prior record; history is not rewritten.

| ADR                                                   | Decision                                                                | Status   |
| ----------------------------------------------------- | ----------------------------------------------------------------------- | -------- |
| [0001](decisions/0001-greenfield-control-plane.md)    | Build a greenfield control plane; legacy is reference-only              | Accepted |
| [0002](decisions/0002-typescript-modular-monolith.md) | TypeScript modular monolith with ports/adapters and deterministic gates | Accepted |
| [0003](decisions/0003-paseo-process-boundary.md)      | Paseo is an external leaf-runtime process behind one adapter            | Accepted |

New ADRs are required for public contract ownership, database/queue selection, tenant/isolation model, credential architecture, Team graph semantics, or a second runtime.
