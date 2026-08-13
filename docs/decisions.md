# Architecture decisions

Accepted decisions are recorded as ADRs. A superseding ADR points to the prior record; history is not rewritten.

| ADR                                                               | Decision                                                                                          | Status   |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------- |
| [0001](decisions/0001-greenfield-control-plane.md)                | Build a greenfield control plane; legacy is reference-only                                        | Accepted |
| [0002](decisions/0002-typescript-modular-monolith.md)             | TypeScript modular monolith with ports/adapters and deterministic gates                           | Accepted |
| [0003](decisions/0003-paseo-process-boundary.md)                  | Paseo is an external leaf-runtime process behind one adapter                                      | Accepted |
| [0004](decisions/0004-authenticated-service-account-admission.md) | First tenant boundary uses authenticated service-account Run admission                            | Accepted |
| [0005](decisions/0005-sequential-team-mvp.md)                     | Sequential Team MVP adds Task-first invoke/read plus leaf-only Team IR                            | Accepted |
| [0006](decisions/0006-workspace-memory-proposal-mvp.md)           | Workspace Memory Proposal MVP separates governance from retrieval                                 | Accepted |
| [0008](decisions/0008-lark-memory-command-canary.md)              | Fixed Lark command-only Memory compatibility canary and ownership seam                            | Accepted |
| [0009](decisions/0009-lark-memory-card-doc-surfaces.md)           | Card/Doc projection surfaces over canonical Memory review state                                   | Accepted |
| [0011](decisions/0011-claude-memory-api-skill-mve.md)             | API-first Store/Memory/immutable Version model and built-in API Skill                             | Accepted |
| [0012](decisions/0012-mcp-dispatch-as-run-trace-backbone.md)      | MCP dispatch and confirmation is the RunTrace backbone; execution detail lives in the Chat Detail | Accepted |

New ADRs are required for public contract ownership, database/queue selection, tenant/isolation model, credential architecture, Team graph semantics, or a second runtime.
