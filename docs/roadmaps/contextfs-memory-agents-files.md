# N3 — ContextFS + Memory Convergence + Agents / Files Surface

Implementation branch for the approved MVE-first roadmap:
https://docs.google.com/document/d/1ih1tewtUVsEzXZlYS9E8HTJOOrCgrf2fIHi9RfUJC1o/edit

Target:

`Canonical Context/Memory Facts → pure scope policy → ContextViewResolver → Chat/Worker views → Agents + Files UI`

This branch implements the complete N3 roadmap: canonical memory provenance and visibility, ContextFS-backed memory compatibility, explicit context promotion/admission, canonical Agents surface, and ContextFS Files/Context surface. No N3 TODOs are intentionally deferred.

## WorkRun results reach the Files surface (2026-08-29)

Measured before this change: an ordinary successful WorkRun left `context_entries`
empty, so all twelve canonical scopes stayed empty and the Files page correctly
displayed "No files in this canonical scope". The read surface was healthy; there was
simply no producer. Every existing `LogicalFileStore` writer sat on a manual promotion
or memory path, none of which the ordinary Work execution path calls.

A completed WorkRun now writes its own result into its Work scope at
`runs/<workRunId>/result.md`, through the same `MemoryModule.logicalFiles` store the
ContextFS read routes serve — so the file that is written is the file the surface lists,
with no second store to drift.

Publication happens **after** the run is durably persisted as succeeded, not when the
runtime returns. Publishing from the executor would expose a canonical result file for a
WorkRun that never durably succeeded whenever completion hit a persistence error or a
stale-claim conflict, and the Files surface would then contradict the Run it came from.

Bounded deliberately:

- **Only the WorkRun's root Task publishes.** A Team Work fans out into member runs that
  share one `workRunId`; publishing from each would overwrite the others. Team Works
  therefore do not yet produce a result file. `ExecuteTeamTask` activates the Team and
  releases the root claim to `waiting_children`; `ExecuteRun` takes that branch rather
  than `completeTerminalRun`, so its succeeded-run publication gate does not run. The
  Team root completes later through `completeTeamRunAtomically`, outside `ExecuteRun`'s
  post-completion path. Single-Coworker Work does publish through that path.
- **One file per run, not per Work**, so running the same Work twice does not destroy the
  earlier output.
- **An empty completion is written as an empty file**, not skipped. Skipping would restore
  the exact condition this fixes: a run that succeeded and left nothing to look at.
- **A failed write does not fail the run.** It happens after the run is already durable,
  so there is nothing to roll back, and the result itself is safe on the Run - this file is
  its user-visible projection. The cost is that a persistently broken writer would leave the
  surface empty while runs kept reporting success, so the deterministic scenario and the
  browser assertion in `fixture-browser` are what keep the claim honest.

Single-Coworker Work now carries the persisted succeeded root Run text to
`result_summary` with `result_capture_status: present`; the Overview and Work list show
that result while Files serves the matching `result.md`.

Deferred: publishing a result file for a successful Team Work requires a deliberate hook
in the Team's atomic completion path, alongside `completeTeamRunAtomically`, after its
final result is durable. It cannot reuse `ExecuteRun`'s post-terminal publication path,
because the Team root leaves that path in `waiting_children`. That is new Team product
semantics and remains out of scope here. Memory convergence, promotion/admission redesign,
and the Agents surface are also not addressed here.
