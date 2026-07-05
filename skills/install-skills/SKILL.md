---
name: install-skills
description: >
  安装或更新 QA Marketplace Skills。通过 proxy MCP 从内网 GitLab 拉取 qa-marketplace 仓库，
  按照配置安装指定 skills 到 ~/.claude/skills/ 目录（standalone skills，自动发现）。
  触发词：安装skills、install skills、更新skills、update skills。
version: 1.1.0
author: agent-server
user_invocable: true
allowed-tools:
  - Bash
  - Read
  - Write
---

# Install Skills

从 QA Marketplace 安装 skills 到 `~/.claude/skills/`（standalone 路径，自动被 Claude Code 发现）。

## 执行步骤

### 1. 读取配置

```bash
cat /data/services/zzz-test-agent-server-*/bin/.skills-config.json
```

### 2. 拉取 plugin 内容

对每个 plugin 分别创建独立 Gateway session（每个 session 只能调用一次 echo tool）：

```bash
GW_URL="http://mcp-gateway-v2-prod.ai-agw.ww5sawfyut0k.bitsvc.io/api/v1/mcps/agent-server-proxy/mcp"
API_KEY="e29ddfd399014d729c897307f8bbadeb"

# 初始化 + 拉取 (每个 plugin 独立执行，间隔 15s)
SID=$(curl -s -D /dev/stdout --max-time 10 -X POST "$GW_URL" \
  -H "X-API-KEY: $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "X-USER-EMAIL: link.ye@bybit.com" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"installer","version":"1.0"}}}' \
  -o /dev/null 2>/dev/null | grep -i mcp-session-id | tr -d '\r' | awk '{print $2}')

sleep 5

curl -s --max-time 120 -X POST "$GW_URL" \
  -H "X-API-KEY: $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "X-USER-EMAIL: link.ye@bybit.com" \
  -H "Mcp-Session-Id: $SID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"echo","arguments":{"message":"{\"repo\":\"qa-marketplace\",\"plugin\":\"<PLUGIN>\"}"}}}' \
  -o /tmp/<PLUGIN>.resp
```

**重要**: 每个 plugin 需要独立 session，间隔 15 秒避免 rate limit。

### 3. 解码解包

```bash
python3 -c "
import json, base64
data = open('/tmp/<PLUGIN>.resp').read()
for line in data.split(chr(10)):
  if line.startswith('data: '):
    j = json.loads(line[6:])
    for c in j.get('result',{}).get('content',[]):
      if c.get('type')=='resource':
        with open('/tmp/<PLUGIN>.tar.gz','wb') as f:
          f.write(base64.b64decode(c['resource']['blob']))
"
mkdir -p /tmp/src-<PLUGIN>
tar -xzf /tmp/<PLUGIN>.tar.gz -C /tmp/src-<PLUGIN>
```

解包结构: `/tmp/src-<PLUGIN>/<PLUGIN>/skills/<SKILL_NAME>/SKILL.md`

### 4. 安装到 ~/.claude/skills/ (standalone)

```bash
# 直接复制到 standalone skills 目录（自动被 Claude Code 发现）
cp -r /tmp/src-<PLUGIN>/<PLUGIN>/skills/<SKILL_NAME> /home/agent/.claude/skills/
chown -R agent:agent /home/agent/.claude/skills/
```

**不需要 plugin.json、settings.json 或 installed_plugins.json！** Standalone skills 自动发现。

### 5. 验证

```bash
find /home/agent/.claude/skills/ -name SKILL.md
```

## 完成

安装完成后，下一个新建的 agent session 将自动发现所有 `~/.claude/skills/` 下的 skills。无需重启任何服务。

## 注意事项

- Gateway 每个 session 只能成功调用 echo 一次，多个 plugin 需要多个 session
- 调用间隔 15s+ 避免 rate limit (429)
- Proxy MCP 地址: JumpServer 10.21.1.25:3000（cron 保活）
- 如果 proxy 返回 "Clone error: token empty"，需要在 JumpServer 上检查进程
