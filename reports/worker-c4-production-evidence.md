# C4 production walking-path final report

Status: browser walking path passed; roadmap §18.3 is **not achieved** because only two of its three user questions are answerable.

| §18.3 question | Result | Evidence / boundary |
|---|---|---|
| ① What ultimately happened to this Work? | **Not answered.** The UI can only say `Final outcome unavailable` / `not captured`. | Both frozen captures expose `work_run.product_state=not_captured`, `result_summary=null`, and `result_capture_status=not_captured`. This remains the existing `O1 / PLAN-D · product-fact-capture` gap recorded in `OPEN-ISSUES-2026-08-13.md`; this round does not repair it. |
| ② Who did what? | **Answered.** | The browser shows the recorded actors, Work Items, and Attempts: parallel `3 actors / 2 items / 2 attempts`; rework `3 actors / 2 items / 3 attempts`. |
| ③ Where did rework occur? | **Answered within captured facts.** | Rework shows `3 attempts`, one recorded feedback marker, and source Attempt `524401a1-fd03-4dfa-93c7-621452a5e71d`; the UI honestly states that relation geometry is unavailable. No feedback content or target relation is inferred. |

The direct positive browser runs both returned exit `0`:

- `parallel-success`: `artifacts/c4-walking-direct/parallel-success/parallel-success.png` and `parallel-success.json`.
- `rework-once`: `artifacts/c4-walking-direct/rework-once/rework-once.png` and `rework-once.json`.

Existing decision references retain their exact scope:

- O-H49 was corrected to the fifth branch `NEVER_PROJECTED`; its decisive DB/API evidence concerns durable feedback omitted by Product projection. It is not repurposed here as proof of a durable final-outcome value.
- O-H61 is “已签 Work contract 目前不能充当重构保护边界”; its PLAN-D input is a durable identity migration plus Human Gate. It is not a final-outcome root-cause claim.
- The applicable final-outcome record is `O1 / PLAN-D · product-fact-capture`: D0/D1/D2 must close the Product fact capture semantics and produce new real recordings before the frontend may answer question ①. This round does not close that work.

`E11` feedback content remains blocked under the existing `NEVER_PROJECTED` / PLAN-D record. No liveness, provenance, network, mutation, or frozen-fixture work is claimed by this report.
