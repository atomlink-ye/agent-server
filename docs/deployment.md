# Deployment

## Docker (Primary)

### Build & Run

```bash
docker compose up -d --build    # Build and start
docker compose logs -f          # Follow logs
docker compose down             # Stop
```

### Ports

| Port | Service |
|------|---------|
| 13000 (host) → 3000 | HTTP API |
| 16767 (host) → 6767 | Paseo daemon |

### Volumes

- `agent-data:/root/.paseo` — Paseo state persistence
- `./workspace:/workspace` — Agent workspace directory

### Container Startup (`docker/start.sh`)

1. Start Paseo daemon (background)
2. Wait for health (30 attempts, 1s interval)
3. Start agent-server
4. Wait for HTTP health (15 attempts)
5. SIGTERM/SIGINT → graceful shutdown

### Health Check

```bash
curl http://localhost:13000/api/health
```

Docker Compose auto-checks every 10s with 3 retries.

## Development

```bash
npm run dev                      # tsx watch mode (hot reload)
npm run test:e2e:local           # Test against local dev server
npm run test:e2e:docker          # Test against Docker instance
```

## Proxy Service

Separate deployment on internal network (JumpServer 10.21.1.25:3000).

See `proxy-service/.local/deployment.md` for JumpServer-specific deployment.

Access via Gateway: `mcp-gateway-v2-prod.ai-agw.ww5sawfyut0k.bitsvc.io` (name: `agent-server-proxy`)

## Environment Setup

1. Copy `.env.example` to `.env` (or set env vars in compose file)
2. Ensure `LARK_APP_ID` and `LARK_APP_SECRET` are set for Lark integration
3. Set `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_BEDROCK_BASE_URL` for LLM access
4. Optional: Set `API_KEY` for HTTP API authentication
