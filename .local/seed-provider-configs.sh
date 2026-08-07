#!/bin/sh
# Local-only ops glue. The runner image ships the claude, codex and opencode
# CLIs (PR #30) but nothing configures them, so a claude member answers only
# "Not logged in · Please run /login" and a codex member cannot reach any host.
# Run this inside the agent-server container after the stack is up:
#
#   docker exec <project>-agent-server-1 sh /workspace/.local/seed-provider-configs.sh
#
# It reads OPENCODE_GO_API_KEY from the container environment and never prints
# it. HOME is /workspace/.local/home, which lives on the local-state volume, so
# the configs survive container restarts but not a volume reset.
set -e

if [ -z "$OPENCODE_GO_API_KEY" ]; then
  echo "OPENCODE_GO_API_KEY is not set in this container" >&2
  exit 1
fi

mkdir -p "$HOME/.claude" "$HOME/.codex"

# ANTHROPIC_BASE_URL must NOT carry /v1 — the Anthropic SDK appends /v1/messages
# itself, and the gateway 404s on /v1/v1/messages. The key must be
# ANTHROPIC_API_KEY, not ANTHROPIC_AUTH_TOKEN: the gateway only reads x-api-key
# and answers 401 "Missing API key" to an Authorization: Bearer header.
cat > "$HOME/.claude/settings.json" <<JSON
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://opencode.ai/zen/go",
    "ANTHROPIC_API_KEY": "$OPENCODE_GO_API_KEY",
    "ANTHROPIC_MODEL": "deepseek-v4-flash"
  }
}
JSON
chmod 600 "$HOME/.claude/settings.json"

# wire_api must be "responses": codex 0.146 rejects "chat_completions" with
# `unknown variant, expected responses`. The gateway does serve
# /v1/chat/completions much faster, but codex cannot speak it.
cat > "$HOME/.codex/config.toml" <<'TOML'
model_provider = "opencode-go"
model = "deepseek-v4-flash"

[model_providers.opencode-go]
name = "OpenCode Go"
base_url = "https://opencode.ai/zen/go/v1"
env_key = "OPENCODE_GO_API_KEY"
wire_api = "responses"
TOML

echo "seeded: $HOME/.claude/settings.json (mode 600), $HOME/.codex/config.toml"
