# Agent Server

AI agent orchestration server that bridges Lark/Feishu messaging with Claude Code agents via Paseo daemon.

## Architecture

```
Lark Events → LarkEventConsumer → PaseoClient (WebSocket) → Paseo Daemon → Claude Code Agent
                                                                              ↓
HTTP API (Hono) → REST /api/v1/agents/*  ←──────────────────────── Agent Output
MCP Server → Tools (create/list/get/send/stop)                       ↓
                                                              lark-cli im +send → Lark Reply
```

## Key Components

| Component | Path | Purpose |
|-----------|------|---------|
| Entry point | `src/index.ts` | Daemon orchestration, startup sequence |
| Paseo client | `src/paseo-client/index.ts` | WebSocket protocol to Paseo daemon |
| Lark consumer | `src/lark-event/consumer.ts` | Consumes `im.message.receive_v1` events |
| HTTP API | `src/api/routes/agents.ts` | REST endpoints for agent CRUD |
| MCP server | `src/mcp/server.ts` | MCP tool definitions |
| Types | `src/types/index.ts` | Zod schemas and response types |
| Runtime env | `runtime/CLAUDE.md` | Global instructions for spawned agents |
| Proxy service | `proxy-service/` | Internal network MCP proxy (separate service) |

## Tech Stack

- **Runtime**: Node.js 20, TypeScript, ESM
- **HTTP**: Hono framework + `@hono/node-server`
- **Agent**: Paseo daemon + Claude Code (`@anthropic-ai/claude-code`)
- **Lark**: `@larksuite/cli` (lark-cli) for auth, events, messaging
- **MCP**: `@modelcontextprotocol/sdk` for tool exposure
- **Validation**: Zod
- **Test**: Vitest

## Development

```bash
npm run dev          # tsx watch mode
npm run build        # TypeScript compile + skills + config
npm run test         # vitest
npm run test:e2e     # E2E against running server
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No (3000) | HTTP server port |
| `API_KEY` | No | Bearer token for API auth |
| `LARK_APP_ID` | Yes* | Feishu app ID |
| `LARK_APP_SECRET` | Yes* | Feishu app secret |
| `LARK_EVENT_ENABLED` | No (true) | Enable Lark event consumer |
| `LARK_AGENT_MODEL` | No | Model for Lark-spawned agents |
| `LARK_AGENT_CWD` | No | Working dir for agents |
| `PASEO_ENABLED` | No (true) | Enable Paseo daemon |
| `PASEO_WS_URL` | No | WebSocket URL (ws://127.0.0.1:6767/ws) |
| `PASEO_HOME` | No | Paseo state directory |
| `ANTHROPIC_BEDROCK_BASE_URL` | No | LiteLLM/Bedrock proxy URL |
| `ANTHROPIC_AUTH_TOKEN` | No | API key for LLM access |

\* Required for Lark integration

## Key Design Decisions

- **lark-cli over SDK**: All Lark operations use CLI binary (handles auth, event streaming)
- **Non-root execution**: Agents run as `agent` user for security
- **Event-driven sessions**: Each Lark message creates a new agent (no thread continuity yet)
- **Paseo as daemon**: Long-running process managing agent lifecycles via WebSocket
- **Fire-and-forget for side effects**: Reactions, archive operations don't block

## Lark Message Flow

1. `lark-cli event consume` streams NDJSON events
2. Consumer filters for `im.message.receive_v1` + `text` type
3. Strips @mention, deduplicates by `event_id`, sends OK reaction
4. Determines thread context (`root_id` → existing thread, or `message_id` → new thread)
5. If thread has existing session → `sendPrompt` to reuse agent
6. If no session (or agent dead) → create new agent, store session mapping
7. Agent replies via `lark-cli im +messages-reply --message-id <thread_root> --reply-in-thread`

### Thread Session Behavior

- New @mention → creates agent, stores `message_id` as thread root
- Reply in same thread → reuses existing agent via `sendPrompt`
- `/new` command in thread → resets session, next message creates fresh agent
- Session TTL: 1 hour (configurable via `sessionTtl` option)
- Agent archived/stopped → session auto-cleaned
