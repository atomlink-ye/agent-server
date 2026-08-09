# Exec Plans

Exec Plans are durable, repository-visible work records for substantive changes.

```text
docs/exec-plans/
├── active/       work in progress or blocked
└── completed/    fully verified and archived work
```

Use the full [Exec Plan protocol](agents/exec-plan-protocol.md). Active plans may contain unchecked work. Completed plans must have `status: completed` and no unchecked checkbox. Deferred work is transferred explicitly rather than erased.

Before beginning a task, inspect active plans for scope and file overlap. `make check` is an available documentation/plan consistency check, not a default Prove-stage completion gate. Run it when the task explicitly archives a plan, the user requests it, or it is the cheapest relevant validation.
