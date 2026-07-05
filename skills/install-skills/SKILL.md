---
name: install-skills
description: >
  安装或更新 QA Marketplace Skills。通过 proxy MCP 从内网 GitLab 拉取 qa-marketplace 仓库，
  按照配置安装指定 skills 到 Claude Code plugins 目录，使后续新 session 能发现并使用这些 skills。
  触发词：安装skills、install skills、更新skills、update skills。
version: 1.0.0
author: agent-server
user_invocable: true
allowed-tools:
  - Bash
  - Read
  - Write
---

# Install Skills

从 QA Marketplace 仓库安装 skills 到当前环境。

## 执行步骤

### 1. 读取配置

读取 skills 配置文件确定要安装哪些 skills：

```bash
cat /data/services/zzz-test-agent-server-*/bin/.skills-config.json
```

配置格式：
```json
{
  "repo": "qa-marketplace",
  "plugins": {
    "<plugin-name>": {
      "skills": ["skill-1", "skill-2"]
    }
  }
}
```

### 2. 通过 Proxy MCP 拉取仓库

对配置中的每个 plugin，通过 Gateway 调用 proxy-service 的 echo tool 获取 plugin 内容：

```bash
GW_URL="http://mcp-gateway-v2-prod.ai-agw.ww5sawfyut0k.bitsvc.io/api/v1/mcps/agent-server-proxy/mcp"
API_KEY="e29ddfd399014d729c897307f8bbadeb"

# 初始化 session
SID=$(curl -s -D /dev/stdout --max-time 10 -X POST "$GW_URL" \
  -H "X-API-KEY: $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "X-USER-EMAIL: link.ye@bybit.com" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"skill-installer","version":"1.0"}}}' \
  -o /dev/null 2>/dev/null | grep -i mcp-session-id | tr -d '\r' | awk '{print $2}')

# 等待 5s warmup
sleep 5

# 拉取 plugin (每个 plugin 需要独立 session)
curl -s --max-time 120 -X POST "$GW_URL" \
  -H "X-API-KEY: $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "X-USER-EMAIL: link.ye@bybit.com" \
  -H "Mcp-Session-Id: $SID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"echo","arguments":{"message":"{\"repo\":\"qa-marketplace\",\"plugin\":\"<PLUGIN_NAME>\"}"}}}' \
  -o /tmp/<PLUGIN_NAME>.response
```

**重要**: Gateway 每个 session 只能成功调用 echo 一次。如需拉取多个 plugin，每个 plugin 创建独立 session，间隔 15 秒避免 rate limit。

### 3. 解码并解包

```bash
python3 -c "
import json, base64
data = open('/tmp/<PLUGIN_NAME>.response').read()
for line in data.split('\n'):
  if line.startswith('data: '):
    j = json.loads(line[6:])
    for c in j.get('result',{}).get('content',[]):
      if c.get('type')=='resource':
        with open('/tmp/<PLUGIN_NAME>.tar.gz','wb') as f:
          f.write(base64.b64decode(c['resource']['blob']))
        print(f'Saved: {len(base64.b64decode(c[\"resource\"][\"blob\"]))} bytes')
"
mkdir -p /tmp/src-<PLUGIN_NAME>
tar -xzf /tmp/<PLUGIN_NAME>.tar.gz -C /tmp/src-<PLUGIN_NAME>
```

解包后结构为 `/tmp/src-<PLUGIN_NAME>/<PLUGIN_NAME>/skills/...`

### 4. 安装指定 skills

按配置只安装需要的 skills（不是全部）：

```bash
PLUGINS_DIR="/home/agent/.claude/plugins"

# 为每个 plugin 创建目录
mkdir -p "$PLUGINS_DIR/<PLUGIN_NAME>/.claude-plugin"
mkdir -p "$PLUGINS_DIR/<PLUGIN_NAME>/skills"

# 只复制配置中指定的 skills
cp -r /tmp/src-<PLUGIN_NAME>/<PLUGIN_NAME>/skills/<SKILL_NAME> "$PLUGINS_DIR/<PLUGIN_NAME>/skills/"
```

### 5. 生成 plugin.json (只声明要启用的 skills)

```bash
cat > "$PLUGINS_DIR/<PLUGIN_NAME>/.claude-plugin/plugin.json" << EOF
{
  "name": "<PLUGIN_NAME>",
  "version": "1.0.0",
  "skills": [
    "./skills/<skill-1>",
    "./skills/<skill-2>"
  ]
}
EOF
```

### 6. 更新 settings.json

```bash
# 读取现有 settings 或创建新的
cat > /home/agent/.claude/settings.json << EOF
{
  "enabledPlugins": {
    "<plugin1>": true,
    "<plugin2>": true
  },
  "permissions": {
    "allow": ["Bash(*)", "Read(*)", "Write(*)", "Edit(*)", "Glob(*)", "Grep(*)", "Agent(*)"],
    "deny": []
  }
}
EOF
```

### 7. 修复权限

```bash
chown -R agent:agent /home/agent/.claude/plugins/ /home/agent/.claude/settings.json
```

### 8. 验证

```bash
find /home/agent/.claude/plugins/ -name SKILL.md
```

## 完成

安装完成后，下一个新建的 agent session 将自动发现并加载这些 skills。无需重启任何服务。

## 故障排查

- **proxy MCP 返回 195/180 bytes**: Token 为空或 proxy service 挂了，检查 JumpServer 上 port 3000
- **Gateway 429 rate limit**: 等待 60s 后重试
- **Gateway "Bad Request"**: session 只能用一次 echo，创建新 session
- **Skills 不可见**: 确认文件在 `~/.claude/plugins/<plugin>/skills/<name>/SKILL.md`，且 plugin.json 声明了该 skill
