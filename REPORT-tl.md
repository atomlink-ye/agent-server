# TL — 事件时间线显示真实内容

## 数据证据

演示库中本次验证的 Run 是 `8a2da7da-7647-44ee-8c66-88380dfc4485`（97 个事件：95 个 `output`、1 个 `started`、1 个 `succeeded`）。实际查询的 payload 包含：

```json
{
  "kind": "tool_status",
  "label": "Other activity",
  "status": "running",
  "summary": "Other activity.",
  "category": "other",
  "provider": "claude",
  "activity_id": "activity-1"
}
```

同一 activity 的后续事件把 label 更新为 `Other activity: pwd && ls -la`，而 sequence 5 的状态为 `completed`。同样的查询还确认了 `activity-2` 的 `read` 记录，以及带命令的 `activity-3`。

## 字段与展示

- `run_events.payload` 先由既有的 `projectRunEvent()` 转成受限的 `ProductExecutionTimelineEvent`；浏览器从不接收原始 JSON。
- `projectTranscript()` 按 `(source_refs.run_id, activity_id)` 合并 tool running/completed 对，并保留首末 `created_at`。只有两个不同捕获时间才展示耗时；单点事件只展示捕获时间。
- `buildEntryPresentation()` 保持既有优先级：有意义的 `summary`、命令 label、非泛化 label、最后是 `category`。事件序号保留为次要溯源信息，title 同时包含 Source Run 和 Event。
- `ActivityRow` 展示安全投影后的标题、状态、结果摘要和时间；assistant 文本同样由安全投影展示。

## Agent Responder 核查

真实 Trace 的 `actors` 来源是 `team_member_runs.name`，在 API 中进入 `productTrace.actors[].name`，再由 `runs[].actor_id` 关联。此演示 Work 是单 Agent Run：查询该 root task 的 `team_member_runs` 返回零行，故没有 Maya/Ada 等可用 Agent 名。

实现仅在上述关联提供名字时显示它；本 Run 不编造名字，assistant 行使用诚实的 `Assistant response` 回退。仓库中先前的通用文字是 `Agent responded`，不是持久的 `agent_responder` actor 值。

## 浏览器验收

1440px Playwright 路径：登录 → Work → `Launch brief research` → 展开 Event timeline。

- Before: `.local/tl-evidence/before.png`
- After: `.local/tl-evidence/after.png`

已人工查看两张截图。After 显示一行 `pwd && ls -la · Completed · 730 ms`、`Read · Completed · 634 ms` 与 `find … · Completed · 7.1 s`，并把 97 个原始事件收敛为 32 个活动。

## 验证

- `pnpm test:unit`: 1066 passed、4 skipped；仅既知 host-native PostgreSQL 测试在本机已启动 PG 时失败。
- `pnpm web:check:types`: passed。
- CSS 括号检查：`apps/web/src/features/run-trace/run-trace.css` 为 `158 158`。
