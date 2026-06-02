#!/bin/bash
set -e
API="http://localhost:13000/api/v1"
DEMO_DIR="demo-$(date +%s)"

echo "╔══════════════════════════════════════════╗"
echo "║      Agent Server Demo                   ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "━━━ API 一览 ━━━"
echo ""
echo "  Base URL: http://localhost:13000/api/v1"
echo ""
echo "  GET    /api/health          健康检查（无需认证）"
echo "  POST   /agents              创建 Agent 并提交任务"
echo "  GET    /agents              列出所有活跃 Agent"
echo "  GET    /agents/:id          查询 Agent 状态"
echo "  POST   /agents/:id/send     向 Agent 追加指令"
echo "  DELETE /agents/:id          停止并归档 Agent"
echo "  GET    /agents/:id/stream   SSE 实时流式输出"
echo ""
echo "  本次演示目录: /workspace/$DEMO_DIR"
echo ""

# 在容器内预先创建 workspace 目录
docker exec agent-server mkdir -p /workspace/$DEMO_DIR

echo "━━━ 1. Health Check ━━━"
echo ""
echo "  \$ curl -s http://localhost:13000/api/health"
echo ""
curl -s http://localhost:13000/api/health | jq
echo ""

echo "━━━ 2. 创建 Agent 并通过 SSE 观察执行过程 ━━━"
echo ""
echo '  $ curl -s -X POST http://localhost:13000/api/v1/agents \'
echo '    -H "Content-Type: application/json" \'
echo "    -d {\"prompt\":\"...\",\"provider\":\"claude\",\"model\":\"claude-haiku-4-5\",\"mode\":\"bypassPermissions\",\"cwd\":\"/workspace/$DEMO_DIR\"}"
echo ""
RESULT=$(curl -s -X POST $API/agents \
  -H "Content-Type: application/json" \
  -d "{\"prompt\":\"创建 demo.py，内容是: import datetime; print(f'Hello from Agent Server! Time: {datetime.datetime.now()}'). 完成后告诉我。\",\"provider\":\"claude\",\"model\":\"claude-haiku-4-5\",\"mode\":\"bypassPermissions\",\"cwd\":\"/workspace/$DEMO_DIR\"}")
echo $RESULT | jq '{success, id: .data.id, status: .data.status, cwd: .data.cwd, mode: .data.currentModeId}'
AGENT_ID=$(echo $RESULT | jq -r '.data.id')
echo ""
echo "  → Agent ID: $AGENT_ID"
echo ""

echo "━━━ 3. SSE 流式输出 — 实时观察 Agent 执行过程 ━━━"
echo ""
echo "  \$ curl -N http://localhost:13000/api/v1/agents/\$AGENT_ID/stream"
echo ""
echo "  (实时接收 Agent 的思考和操作事件，15 秒后自动断开...)"
echo ""
( curl -s -N $API/agents/$AGENT_ID/stream & CURL_PID=$!; sleep 15; kill $CURL_PID 2>/dev/null ) 2>/dev/null || true
echo ""
echo ""

echo "━━━ 4. 查看 Agent 状态 ━━━"
echo ""
echo "  \$ curl -s http://localhost:13000/api/v1/agents/\$AGENT_ID"
echo ""
curl -s $API/agents/$AGENT_ID | jq '.data | {id, status, title}'
echo ""

echo "━━━ 5. 列出所有活跃 Agent ━━━"
echo ""
echo "  \$ curl -s http://localhost:13000/api/v1/agents"
echo ""
curl -s $API/agents | jq '[.data[] | {id: (.id // .agent.id), status: (.status // .agent.status), title: (.title // .agent.title)}]'
echo ""

echo "━━━ 6. 向 Agent 追加新任务 + 流式观察 ━━━"
echo ""
echo '  $ curl -s -X POST http://localhost:13000/api/v1/agents/$AGENT_ID/send \'
echo '    -d {"prompt":"再创建一个 greeting.py..."}'
echo ""
curl -s -X POST $API/agents/$AGENT_ID/send \
  -H "Content-Type: application/json" \
  -d '{"prompt":"再创建一个 greeting.py，内容是打印一句中文问候语。"}' | jq
echo ""
echo "  (流式观察追加任务的执行，10 秒后断开...)"
echo ""
( curl -s -N $API/agents/$AGENT_ID/stream & CURL_PID=$!; sleep 10; kill $CURL_PID 2>/dev/null ) 2>/dev/null || true
echo ""
echo ""

echo "━━━ 7. 验证容器内文件 ━━━"
echo ""
echo "  \$ docker exec agent-server ls -la /workspace/$DEMO_DIR/"
echo ""
docker exec agent-server ls -la /workspace/$DEMO_DIR/ 2>/dev/null || echo "  (文件可能仍在创建中)"
echo ""
echo "  \$ docker exec agent-server cat /workspace/$DEMO_DIR/demo.py"
echo ""
docker exec agent-server cat /workspace/$DEMO_DIR/demo.py 2>/dev/null || true
echo ""
echo "  \$ docker exec agent-server cat /workspace/$DEMO_DIR/greeting.py"
echo ""
docker exec agent-server cat /workspace/$DEMO_DIR/greeting.py 2>/dev/null || true
echo ""

echo "━━━ 8. 停止并归档 Agent ━━━"
echo ""
echo "  \$ curl -s -X DELETE http://localhost:13000/api/v1/agents/\$AGENT_ID"
echo ""
curl -s -X DELETE $API/agents/$AGENT_ID | jq
echo ""

echo "━━━ 9. 输入校验演示 ━━━"
echo ""
echo '  $ curl -s -X POST http://localhost:13000/api/v1/agents -d {"prompt":""}'
echo ""
echo "  → 空 prompt (期望 400):"
curl -s -X POST $API/agents \
  -H "Content-Type: application/json" \
  -d '{"prompt":""}' | jq '{success, error}'
echo ""
echo '  $ curl -s http://localhost:13000/api/v1/agents/nonexistent-agent-id'
echo ""
echo "  → 不存在的 Agent (期望 404):"
curl -s $API/agents/nonexistent-agent-id-12345 | jq '{success, error}'
echo ""

echo "╔══════════════════════════════════════════╗"
echo "║      演示完成 ✓                          ║"
echo "╚══════════════════════════════════════════╝"
