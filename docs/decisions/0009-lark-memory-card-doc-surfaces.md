# ADR 0009: Lark Memory Card/Doc projection surfaces

## Status

Accepted for the fixed compatibility canary; not a production identity or
rollout decision.

## Decision

Proposal, accepted Entry, and ready immutable snapshot remain the only canonical
Memory authority. Lark Card and Bot-owned Doc are projection/control surfaces;
they do not become a second Memory store or approval authority. Thread command
remains the fallback surface.

For a long proposal, the Bot creates a Doc in Bot-owned space. The Doc body is
the editable proposal draft. The user may edit the body and/or add unresolved
comments and replies. The user chooses Card `Read Changes and Generate Preview`.
Agent Server reads the latest complete body/comments/replies, synthesizes one
immutable Memory Preview/hash through the approved managed-Agent application
service, and a separate `Accept Preview` accepts exactly that persisted
Preview/hash. There is no magic `Final Accepted Content` section. Resolved
comments are not active instructions, incomplete reads fail closed, and raw
comments/replies are not durably retained.

The synthesis call is an intermediate operation inside the original Product
Task. It uses a dedicated application service backed by `AgentRuntimePort`, does
not create a second Product Task/Run, does not import Paseo into
application/domain, disables Memory candidate generation, and is scoped only to
Doc Preview synthesis.

Each active Card surface uses an opaque action token whose SHA-256 hash is
persisted. Callback action, actor, chat, source Session, proposal, and fixed
owner tuple are revalidated. Provider callback tokens, raw events, comments,
replies, secrets, and raw provider errors are not retained.

The canary uses one fixed App/group/user/service-account Tenant/Workspace/
published-AgentVersion tuple, disabled by default. This is compatibility
evidence only: it does not establish canonical Lark identity, production
authorization, physical exactly-once delivery, multi-node leadership, or full
crash recovery.

## Deferred hardening

The user cancelled Task 14 implementation for this PR. Deferred work remains
visible in the active Task 14 plan, including exact Preview successor
lease/attempt fencing, post-canonical retry/fencing, manual rebuild versus
concurrent Accept, rolling allocator races, generalized synthesis retry/audit,
crash/restart/fault injection, multi-node, and performance hardening.
