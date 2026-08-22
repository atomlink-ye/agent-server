---
name: agent-server-code-review
version: 1.0.0
triggers:
  - code review
  - architecture review
  - pull request review
inputs:
  - explicit scope or PR/base
outputs:
  - blocking findings with evidence
  - non-blocking improvements
permissions:
  - read repository
  - run relevant checks
validation:
  - findings resolve to current code or current canonical docs
---

# Agent Server Code Review

Review the requested diff against current product contracts, not against historical implementation habits.

## Read first

Read root `AGENTS.md`, the current architecture/contracts for the touched area, and `docs/quality/testing-and-evaluations.md`. Treat current code as implementation truth and tests as evidence, not immutable product authority.

## Review in this order

1. **Identity:** preserve `WorkDefinition -> Work -> WorkRun`; inside execution, `Task` is the node invocation and `Run` is one attempt. Never let provider/Paseo IDs become product identity.
2. **Owner scope:** tenant/workspace/principal scope is derived server-side and preserved through repository, MCP, runtime and projection boundaries.
3. **Runtime recovery:** for RuntimeSession/ExecutionPlane/MCP changes, name desired state, durable state, process-local state, restart behavior, attach postcondition and replacement owner. A successful attach must not leave stale Agent Server tools.
4. **Lifecycle:** one async operation has one owner; start/stop/dispose reaches quiescence; startup failure unwinds already-started resources.
5. **Commit point:** publish notifications/derived state only after authoritative state succeeds.
6. **Trust boundaries:** validate HTTP/MCP/config/durable/process/provider input; do not add hostile runtime validation solely for typed same-process calls.
7. **Composition:** concrete Postgres/Paseo/Hono construction belongs to composition/entrypoint boundaries, not domain/application use cases.
8. **Real path:** browser, built process, runtime/provider and migration claims need the real owning entry path when that boundary is changed.
9. **Simplification:** flag dead compatibility APIs, duplicated representations, wrappers with no net deletion, public seams with one private caller and speculative options.
10. **Documentation:** current-state docs must match HEAD. PR/phase/review narration does not belong in canonical architecture prose.

## Severity

Block when the diff violates product identity, owner/authorization scope, durable state/recovery, public contract, migration integrity, destructive semantics, or creates a second production composition path. Also block when docs state a materially contradictory current architecture.

Report only evidence-backed findings. A passing test does not cancel a contract violation; an obsolete test may be changed or deleted with the intentionally changed behavior.
