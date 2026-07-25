# Exec Plan protocol

## When required

Create an Exec Plan for every Feature, bug fix, refactor, dependency upgrade, public API/event/schema change, migration, security/reliability change, cross-component documentation change, multi-step investigation/implementation, or work likely to span sessions. During product implementation stage, keep the plan to the minimum truthful handoff needed for safe continuation; plan ceremony must not delay the real main-flow E2E. A read-only investigation or semantics-free typo may be exempt.

Active path:

```text
docs/exec-plans/active/YYYY-MM-DD-task-slug.md
```

Completed path keeps the same filename under `completed/`.

## Required structure

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

Before moving to `completed/`, all work, verification, documentation, cleanup, and completion checkboxes must be checked. Set `status: completed`, update evidence and remaining risks, move the file, and run the applicable checks. Completed plans cannot contain `- [ ]` anywhere. Do not add deterministic tests, eval datasets, or fixtures to satisfy ceremony unless the user explicitly requests that work.

### Related Spec and Plan artifacts

When both `<slug>-spec.md` and `<slug>-plan.md` exist, they form one archival
unit while remaining separate documents. Completion moves both to `completed/`,
sets completed status, resolves or explicitly transfers every unchecked item,
and rewrites links away from `active/`. A standalone active Spec is allowed
during design. A missing counterpart is allowed only when the canonical Plan
states that no separate artifact was retained.
