#!/bin/sh
# Local-only ops glue. The runner image ships the claude, codex and opencode
# CLIs (PR #30) but nothing configures them. Without this, a claude member's
# only output is "Not logged in - Please run /login", which the runtime then
# records as a SUCCEEDED provider Run.
#
# CRITICAL: write into the PASEO RUNTIME HOME, not the container's $HOME.
# scripts/dev/paseo-process.mjs starts the daemon under an isolated environment:
#
#   const runtimeRoot = join(repositoryRoot, '.local', 'dev-runtime');
#   const home = join(runtimeRoot, 'home');   //  -> /workspace/.local/dev-runtime/home
#   const environment = { ...createSafeRuntimeEnvironment(), HOME: home, ... };
#
# so every agent process reads /workspace/.local/dev-runtime/home, while a plain
# `docker exec` shell sees /workspace/.local/home. Seeding $HOME therefore
# "works" for a hand-run `claude -p` and does nothing at all for a real member.
# createSafeRuntimeEnvironment() also filters the environment down to an
# allowlist, so injecting ANTHROPIC_* as env vars is not an option either — the
# config files are the only route.
#
# Run after the stack is up (pipe it in: /workspace/.local is a named volume
# that shadows the repo bind, so the committed file is not visible in there):
#
#   docker exec -i <project>-agent-server-1 sh -s < .local/seed-provider-configs.sh
set -e

PROVIDER_HOME="${PROVIDER_HOME:-/workspace/.local/dev-runtime/home}"

if [ -z "$OPENCODE_GO_API_KEY" ]; then
  echo "OPENCODE_GO_API_KEY is not set in this container" >&2
  exit 1
fi

mkdir -p "$PROVIDER_HOME/.claude" "$PROVIDER_HOME/.codex"

# Puts Claude Code in API mode so it never asks for /login.
# ANTHROPIC_BASE_URL must NOT carry /v1 — the Anthropic SDK appends /v1/messages
# itself and the gateway 404s on /v1/v1/messages. The key must be
# ANTHROPIC_API_KEY, not ANTHROPIC_AUTH_TOKEN: the gateway reads x-api-key only
# and answers 401 "Missing API key" to an Authorization: Bearer header.
cat > "$PROVIDER_HOME/.claude/settings.json" <<JSON
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://opencode.ai/zen/go",
    "ANTHROPIC_API_KEY": "$OPENCODE_GO_API_KEY",
    "ANTHROPIC_MODEL": "deepseek-v4-flash"
  }
}
JSON
chmod 600 "$PROVIDER_HOME/.claude/settings.json"

# wire_api must be "responses": codex 0.146 rejects "chat_completions" with
# `unknown variant, expected responses`. The gateway serves /v1/chat/completions
# far faster (1.7s vs 38s on a trivial prompt) but codex cannot speak it.
# env_key resolves from the process environment; OPENCODE_GO_API_KEY is on the
# paseo-process allowlist, so it does reach the agent.
cat > "$PROVIDER_HOME/.codex/config.toml" <<'TOML'
model_provider = "opencode-go"
model = "deepseek-v4-flash"

[model_providers.opencode-go]
name = "OpenCode Go"
base_url = "https://opencode.ai/zen/go/v1"
env_key = "OPENCODE_GO_API_KEY"
wire_api = "responses"
TOML

echo "seeded under $PROVIDER_HOME:"
echo "  .claude/settings.json (mode 600, API mode, no /login)"
echo "  .codex/config.toml"
