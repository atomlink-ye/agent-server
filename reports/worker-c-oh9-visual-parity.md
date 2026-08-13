# Worker C · O-H9 visual parity

Status: B0/B1/B5/B8 remain Partial pending independent parity review. B2 is FAIL and moved out of this round's visual acceptance: it is a product-fact gap and PLAN-D input, not a frontend implementation gap.

| Frame | Implemented structure | Intentionally omitted unsupported content | Remaining Deferred |
|---|---|---|---|
| B0 Run Trace shell | Compact single-layer Work Detail → Run Trace hierarchy, Historical context, Timeline/Events relationship, restrained MCP-only disclosure | Map, replay, controls, verbose unavailable blocks, product status | Partial; full shell token migration remains deferred |
| B1 Timeline normal | Captured timestamp-derived 5–7 tick rail, stable actor-identity accent tokens, actor → work item → attempt rows, duration labels, selected Attempt, uncaptured timing as non-positioned disclosure | Status color semantics, local/synthetic time, technical IDs, guessed placement for uncaptured timing | Partial; browser parity evidence |
| B2 Timeline rework | No timeline feedback geometry; only ordinary secondary disclosure that recorded feedback edges exist and relation geometry is unavailable | Return-edge geometry, target Attempt identity, failed/returned/rejected claims, feedback content | FAIL — moved out of this round's visual acceptance; product-fact gap / PLAN-D input |
| B5 Execution Inspector | Selected execution subject with actor subtitle, natural primary/secondary fact hierarchy, grouped Attempt N, timing facts, capture facts using existing fields only; ~315px inspector | INPUT/OUTPUT/DECISIONS/LOGS placeholders, product status | Partial; browser parity evidence |
| B8 Events | Dense non-interactive table with non-interactive recorded-events toolbar skeleton, clear table headers, sequence/actor/Work Item/kind/category/MCP activity status/result capture | Time, attempt, sorting/filter claims, synthetic rows, technical IDs, fake controls | Partial; browser parity evidence |

## B2 classification: product-fact gap / PLAN-D input

1. The design reference at `design/figma/01-work-detail/timeline-rework/` expresses a return edge from the feedback source Attempt to a later rework target Attempt across the timeline, including the corresponding interaction.
2. The accepted `ProductRunTraceResponse` `data.trace.edges[]` feedback variant is `ProductFeedbackEdgeSchema` in `src/contracts/product-projection/edges.ts`; it contains only the source-side `attempt_id` and lacks a sibling `target_attempt_id` (product Attempt identity). The final field name is subject to PLAN-D/Human Gate decision, but the semantic position belongs on the feedback edge.
3. `attempt_id` is currently taken directly by `projectFeedbackEdges` from the `attempt.id` that produced the feedback fact, so it anchors only the source. A Work Item may have multiple later Attempts; chronology or `attempt_no` cannot prove which one is the target, so the frontend cannot infer it.
4. **在这个字段补上之前，任何画出这条边的前端实现都是在造数据。** This is a PLAN-D input / product-fact gap, not “frontend not implemented”.

## Contract and evidence gates

- O-H14 contract-validity: MISSING, and this blocks C4.
- Browser evidence: MISSING / NOT_RUN by instruction; no install, build, dev server, provider, sandbox, or browser was run.
- Validation run: git diff --check passed; focused rg and manual source review completed.

## Commits

- 028c2ec8d929557e33ccdf16550b08fe7f17851d — fix(frontend): align B0 B1 B2 B5 B8 trace visuals; initial stop condition none — 4 files, 127 insertions(+), 128 deletions(-).
- fdefa2d6e374bb2cd399b2093120d6cac1e22912 — docs(frontend): record B0 B1 B2 B5 B8 parity evidence — 1 file, 38 insertions(+).
- 59e1559cfd7b4f13c29d58e6bd0904e44d31af3b — docs(frontend): finalize O-H9 parity handoff — 1 file, 2 insertions(+), 2 deletions(-).
- 4f4e6671682edc373ef1210b28396062b436f105 — docs(frontend): include complete O-H9 commit record — 1 file, 1 insertion(+), 1 deletion(-).
- f8373e68db21f7d31c07c15323bae8eb3e4e78ce — fix(frontend): type recorded B2 feedback edges — 1 file, 2 insertions(+), 1 deletion(-).
- b22488f6a2aeb7a9f9da517db350163a1d3badf3 — docs(frontend): close O-H9 ownership status — 1 file, 1 insertion(+), 1 deletion(-).
- 0a7d6cdf54bdb5ac2fbea2ef8552799892e4549a — fix(frontend): correct B2 feedback target; stop condition deferred — 2 files, 6 insertions(+), 12 deletions(-).
- 152b0a006d48c60b10e630d6488e0b0bf76cefd9 — fix(frontend): correct B2 feedback target and uncaptured timing — 3 files, 6 insertions(+), 4 deletions(-).
- 93e6f15387c67da3bde171faeded37643a480e3d — docs(frontend): record B2 honesty fixes — 1 file, 2 insertions(+).
- 79add0fb5c94726ebf9c2507991ccc37db77b6ca — docs(frontend): classify B2 as PLAN-D product-fact gap — 1 file, 17 insertions(+), 6 deletions(-).
- 18a249e881ccb40eda500a297cdd111f410c0cd3 — fix(frontend): align B0 B1 B2 B5 B8 honestly; stop condition B2 product-fact gap — 3 files, 24 insertions(+), 23 deletions(-).

## Exact files

- apps/web/features/run-trace/run-trace.tsx
- apps/web/features/run-trace/run-trace.css
- apps/web/components/work/work-shell.tsx
- apps/web/components/work/work-shell.css
- reports/worker-c-oh9-visual-parity.md
- tasks/active/agent-server-implementation-20260722/rounds/2026-08-13-refactor-and-web-rebuild/reports/worker-c-oh9-visual-parity.md

## Ownership and workspace status

- C-owned paths: clean after the implementation commits.
- Global status exception: artifacts/c2-trace-ui/ is an existing untracked C2-owned artifact directory. It was preserved exactly and was not added, committed, deleted, moved, or inspected for content.
- No package, lockfile, contract, fixture, test, design repository, or unrelated file was changed.
