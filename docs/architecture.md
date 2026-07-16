# Architecture

## System Overview

Agent Server is an orchestration layer that connects Lark/Feishu messaging to AI agents (Claude Code) via the Paseo daemon.

```
┌─────────────────────────────────────────────────────────────┐
│                        Agent Server                          │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  HTTP API    │  │  MCP Server  │  │ Lark Consumer    │  │
│  │  (Hono)      │  │  (Streamable)│  │ (lark-cli event) │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────────┘  │
│         │                  │                  │              │
│         └──────────────────┴──────────────────┘              │
│                            │                                 │
│                    ┌───────▼────────┐                        │
│                    │  PaseoClient   │                        │
│                    │  (WebSocket)   │                        │
│                    └───────┬────────┘                        │
└────────────────────────────┼────────────────────────────────┘
                             │ ws://127.0.0.1:6767/ws
                    ┌────────▼────────┐
                    │  Paseo Daemon   │
                    │  (Agent Mgmt)   │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │ Agent 1  │  │ Agent 2  │  │ Agent N  │
        │(Claude)  │  │(Claude)  │  │(Claude)  │
        └──────────┘  └──────────┘  └──────────┘
```

## Components

### HTTP API (`src/api/`)

REST API for external agent management:
- `GET /api/health` — Health check
- `GET /api/v1/agents` — List active agents
- `POST /api/v1/agents` — Create agent
- `GET /api/v1/agents/:id` — Get agent details
- `POST /api/v1/agents/:id/send` — Send prompt to existing agent
- `GET /api/v1/agents/:id/stream` — SSE event stream
- `DELETE /api/v1/agents/:id` — Stop and archive agent

Auth: Optional bearer token via `API_KEY` env var.

### MCP Server (`src/mcp/`)

Exposes agent operations as MCP tools for other AI systems:
- `create_agent`, `list_agents`, `get_agent`, `send_prompt`, `stop_agent`

Transport: HTTP Streamable with SSE (session-based).

### Lark Event Consumer (`src/lark-event/consumer.ts`)

Persistent background process:
1. Spawns `lark-cli event consume im.message.receive_v1 --as bot`
2. Reads NDJSON output line-by-line
3. Filters text messages, strips @mentions
4. Creates agent per message with reply instructions

### Paseo Client (`src/paseo-client/index.ts`)

WebSocket client implementing the Paseo protocol:
- Session envelope wrapping (`{ type: 'session', message: {...} }`)
- Request-response correlation via `requestId`
- Agent cache updated by `agent_update` events
- Exponential backoff reconnection (1s → 30s)
- Event subscription for SSE streaming

### Proxy Service (`proxy-service/`)

Separate deployment on internal network (JumpServer). Provides MCP tools for:
- Git clone from internal repos (returns tar.gz as base64)
- Connectivity verification

## Agent Lifecycle

```
CREATE → RUNNING → IDLE/STOPPED → ARCHIVED
         ↑    ↓
         └────┘ (sendPrompt resumes)
```

1. **CREATE**: `createAgent()` sends `create_agent_request` via WebSocket
2. **RUNNING**: Paseo spawns Claude Code process, streams output
3. **IDLE**: Agent completes task, awaits further prompts
4. **STOP**: `cancel_agent_request` terminates execution
5. **ARCHIVE**: `archive_agent_request` removes from active list

## Startup Sequence

1. HTTP server starts immediately (health check ready)
2. Create non-root `agent` user
3. Configure lark-cli (app credentials)
4. Install skills and global CLAUDE.md
5. Start Paseo daemon (foreground, no relay)
6. Poll Paseo health endpoint (max 30s)
7. Connect PaseoClient WebSocket
8. Start Lark event consumer

## Security Model

- Agents run as non-root `agent` user
- Paseo daemon runs under same user
- lark-cli authenticates as bot (not user token)
- API key auth optional but recommended for HTTP API
- Claude Code runs with `bypassPermissions` mode for Lark agents
