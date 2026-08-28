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

Bounded deliberately:

- **Only the WorkRun's root Task publishes.** A Team Work fans out into member runs that
  share one `workRunId`; publishing from each would overwrite the others. Team Works
  therefore do not yet produce a result file, because the root Team task does not run
  through `AgentRunExecutor`. Single-Coworker Work does.
- **One file per run, not per Work**, so running the same Work twice does not destroy the
  earlier output.
- **An empty completion is written as an empty file**, not skipped. Skipping would restore
  the exact condition this fixes: a run that succeeded and left nothing to look at.
- **A failed write does not fail the run.** The result is already durable on the Run; this
  file is its user-visible projection. The cost is that a persistently broken writer would
  leave the surface empty while runs kept reporting success, so the deterministic scenario
  and the browser assertion in `fixture-browser` are what keep the claim honest.

Not addressed here: plaintext `result_summary` capture for single-Agent Work (the Overview
pane still shows "No result summary is present."), memory convergence, promotion/admission
redesign, and the Agents surface.
