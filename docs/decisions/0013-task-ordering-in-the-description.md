# 0013 · Task dependencies live in the description, not in a graph

**Status:** Accepted

## Context

A hands-off scenario was proposed: Task B should start automatically once Task A
is done, and some Tasks should only ever reach `done` after a human review.

The obvious shape is a dependency graph — `work_item_id → depends_on_work_item_id`
edges on the Board, a claim-time check that refuses Tasks whose prerequisites are
unmet, and a completion hook that wakes whatever was waiting.

A table of that shape already exists: `team_work_item_dependencies`, added by
migration `0025_agent_team_work_dependencies.sql`. It belongs to `collaboration`
— the task graph *inside* a single team execution — and nothing in
`domain/work-organization` or `application/work-organization` reads it. The Board
Tasks a person sees have no dependency concept at all.

`WORK_ITEM_STATUSES` already carries `in_review` between `in_progress` and `done`,
and the canonical Work completion projection already lands there rather than in
`done`.

## Decision

Do not build a dependency graph for Board Tasks. Do not add sub-tasks.

Express ordering and review requirements **in the Task description**, in prose.
An assigned agent reads its Task, sees what must happen first and whether a human
has to sign off, and behaves accordingly.

## Why

An agent that can read a brief can read "wait until the pricing review lands"
just as reliably as it can obey a `blocked` flag — and the sentence carries the
*reason*, which the flag does not. The graph would add a schema, a claim-time
guard, a completion hook, and a whole class of states (`blocked`, partially
satisfied, cycles) whose only job is to re-encode something already writable in
one line of English.

Sub-tasks were rejected for the same reason plus one more: they and dependencies
are two spellings of the same relationship. `A depends on B, C` already says
"A has two pieces". Having both invites the question of whether a parent's `done`
is derived or asserted, and there is no good answer to that question.

`in_review` is likewise a policy, not a mechanism. The state exists; who is
allowed to move a Task out of it is a rule an agent can be told.

## Consequences

- Ordering is advisory. Nothing prevents an agent from starting early if it
  misreads a brief. That is the accepted cost of not building the machinery.
- Task descriptions carry more weight, so brief quality matters more.
- If hands-off cascades later prove to need enforcement rather than instruction,
  this decision should be revisited with evidence from real misordering — not
  in anticipation of it. `team_work_item_dependencies` shows the shape such a
  table would take, but the Board would need its own, since binding the two
  domains to one model would couple team execution to Board semantics.
