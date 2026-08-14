# C4 production walking-path final report

> **Bounded-round scope correction:** `3d8d503 超出本轮 bounded round 范围；待 Phase D exit 达成后才可生效/合并`。该独立 route-only commit 予以保留、不回退，但 Human Gate 解开不等于 Phase D 前置解开；本报告不称 Phase E 完成。

Status: browser walking path passed; roadmap §18.3 is **not achieved** because only two of its three user questions are answerable.

| §18.3 question | Result | Evidence / boundary |
|---|---|---|
| ① What ultimately happened to this Work? | **Not answered.** The UI can only say `Final outcome unavailable` / `not captured`. | Both frozen captures expose `work_run.product_state=not_captured`, `result_summary=null`, and `result_capture_status=not_captured`. This remains the existing `O1 / PLAN-D · product-fact-capture` gap recorded in `OPEN-ISSUES-2026-08-13.md`; this round does not repair it. |
| ② Who did what? | **Answered.** | The browser shows the recorded actors, Work Items, and Attempts: parallel `3 actors / 2 items / 2 attempts`; rework `3 actors / 2 items / 3 attempts`. |
| ③ Where did rework occur? | **Answered within captured facts.** | Rework shows `3 attempts`, one recorded feedback marker, and source Attempt `524401a1-fd03-4dfa-93c7-621452a5e71d`; the UI honestly states that relation geometry is unavailable. No feedback content or target relation is inferred. |

The direct positive browser runs both returned exit `0`:

- `parallel-success`: `artifacts/c4-walking-direct/parallel-success/parallel-success.png` and `parallel-success.json`.
- `rework-once`: `artifacts/c4-walking-direct/rework-once/rework-once.png` and `rework-once.json`.

## Phase D direct browser demonstration

The real Next + Chromium demonstration on Cube sandbox `8174cc0c35a44a568688d8492fe15745`, using the frozen current-schema-valid `rework-once` recording, completed with exit `0`. This was a positive browser demonstration, not a checker or a replacement E12/E13 instrument.

| Phase D surface | Result | Direct observation |
|---|---|---|
| Timeline → Inspector selection | **PASS** | Clicking the third visible Attempt set `aria-pressed=true`; Inspector changed to the selected Work Item, actor, Attempt number, timing facts, and capture facts. After switching to Events and returning to Timeline, the same Attempt remained selected and Inspector content remained identical. |
| Semantic Events table | **PASS** | Events displayed `50` body rows, exactly matching the `50` accepted `mcp_activities`, across `7` semantic columns: Sequence, Actor, Work Item, Kind, Category, MCP activity status, and Result capture. |
| MCP-only coverage disclosure | **PASS** | The disclosure remained visible in Timeline and Events and stated MCP-only coverage, that other execution sources are not represented, that one recorded feedback edge is present, and that relation geometry is unavailable. |
| Events → Inspector / Attempt synchronization | **BLOCKED** | Events currently has no Inspector or event-row selection. All `50` accepted activities lack `source_refs.attempt_id`; some have `work_item_id`, but the rework Work Item has multiple Attempts. The frontend cannot infer an activity-to-Attempt relation without inventing product data. This requires an accepted Product projection relation before an honest UI mapping is possible. |

Raw screenshots:

- `/root/workspace/mgr-frontend/artifacts/phase-d-direct-ui-3d8d503/timeline-inspector-selection.png`
- `/root/workspace/mgr-frontend/artifacts/phase-d-direct-ui-3d8d503/semantic-events-table.png`

The third representative `one failed/capture-gap run` recorder remains **MISSING**. The current-schema-valid OI-38 recording is a successful cross-tenant 404 negative-control capture, not a failed/capture-gap UI scenario. `lead-never-accept` reached `failed/done` but never invoked capture and produced no compliant recorder. Neither may be used as a substitute, and no fixture is synthesized here.

Question ①, final outcome, remains blocked on B-owned Product fact capture: the accepted response still says `product_state=not_captured`, `result_summary=null`, and `result_capture_status=not_captured`. After B carries the durable outcome into Product projection and a new real recording exists, this question must be demonstrated again in the real browser; this report does not anticipate that result.

`3d8d503` remains outside this bounded round and must not take effect or be merged before Phase D exit is reached. E12/E13 work is stopped; their earlier invocation is not used to claim Phase E completion.

Existing decision references retain their exact scope:

- O-H49 was corrected to the fifth branch `NEVER_PROJECTED`; its decisive DB/API evidence concerns durable feedback omitted by Product projection. It is not repurposed here as proof of a durable final-outcome value.
- O-H61 is “已签 Work contract 目前不能充当重构保护边界”; its PLAN-D input is a durable identity migration plus Human Gate. It is not a final-outcome root-cause claim.
- The applicable final-outcome record is `O1 / PLAN-D · product-fact-capture`: D0/D1/D2 must close the Product fact capture semantics and produce new real recordings before the frontend may answer question ①. This round does not close that work.

`E11` feedback content remains blocked under the existing `NEVER_PROJECTED` / PLAN-D record. No liveness, provenance, network, mutation, or frozen-fixture work is claimed by this report.
