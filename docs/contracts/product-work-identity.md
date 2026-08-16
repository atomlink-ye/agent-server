# Product Work Identity — 冻结裁决

> **本文件是 S1 的产物，是本轮唯一的 identity 输入。**
> 每一项都是**唯一取值**。本文件不留任何未裁定的备选项。
> 任何与它冲突的历史文档一律以本文件为准。
>
> 冻结日期：2026-08-10。签署见 `HG-1` 记录（任务包 round 目录）。

---

## 1. Owner scope

新表的归属列固定为两列：

```
tenant_id text
workspace_id uuid
```

外键固定为复合形式：

```
(workspace_id, tenant_id) -> workspaces(id, tenant_id)
```

`workspaces.principal_type` 与 `workspaces.principal_id` 重新解释为**创建者**，不是所有者。
新表**一律不带** principal 列。

投影与枚举的过滤条件固定为 `(tenant_id, workspace_id)` 两列。

## 2. 产品身份

| 对象       | id 取值             |
| ---------- | ------------------- |
| `Work`     | 产品 UUID，独立生成 |
| `WorkRun`  | 产品 UUID，独立生成 |
| `WorkItem` | 产品 UUID，独立生成 |
| `Attempt`  | 产品 UUID，独立生成 |

固定约束：

- `Work.id` 永远不是 root Task 的 id。
- `WorkRun.id` 永远不是 TeamRun 的 id，也不是 technical Run 的 id。
- `WorkDefinitionVersion` 在当前实现中对应 `team_versions.id`。
- manifest 承载不可变的、已解析完成的确切版本引用。

## 3. Technical id 的唯一出口

technical id 只允许出现在 `source_refs` 结构里。它是审计与排障用的固定键结构，
**不是产品导航身份**。

产品对象的主体字段中，下列键名一律禁止出现：

```
root_task_id
team_run_id
team_member_run_id
task_id
run_id
```

机器可读形式见同目录的 `product-work-vocabulary.json`，该文件是 S8 校验脚本的输入。
实现者**不得自行扩充** allow-list；扩充需要重新过 Human Gate。

## 4. Decision 捕获语义

本周期的裁决：**autonomous Decision 的持久捕获延后**，不修改 `collaboration_finish` 的写入路径。

产品契约仍然必须包含下面这个类型，因为「没有捕获能力」与「捕获到了空集」是两件事：

```ts
type DecisionCapture =
  | { status: 'not_captured'; items?: never }
  | { status: 'reported'; items: readonly DecisionSummary[] };
```

- `reported` 且 `items` 为空数组：agent 明确报告了「没有 Decision」。
- `not_captured`：系统当前没有捕获能力。

同一条规则适用于 Artifact 引用、causation、以及 team 表未覆盖的 edges：
**能力缺失是数据，不是空值。**

## 5. Artifact 的未来形状（本轮只冻结，不建表）

- Work 侧只传三样东西：`{ productionReceiptId, content, artifactTarget }`。
- Artifact 模块在校验 Execution 收据之后，**在自己内部**构造 `VerifiedProvenance`。
- 生产凭据只承载 execution 事实。
- 摘要（`content_sha256`）由 Artifact 模块自己重算，不接受外部传入。
- 种类（`kind`）同样不由生产凭据承载。
- agent 永远不提供 provenance。
- 未来唯一约束固定为：

```sql
UNIQUE (production_receipt_id, artifact_id)
```

- 未来外键指向真实的 `work_runs.id`。

## 6. 禁用前缀表（S8 脚本消费）

产品响应的 leaf 路径中，下列前缀一律禁止：

| 禁用前缀          | 原因                      |
| ----------------- | ------------------------- |
| `root_task`       | technical id 泄漏到产品面 |
| `team_run`        | 同上                      |
| `team_member_run` | 同上                      |
| `team_version`    | 同上                      |
| `compiled_`       | 已删除的历史表            |
| `node_execution`  | 已删除的历史表            |

---

## 7. 本裁决**不**决定什么

- 不决定 HTTP 路由路径。那是 S4 与 S10 的事。
- 不决定 Work 的状态机。按 D9，Work 没有状态机，只有 `archived_at`。
- 不修 `environment_definitions` 的 tenant 范围隔离缺口。S8 将它标为已知 gap。
- 不实现 Attention。它是 Artifact 之后的候选。
