.PHONY: setup dev dev-api check-fast web-bootstrap web-dev web-build web-check-types web-e2e-smoke test-web build check test test-unit test-integration test-real-pg test-contract e2e-smoke paseo-smoke eval-smoke ci managed-environment-smoke clean \
	internal-setup internal-dev internal-dev-api internal-build internal-check internal-test internal-test-unit internal-test-integration \
	internal-test-real-pg internal-test-contract internal-test-web internal-e2e-smoke internal-paseo-smoke internal-eval-smoke internal-ci internal-clean \
	setup-native dev-native dev-api-native build-native check-native test-native test-unit-native test-integration-native test-real-pg-native \
	test-contract-native test-web-native e2e-smoke-native paseo-smoke-native eval-smoke-native ci-native clean-native self-learning-team-phase2-smoke self-learning-team-phase3-smoke agent-teams-v2-smoke claude-provider-smoke mixed-team-journey

setup:
	docker compose build agent-server runner
	./scripts/dev/docker-run -- node scripts/dev/resolve-opencode.mjs --check

dev:
	docker compose up --build postgres agent-server

dev-api:
	docker compose up --build postgres agent-server

web-bootstrap:
	mkdir -p .local
	docker compose build runner
	docker compose run --rm --no-deps \
		-e AGENT_SERVER_BASE_URL=http://agent-server:3000 \
		-e AGENT_SERVER_SERVICE_TOKEN="$${AGENT_SERVER_SERVICE_TOKEN:-token-local-dev}" \
		-e WEB_AGENT_VERSION_ID="$${WEB_AGENT_VERSION_ID:-}" \
		-e WEB_ENVIRONMENT_VERSION_ID="$${WEB_ENVIRONMENT_VERSION_ID:-}" \
		-e WEB_AGENTIC_TEAM_VERSION_ID="$${WEB_AGENTIC_TEAM_VERSION_ID:-}" \
		-e WEB_WORKSPACE_NAME="$${WEB_WORKSPACE_NAME:-Web Chat MVE}" \
		-v "$$(pwd)/.local:/workspace/.local" \
		runner node scripts/dev/web-bootstrap.mjs

web-dev:
	docker compose up --build -d postgres agent-server
	@until curl -fsS http://127.0.0.1:3000/health/ready >/dev/null; do sleep 1; done
	$(MAKE) web-bootstrap
	@set -a; . .local/web-bootstrap.env; set +a; docker compose up --build web

web-e2e-smoke:
	@set -eu; \
	wait_for_url() { \
		url="$$1"; \
		deadline=$$(expr $$(date +%s) + 180); \
		while [ $$(date +%s) -lt "$$deadline" ]; do \
			if curl -fsS --max-time 2 "$$url" >/dev/null; then return 0; fi; \
			sleep 1; \
		done; \
		echo "Timed out waiting for $$url" >&2; \
		return 1; \
	}; \
	cleanup() { \
		status="$$?"; \
		docker compose -f compose.yaml -f e2e/compose.web-provider.yaml down --remove-orphans >/dev/null 2>&1 || true; \
		trap - EXIT; \
		exit "$$status"; \
	}; \
	trap 'exit 130' INT; \
	trap 'exit 143' TERM; \
	trap cleanup EXIT; \
	test -n "$${OPENCODE_GO_API_KEY:-}" || { echo 'OPENCODE_GO_API_KEY is required' >&2; exit 1; }; \
	PASEO_PROVIDER=opencode PASEO_MODEL=opencode-go/deepseek-v4-flash docker compose -f compose.yaml -f e2e/compose.web-provider.yaml up --build -d postgres agent-server; \
	wait_for_url http://127.0.0.1:3000/health/ready; \
	$(MAKE) web-bootstrap; \
	PASEO_PROVIDER=opencode PASEO_MODEL=opencode-go/deepseek-v4-flash docker compose -f compose.yaml -f e2e/compose.web-provider.yaml up --build -d web; \
	wait_for_url http://127.0.0.1:3001; \
	WEB_E2E_BASE_URL=http://web.localhost:3001 WEB_E2E_PROVIDER=opencode WEB_E2E_MODEL=opencode-go/deepseek-v4-flash WEB_E2E_ARTIFACT_DIR=/workspace/.local/web-e2e-artifacts ./scripts/dev/docker-run --bind-local --pass-env WEB_E2E_BASE_URL --pass-env WEB_E2E_PROVIDER --pass-env WEB_E2E_MODEL --pass-env WEB_E2E_ARTIFACT_DIR -- pnpm test:e2e:web

test-web:
	./scripts/dev/docker-run -- pnpm test:web

mixed-team-journey:
	@test -n "$${OPENCODE_GO_API_KEY:-}" || { echo 'mixed-team-journey requires OPENCODE_GO_API_KEY' >&2; exit 1; }
	AGENT_SERVER_DISPATCHER_CONCURRENCY=3 PASEO_MODEL=opencode-go/deepseek-v4-flash docker compose up --build -d postgres agent-server
	@for attempt in $$(seq 1 120); do \
		if curl -fsS http://127.0.0.1:3000/health/ready >/dev/null; then break; fi; \
		if [ "$$attempt" -eq 120 ]; then echo 'agent-server did not become ready' >&2; exit 1; fi; \
		sleep 1; \
	done
	@dispatch_log="$$(docker compose logs --no-color --no-log-prefix agent-server | grep '"event":"run.dispatch.started"' | tail -n 1)"; \
		if [ -z "$$dispatch_log" ]; then echo 'agent-server dispatcher startup log not found' >&2; exit 1; fi; \
		printf '%s\n' "$$dispatch_log" | grep -Eq '"event":"run.dispatch.started".*"concurrency":3([,}])' || { \
			echo 'agent-server dispatcher did not start with concurrency=3' >&2; \
			exit 1; \
		}
	AGENT_SERVER_DISPATCHER_CONCURRENCY=3 PASEO_MODEL=opencode-go/deepseek-v4-flash docker compose run --rm --no-deps \
		-e AGENT_SERVER_BASE_URL=http://agent-server:3000 \
		-e AGENT_SERVER_SERVICE_TOKEN="$${AGENT_SERVER_SERVICE_TOKEN:-token-local-dev}" \
		-e AGENT_SERVER_WORKSPACE_ID="$${AGENT_SERVER_WORKSPACE_ID:-workspace_main}" \
		-e DATABASE_URL=postgresql://agent:agent@postgres:5432/agent_server \
		-e POSTGRES_URL=postgresql://agent:agent@postgres:5432/agent_server \
		-e AGENT_SERVER_DISPATCHER_CONCURRENCY=3 \
		-e PASEO_MODEL=opencode-go/deepseek-v4-flash \
		-e MIXED_TEAM_EXISTING_ROOT_TASK_ID="$${MIXED_TEAM_EXISTING_ROOT_TASK_ID:-}" \
		-v "$$(pwd)/.local:/workspace/.local" \
		runner node scripts/smoke/mixed-team-journey-main-flow.mjs

web-build:
	./scripts/dev/docker-run -- pnpm web:build

web-check-types:
	./scripts/dev/docker-run -- pnpm web:check:types

build:
	./scripts/dev/docker-run -- pnpm build

check:
	./scripts/dev/docker-run -- pnpm check

# Types only. `check` also runs the web type-check, a repo-wide prettier pass,
# a docs audit and an exec-plan audit; during MVE-stage development those gate
# on things a backend change cannot break, and they turned a per-iteration
# check into a multi-minute one. Use this while iterating; run the full `check`
# once before handing work over.
check-fast:
	./scripts/dev/docker-run -- pnpm check:fast

test:
	./scripts/dev/docker-run -- pnpm test

test-unit:
	./scripts/dev/docker-run -- pnpm test:unit

test-integration:
	./scripts/dev/docker-run -- pnpm test:integration

test-real-pg:
	./scripts/dev/docker-run --postgres -- pnpm test:real-pg

test-contract:
	./scripts/dev/docker-run -- pnpm test:contract

e2e-smoke:
	./scripts/dev/docker-run -- pnpm test:e2e

paseo-smoke:
	./scripts/dev/docker-run -- pnpm test:paseo-smoke

eval-smoke:
	./scripts/dev/docker-run -- pnpm eval:smoke

ci:
	./scripts/dev/docker-run -- pnpm run ci

managed-environment-smoke:
	./scripts/dev/docker-run --postgres -- pnpm smoke:managed-environment

self-learning-team-phase2-smoke:
	PASEO_MODEL="$${PASEO_MODEL:-opencode/deepseek-v4-flash-free}" ./scripts/dev/docker-run --postgres --pass-env PASEO_MODEL --pass-env OPENCODE_GO_API_KEY --pass-env PHASE2_SMOKE_POLL_MS --pass-env PHASE2_SMOKE_TIMEOUT_MS -- pnpm smoke:self-learning-team-phase2

self-learning-team-phase3-smoke:
	PASEO_MODEL="$${PASEO_MODEL:-opencode/deepseek-v4-flash-free}" ./scripts/dev/docker-run --postgres --pass-env PASEO_MODEL --pass-env OPENCODE_GO_API_KEY --pass-env PHASE3_SMOKE_POLL_MS --pass-env PHASE3_SMOKE_TIMEOUT_MS --pass-env PHASE3_SMOKE_RETAIN_FILE -- pnpm smoke:self-learning-team-phase3

agent-teams-v2-smoke:
	PASEO_PROVIDER="$${PASEO_PROVIDER:-opencode}" PASEO_MODEL="$${PASEO_MODEL:-opencode-go/deepseek-v4-flash}" ANTHROPIC_BASE_URL="$${ANTHROPIC_BASE_URL:-https://opencode.ai/zen/go}" ANTHROPIC_API_KEY="$${ANTHROPIC_API_KEY:-$${OPENCODE_GO_API_KEY:-}}" ANTHROPIC_MODEL="$${ANTHROPIC_MODEL:-deepseek-v4-flash}" ANTHROPIC_DEFAULT_HAIKU_MODEL="$${ANTHROPIC_DEFAULT_HAIKU_MODEL:-deepseek-v4-flash}" ANTHROPIC_DEFAULT_SONNET_MODEL="$${ANTHROPIC_DEFAULT_SONNET_MODEL:-deepseek-v4-flash}" ANTHROPIC_DEFAULT_OPUS_MODEL="$${ANTHROPIC_DEFAULT_OPUS_MODEL:-deepseek-v4-flash}" ANTHROPIC_SMALL_FAST_MODEL="$${ANTHROPIC_SMALL_FAST_MODEL:-deepseek-v4-flash}" CLAUDE_CODE_SUBAGENT_MODEL="$${CLAUDE_CODE_SUBAGENT_MODEL:-deepseek-v4-flash}" ./scripts/dev/docker-run --postgres --bind-local --pass-env PASEO_PROVIDER --pass-env PASEO_MODEL --pass-env PASEO_CONNECT_TIMEOUT_MS --pass-env PASEO_DAEMON_STARTUP_TIMEOUT_MS --pass-env PASEO_OPENCODE_SERVER_STARTUP_TIMEOUT_MS --pass-env PASEO_OPENCODE_APP_AGENTS_TIMEOUT_MS --pass-env PASEO_PROVIDER_REFRESH_TIMEOUT_MS --pass-env OPENCODE_GO_API_KEY --pass-env ANTHROPIC_BASE_URL --pass-env ANTHROPIC_API_KEY --pass-env ANTHROPIC_MODEL --pass-env ANTHROPIC_DEFAULT_HAIKU_MODEL --pass-env ANTHROPIC_DEFAULT_SONNET_MODEL --pass-env ANTHROPIC_DEFAULT_OPUS_MODEL --pass-env ANTHROPIC_SMALL_FAST_MODEL --pass-env CLAUDE_CODE_SUBAGENT_MODEL --pass-env AGENT_TEAMS_V2_SMOKE_RUNTIME --pass-env AGENT_TEAMS_V2_SMOKE_EXPIRED_LEASE_RECOVERY --pass-env AGENT_TEAMS_V2_SMOKE_TIMEOUT_SECONDS --pass-env AGENT_TEAMS_V2_SMOKE_RUNTIME_TIMEOUT_SECONDS --pass-env AGENT_TEAMS_V2_SMOKE_FORCE_STALL --pass-env AGENT_TEAMS_V2_SMOKE_FAILED_ATTEMPT_MODE --pass-env AGENT_TEAMS_V2_SMOKE_REWORK -- pnpm smoke:agent-teams-v2

claude-provider-smoke:
	ANTHROPIC_BASE_URL="$${ANTHROPIC_BASE_URL:-https://opencode.ai/zen/go}" ANTHROPIC_API_KEY="$${ANTHROPIC_API_KEY:-$${OPENCODE_GO_API_KEY:-}}" ANTHROPIC_MODEL="$${ANTHROPIC_MODEL:-deepseek-v4-flash}" ANTHROPIC_DEFAULT_HAIKU_MODEL="$${ANTHROPIC_DEFAULT_HAIKU_MODEL:-deepseek-v4-flash}" ANTHROPIC_DEFAULT_SONNET_MODEL="$${ANTHROPIC_DEFAULT_SONNET_MODEL:-deepseek-v4-flash}" ANTHROPIC_DEFAULT_OPUS_MODEL="$${ANTHROPIC_DEFAULT_OPUS_MODEL:-deepseek-v4-flash}" ANTHROPIC_SMALL_FAST_MODEL="$${ANTHROPIC_SMALL_FAST_MODEL:-deepseek-v4-flash}" CLAUDE_CODE_SUBAGENT_MODEL="$${CLAUDE_CODE_SUBAGENT_MODEL:-deepseek-v4-flash}" ./scripts/dev/docker-run --bind-local --pass-env OPENCODE_GO_API_KEY --pass-env CLAUDE_PROVIDER_SMOKE_OMIT_AUTH --pass-env ANTHROPIC_BASE_URL --pass-env ANTHROPIC_API_KEY --pass-env ANTHROPIC_MODEL --pass-env ANTHROPIC_DEFAULT_HAIKU_MODEL --pass-env ANTHROPIC_DEFAULT_SONNET_MODEL --pass-env ANTHROPIC_DEFAULT_OPUS_MODEL --pass-env ANTHROPIC_SMALL_FAST_MODEL --pass-env CLAUDE_CODE_SUBAGENT_MODEL -- node scripts/smoke/claude-provider-main-flow.mjs

clean:
	docker compose down --remove-orphans
	docker compose --profile postgres-test rm -sf postgres-test

internal-setup:
	corepack enable
	pnpm install --frozen-lockfile
	node scripts/dev/resolve-opencode.mjs --check

internal-dev:
	pnpm dev

internal-dev-api:
	pnpm dev:api

internal-build:
	pnpm build

internal-check:
	pnpm check

internal-test:
	pnpm test

internal-test-unit:
	pnpm test:unit

internal-test-integration:
	pnpm test:integration

internal-test-real-pg:
	pnpm test:real-pg

internal-test-contract:
	pnpm test:contract

internal-test-web:
	pnpm test:web

internal-e2e-smoke:
	pnpm test:e2e

internal-paseo-smoke:
	pnpm test:paseo-smoke

internal-eval-smoke:
	pnpm eval:smoke

internal-ci:
	pnpm run ci

internal-clean:
	pnpm clean

setup-native: internal-setup
dev-native: internal-dev
dev-api-native: internal-dev-api
build-native: internal-build
check-native: internal-check
test-native: internal-test
test-unit-native: internal-test-unit
test-integration-native: internal-test-integration
test-real-pg-native: internal-test-real-pg
test-contract-native: internal-test-contract
test-web-native: internal-test-web
e2e-smoke-native: internal-e2e-smoke
paseo-smoke-native: internal-paseo-smoke
eval-smoke-native: internal-eval-smoke
ci-native: internal-ci
clean-native: internal-clean
