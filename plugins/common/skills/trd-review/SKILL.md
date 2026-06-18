---
name: trd-review
description: >
  TRD 综合评审工具。输入飞书 TRD 文档链接，从 4 个维度并行评审：
  通用质量、接口说明完整性、资金安全、监控覆盖缺口。
  发现问题按严重程度分级，直接划线评论写回飞书原文。
  触发词：TRD评审、评审TRD、review TRD、trd review、检查TRD质量。

version: 2.1.1
author: donny
user_invocable: true
model: opus
allowed-tools: ["*"]
---

# TRD 综合评审

输入飞书 TRD 文档链接，4 个维度并行找问题，按严重程度分级列出，直接划线评论写回原文。

## 触发条件

- 用户提供 TRD 飞书文档链接并要求评审
- 关键词：TRD评审、评审TRD、review TRD、trd review、检查TRD质量

## 命令

```
/trd-review <trd_url>                    # 评审单个 TRD
/trd-review <trd_url> --biz=<业务线>     # 指定业务线（影响资金安全模块关注点）
```

---

## 评审模块

| 模块 | 评审视角 |
|------|---------|
| A. 通用质量 | 接口定义、业务规则、边界异常、数据结构、安全合规、NFR、可测试性、工程化 |
| B. 接口说明 | 请求参数来源、响应映射、枚举完整性、计算字段公式、实现逻辑、调用链、错误码 |
| C. 资金安全 | 架构方案、对账、接口设计、资金流控、状态机、幂等重试、监控告警、应急演练 |
| D. 监控覆盖 | 组件监控维度覆盖度、FMEA 故障模式、通知策略完整性 |

4 个模块全部执行，不做跳过。模块 C 内部保留"资金相关性预判"，不涉及资金时输出简短结论。

---

## 执行流程

### Phase 1：参数解析

提取 `TRD_URL` 和 wiki/docx token。初始化工作目录 `/tmp/trd_review_<timestamp>/`。

---

### Phase 2：文档读取

通过 `lark-feishu-tools` 读取飞书文档保存为 `source.md`。

---

### Phase 3：并行评审（4 模块同时 dispatch）

主控 Read references 文件内联到各 Agent prompt：
- `<SKILL_DIR>/references/module-quality.md` → Agent A
- `<SKILL_DIR>/references/module-api.md` → Agent B
- `<SKILL_DIR>/references/module-funding-safety.md` → Agent C
- `<SKILL_DIR>/references/module-monitor.md` → Agent D

**在同一条消息中 dispatch 4 个 Sonnet Agent**，每个 Agent 的任务是：

1. Read source.md 和对应 references
2. 按维度标准逐项审查，找出所有问题
3. 每个问题标注严重程度：🔴 严重 / 🟡 中等 / 🟢 建议
4. 每个问题必须包含：`evidence_quote`（原文片段，用于 locate）+ `description` + `suggestion`
5. Write JSON 到 `<WORK_DIR>/review-{module}.json`

**输出 JSON schema（所有模块统一）**：

```json
{
  "module": "quality/api/funding_safety/monitor",
  "is_applicable": true,
  "issues": [
    {
      "severity": "high/medium/low",
      "dimension": "问题所属维度名",
      "description": "一句话问题描述",
      "evidence_quote": "TRD 原文片段（用于 locate 定位）",
      "impact": "对测试/上线的影响",
      "suggestion": "可操作的改进建议"
    }
  ],
  "summary": "一句话总结本模块发现"
}
```

**严重程度定义**：
- 🔴 **严重（high）**：导致测试无法执行、可能产生线上事故或资损
- 🟡 **中等（medium）**：降低测试效率、需额外确认才能继续
- 🟢 **建议（low）**：提升文档质量和可维护性

**Agent 原则**：
- 基于文档现有内容审查，不假设文档外信息
- 每个问题必须引用原文（evidence_quote），不能泛泛而谈
- 不凑数：同一问题不拆多条，不同问题不合并
- 不空话：每条建议必须可操作（PM/研发能据此修改）
- 模块 C 不涉及资金时：`is_applicable=false`, `issues=[]`

---

### Phase 4：结果收集 & 汇总

读取 4 个 JSON，按严重程度合并排序：

```
all_issues = 按 severity 排序（high → medium → low），同级按模块 A→B→C→D
```

---

### Phase 5：划线评论写回飞书

#### 工具

```
EXECUTOR=~/.claude/plugins/cache/ai-coding-marketplace/lark-feishu-tools/0.1.9/skills/feishu-drive/scripts/executor.mjs
```

#### 流程：locate → create

```bash
# Step 1: 定位段落
node $EXECUTOR feishu_doc_comments '{"action":"locate","file_token":"<obj_token>","file_type":"docx","text":"<evidence_quote>","limit":3}'

# Step 2: 写入评论
node $EXECUTOR feishu_doc_comments '{"action":"create","file_token":"<obj_token>","file_type":"docx","block_id":"<block_id>","elements":[{"type":"text","text":"<评论>"}]}'
```

#### 评论格式

```
[🔴 严重 / 🟡 中等] 问题描述
影响：具体影响
建议：可操作建议
```

#### 规则

1. 只写 🔴 和 🟡，🟢 不写回（避免噪音）
2. 逐条 locate → create，用 `evidence_quote` 定位
3. locate 失败（match_count=0）：缩短 text 重试一次，仍失败则跳过
4. create 失败：输出到终端，不重试
5. **上限 10 条**，优先 🔴 再 🟡
6. 评论面向研发/PM，不含函数名/DB 字段等纯技术术语

---

### 最终输出

在 chat 中展示：

```
📄 TRD 综合评审完成！

✏️ 已写入 X 条划线评论（🔴 ×M，🟡 ×N）
   4 模块原始问题共 T 条，跨模块去重后为 ~U 条独立问题。
   划线评论按规则上限 10 条，优先 🔴 再 🟡，同类问题合并为一条
   （如 XXX 在 A/C/D 模块均有发现，合并写入 1 条评论）。

🔴 严重问题（X 条）：
1. [模块X] 问题描述
2. ...

🟡 中等问题（Y 条）：
1. [模块X] 问题描述
2. ...

🟢 建议（Z 条）：
1. [模块X] 问题描述
2. ...

📝 完整报告：<WORK_DIR>/report.md
```

**去重说明**：最终输出必须说明从原始问题到划线评论的筛选逻辑，包括：
1. 4 模块原始问题总数
2. 跨模块去重后的独立问题数（同一问题在多个模块出现只算一条）
3. 从独立问题中按优先级选取 10 条的策略
4. 举例说明哪些问题被合并（让用户理解为什么写了 N 条而非全部）

同时将完整问题列表写入 `<WORK_DIR>/report.md`。

---

## 错误处理

| 场景 | 处理 |
|------|------|
| URL 解析失败 | Phase 1 中止 |
| 文档无权限 | Phase 2 中止 |
| 模块 Agent 失败 | 标 [评审失败]，不阻塞其他模块 |
| 划线评论权限不足 | 输出到终端，继续 |
| 文档过长 | 完整评审 |

---

## 注意事项
1. **不打分**：只列问题，不给分数
2. **全量评估**：4 模块全部执行
3. **并行执行**：4 Agent 同时 dispatch
4. **划线评论面向人**：PM/研发能读懂并据此修改
5. **输出语言**：中文

<!-- telemetry:v5 -->
## 权限校验（必须执行）

从本文件顶部的 YAML frontmatter（`---` 包裹的元数据块）中读取 `name` 字段值，作为下方所有 `skill_name` 参数的实际值。

在执行本 skill 的任何工作流步骤之前，**必须**先调用：
`track_skill_usage(skill_name="<从frontmatter.name获取>", action="start")`

只有返回 `"status": "ok"` 才允许继续执行。

**工作流完成后**，必须调用：
`track_skill_usage(skill_name="<从frontmatter.name获取>", action="end", status="<status>")`

status 取值：
- `completed` — 正常完成
- `failed` — 执行失败，需附加 `error_summary` 参数
- `partial` — 部分完成（被用户中断或跳过了步骤）
- `cancelled` — 用户主动取消
<!-- /telemetry -->
