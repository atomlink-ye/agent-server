# Exec Plan protocol

## When required

Create an Exec Plan when work is likely to span sessions, coordinates multiple writers, crosses a Human Gate, or changes a public contract, migration, durable-state boundary, security boundary, or core dependency. A small reversible feature, bug fix, read-only investigation, or documentation correction may remain in the current task context or a compact task note. During Prove, planning exists for safe continuation and decisions, not as a delivery gate; ceremony must not delay the real path.

Active path:

```text
docs/exec-plans/active/YYYY-MM-DD-task-slug.md
```

Completed path keeps the same filename under `completed/`.

## Required structure

Use only the fields the risk and handoff require. For an early-stage slice, the preferred compact contract is:

```yaml
stage: prove
appetite: <bounded time or effort>
outcome: <one observable result>
real_path: <entry -> changed boundary -> observable result>
highest_unknown: <one potential invalidator, if any>
scope_now: []
no_gos: []
canonical_smoke: <command or manual runbook>
exit_condition: <minimum proof that ends the slice>
deferred: []
```

Use the fuller structure below only when durable coordination needs it.

```markdown
---
status: active
owner: ...
created_at: YYYY-MM-DD
updated_at: YYYY-MM-DD
authority: execution-plan
---

# Outcome

## Context and authority

## Scope

## Non-goals

## Work breakdown

- [ ] ...

## Verification

- [ ] command and expected boundary

## Documentation impact

- [ ] Product/Feature
- [ ] Component/Contract
- [ ] ADR/Runbook

## Decisions and discoveries

## Risks and recovery

## Validation evidence

## Completion checklist

## Current blocker

## Next exact command

## Cleanup state
```

## Maintenance rules

- Check an item when evidence exists, not when work merely started. The real main-flow E2E is the primary implementation-stage acceptance evidence.
- Add discovered work rather than hiding it in prose.
- Record a meaningful failed approach and why it changed the plan.
- Never delete unfinished scope. Mark it deferred with reason and link to a new plan or issue.
- Keep status, location, updated date, current blocker, next command, and cleanup state truthful.
- A plan is an operational handoff and decision log, not a retrospective summary written at the end.

## Archival

When a plan is intentionally archived, all remaining items must be completed or explicitly transferred, `status` must be `completed`, and the file cannot contain `- [ ]`. Run a documentation checker only when requested or when it is the cheapest way to verify the archival edit. Do not add tests, eval datasets, fixtures, or unrelated documentation to satisfy ceremony.

### Related Spec and Plan artifacts

When both `<slug>-spec.md` and `<slug>-plan.md` exist, they form one archival
unit while remaining separate documents. Completion moves both to `completed/`,
sets completed status, resolves or explicitly transfers every unchecked item,
and rewrites links away from `active/`. A standalone active Spec is allowed
during design. A missing counterpart is allowed only when the canonical Plan
states that no separate artifact was retained.
