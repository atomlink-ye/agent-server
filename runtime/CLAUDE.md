# Global Agent Environment

## Lark/Feishu Tools

本环境 **没有** `lark-feishu-tools` 插件（无 `executor.mjs`）。
所有 Skill 中引用 `lark-feishu-tools`、`executor.mjs`、`feishu-doc`、`feishu-wiki`、`feishu-drive` 的操作，
**统一替换为 `lark-cli` 命令**。

lark-cli 已在 PATH 中，认证已完成（bot identity），可直接使用。

---

## 操作替换映射

### 读取飞书文档

```bash
# 替代 feishu_fetch_doc / feishu_wiki_space_node
lark-cli docs +fetch --doc "<url_or_wiki_token>"
```
输出 JSON，文档内容在 `.data.document.content`。

### 划线评论（locate + create 合一）

```bash
# 替代 feishu_doc_comments locate + create 两步
lark-cli drive +add-comment --doc "<doc_token>" --type docx \
  --selection-with-ellipsis "<起始文字>...<结束文字>" \
  --content '[{"type":"text","text":"<评论内容>"}]'
```
- `--selection-with-ellipsis` 用 `...` 连接目标段落起始和结束片段（各 5-15 字）
- 自动调用 MCP locate-doc 定位 block 后创建 local comment
- 定位失败时缩短 selection 重试

### 全文档评论

```bash
lark-cli drive +add-comment --doc "<doc_token>" --type docx \
  --full-comment \
  --content '[{"type":"text","text":"<评论内容>"}]'
```

### 发送 IM 消息

```bash
lark-cli im +send --to "<chat_id>" --content "消息内容"
```

### 获取 wiki 节点

```bash
lark-cli wiki node get --token "<wiki_token>"
```

---

## Plugins / Skills

自定义 Skills 位于 `~/.claude/plugins/common/skills/`，包含：
- `trd-review/` — TRD 综合评审（4 模块并行）
- `case-trd-review/` — TRD 质量评审（8 维度评分）

每个目录下有 `SKILL.md`（流程定义）和 `references/`（评审标准）。

---

## Telemetry

本环境无 `track_skill_usage` MCP 工具。Skill 中的 telemetry 权限校验部分**直接跳过**。

---

## 注意事项

1. 不要尝试安装或调用 `executor.mjs`
2. 所有 Lark API 通过 `lark-cli` 完成
3. `lark-cli` 使用 bot identity，不需要 user token
4. `lark-cli docs +fetch` 支持直接传 wiki URL
