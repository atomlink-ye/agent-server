# Cumora-inspired Coworker Work Organization MVE

Status: active
Base: `master` `f98d17724aa24342b6e14964657aa66d9b6d86df`
Branch: `feat/cumora-work-organization-mve`
PR: #120
Canonical roadmap: https://docs.google.com/document/d/1zFloqzV12kQz4Hg1hsw5DFKuTvZ9h-IQmxYyugVv7Nc/edit?usp=drivesdk

## Goal

Ship the complete Workspace + WorkItem + Board + Conversation → Work → Review golden path without introducing a second product-facing `Task` semantic.

## Scope checklist

- [ ] R0 domain/contracts: WorkItem, Board, BoardColumn, placement, comments, invariants
- [ ] R1 persistence/application services, idempotent promotion, Work completion → In Review projection
- [ ] R2 public API + browser-safe facade
- [ ] R3 Tasks UI
- [ ] R4 Boards UI
- [ ] R5 Conversation → WorkItem and WorkItem ↔ Work bridges
- [ ] R6 deterministic golden-path closure + docs/checks

## Decisions

- Backend object is `WorkItem`; UI may label it “Tasks”.
- `WorkItem` is coordination state, `Work` is product objective, technical `Task` remains execution-node intent.
- Reuse the existing Workspace/tenant boundary; do not introduce a second Workspace concept.
- Successful linked Work execution moves a WorkItem to `in_review`; a human explicitly marks it `done`.
- Promotion must reuse canonical Work application logic and be idempotent.

## Progress

- 2026-08-26: roadmap created in Drive; branch and draft PR #120 opened.

## Validation

Report only commands/checks that actually run. Target the smallest credible evidence for changed scope.

## Next command

Inspect current domain/application/contracts/frontend structure and implement R0–R1.
