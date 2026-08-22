---
name: agent-server-archive-notes
version: 1.0.0
triggers: [archive decision, supersede note, documentation gardening]
inputs: [decision or note scope]
outputs: [active authority with repaired links]
permissions: [read and edit decision/plan docs]
---

# Archive Agent Server Notes and Decisions

Reduce active decision noise without erasing rationale that still constrains current code.

Classify each record by future decision value:

- keep active when it still owns an invariant, compatibility obligation, security rule, durable format, reintroduction condition or important rejected alternative;
- move completed implementation/process history out of the active corpus when current code/docs already own the behavior;
- supersede a record only after every surviving rationale/alternative/risk is transferred or linked to the current owner;
- delete rejected ideas that are no longer plausible mistakes.

When an execution plan completes, remove it from `docs/exec-plans/active` in the same change that updates current architecture/contracts. Repair all inbound links and never treat an archived record as the current behavior authority.
