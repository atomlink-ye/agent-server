# Worker C · O-H9 visual parity

Status: C-owned implementation complete. Stop condition: none; all requested regions had honest recorded fields and no fabricated product state.

| Frame | Implemented structure | Intentionally omitted unsupported content | Remaining Deferred |
|---|---|---|---|
| B0 Run Trace shell | Compact My Work breadcrumb, Work Detail/Run Trace header, Historical context, Timeline/Events relationship, restrained MCP-only disclosure | Map, replay, controls, verbose unavailable blocks, product status | Full shell token migration remains deferred |
| B1 Timeline normal | Captured timestamp-derived 5–7 tick rail, actor → work item → attempt rows, duration labels, selected attempt outline, actor-only accent colors | Status color semantics, local/synthetic time, technical IDs | Browser parity evidence |
| B2 Timeline rework | Feedback geometry only for recorded feedback edge and later attempt on the same work item; explicit Recorded feedback relation label | Failed/returned/rejected claims, feedback content, inferred cross-item relations | Cases without two placed captured attempts remain quiet marker |
| B5 Execution Inspector | Grouped Subject / actor, Attempt N, timing facts, capture facts using existing fields only; ~315px inspector | INPUT/OUTPUT/DECISIONS/LOGS placeholders, product status | Browser parity evidence |
| B8 Events | Dense non-interactive table: sequence, actor, Work Item, kind, category, MCP activity status, result capture; horizontal overflow | Time, attempt, sorting/filter claims, synthetic rows, technical IDs | Browser parity evidence |

## Contract and evidence gates

- O-H14 contract-validity: MISSING, and this blocks C4.
- Browser evidence: MISSING / NOT_RUN by instruction; no install, build, dev server, provider, sandbox, or browser was run.
- Validation run: git diff --check passed; focused rg and manual source review completed.

## Commits

- 028c2ec8d929557e33ccdf16550b08fe7f17851d — fix(frontend): align B0 B1 B2 B5 B8 trace visuals; stop condition none — 4 files, 127 insertions(+), 128 deletions(-).
- fdefa2d6e374bb2cd399b2093120d6cac1e22912 — docs(frontend): record B0 B1 B2 B5 B8 parity evidence — 1 file, 38 insertions(+).
- 59e1559cfd7b4f13c29d58e6bd0904e44d31af3b — docs(frontend): finalize O-H9 parity handoff — 1 file, 2 insertions(+), 2 deletions(-).

## Exact files

- apps/web/features/run-trace/run-trace.tsx
- apps/web/features/run-trace/run-trace.css
- apps/web/components/work/work-shell.tsx
- apps/web/components/work/work-shell.css
- reports/worker-c-oh9-visual-parity.md
- tasks/active/agent-server-implementation-20260722/rounds/2026-08-13-refactor-and-web-rebuild/reports/worker-c-oh9-visual-parity.md

## Ownership and workspace status

- C-owned paths: clean after the implementation commit; reports are the only pending C-owned paths until report commit.
- Global status exception: artifacts/c2-trace-ui/ is an existing untracked C2-owned artifact directory. It was preserved exactly and was not added, committed, deleted, moved, or inspected for content.
- No package, lockfile, contract, fixture, test, design repository, or unrelated file was changed.
