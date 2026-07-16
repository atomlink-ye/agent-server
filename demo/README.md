# Agent Server 演示脚本

> 前提：Docker 容器已启动 (`docker compose up -d`)，API 在 `http://localhost:13000`

## 0. 确认服务健康

```bash
curl -s http://localhost:13000/api/health | jq
```

预期输出：
```json
{"status": "ok", "timestamp": "2026-05-18T..."}
```

---

## 1. 创建 Agent — 让它写一个 Python 脚本

```bash
curl -s -X POST http://localhost:13000/api/v1/agents \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "在 /workspace 下创建一个 hello.py，内容是打印当前时间和一句问候语。完成后告诉我文件路径。",
    "provider": "claude",
    "model": "claude-haiku-4-5",
    "mode": "bypassPermissions"
  }' | jq
```

> 记下返回的 `data.id`，后续步骤用 `$AGENT_ID` 代替

```bash
export AGENT_ID=<粘贴上面返回的 id>
```

---

## 2. 查看 Agent 状态

```bash
curl -s http://localhost:13000/api/v1/agents/$AGENT_ID | jq '.data | {id, status, title}'
```

---

## 3. 列出所有 Agent

```bash
curl -s http://localhost:13000/api/v1/agents | jq '.data | length'
```

---

## 4. SSE 实时流式输出（打开新终端窗口演示）

```bash
curl -N http://localhost:13000/api/v1/agents/$AGENT_ID/stream
```

> 会持续输出 SSE 事件，按 Ctrl+C 断开

---

## 5. 给 Agent 追加新任务

```bash
curl -s -X POST http://localhost:13000/api/v1/agents/$AGENT_ID/send \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "再创建一个 goodbye.py，打印告别语。"
  }' | jq
```

---

## 6. 验证 Agent 在容器内创建了文件

```bash
docker exec agent-server ls -la /workspace/
```

---

## 7. 停止并归档 Agent

```bash
curl -s -X DELETE http://localhost:13000/api/v1/agents/$AGENT_ID | jq
```

---

## 8. 演示输入校验

```bash
# 空 prompt — 400 错误
curl -s -X POST http://localhost:13000/api/v1/agents \
  -H "Content-Type: application/json" \
  -d '{"prompt": ""}' | jq

# 不存在的 Agent — 404
curl -s http://localhost:13000/api/v1/agents/nonexistent-id | jq
```

---

## 快速一键演示（全流程）

```bash
#!/bin/bash
set -e
API="http://localhost:13000/api/v1"

echo "=== 1. Health Check ==="
curl -s http://localhost:13000/api/health | jq

echo -e "\n=== 2. Create Agent ==="
RESULT=$(curl -s -X POST $API/agents \
  -H "Content-Type: application/json" \
  -d '{"prompt":"创建 /workspace/demo.py，内容: print(\"Hello from Agent Server!\")","provider":"claude","model":"claude-haiku-4-5"}')
echo $RESULT | jq
AGENT_ID=$(echo $RESULT | jq -r '.data.id')
echo "Agent ID: $AGENT_ID"

echo -e "\n=== 3. Wait & Check Status ==="
sleep 5
curl -s $API/agents/$AGENT_ID | jq '.data | {id, status, title}'

echo -e "\n=== 4. List All Agents ==="
curl -s $API/agents | jq '.data | map({id, status, title: .title // .agent.title})'

echo -e "\n=== 5. Send Follow-up ==="
curl -s -X POST $API/agents/$AGENT_ID/send \
  -H "Content-Type: application/json" \
  -d '{"prompt":"再创建 /workspace/demo2.py，内容: print(\"Second file!\")"}' | jq

echo -e "\n=== 6. Check Files in Container ==="
sleep 5
docker exec agent-server ls -la /workspace/*.py 2>/dev/null || echo "(files may still be creating)"

echo -e "\n=== 7. Archive Agent ==="
curl -s -X DELETE $API/agents/$AGENT_ID | jq

echo -e "\n=== Done! ==="
```
