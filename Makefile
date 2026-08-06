.PHONY: setup dev dev-api web-bootstrap web-dev web-build web-check-types build check test test-unit test-integration test-real-pg test-contract e2e-smoke paseo-smoke eval-smoke ci managed-environment-smoke clean \
	internal-setup internal-dev internal-dev-api internal-build internal-check internal-test internal-test-unit internal-test-integration \
	internal-test-real-pg internal-test-contract internal-e2e-smoke internal-paseo-smoke internal-eval-smoke internal-ci internal-clean \
	setup-native dev-native dev-api-native build-native check-native test-native test-unit-native test-integration-native test-real-pg-native \
	test-contract-native e2e-smoke-native paseo-smoke-native eval-smoke-native ci-native clean-native self-learning-team-phase2-smoke self-learning-team-phase3-smoke agent-teams-v2-smoke

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
		-e WEB_WORKSPACE_NAME="$${WEB_WORKSPACE_NAME:-Web Chat MVE}" \
		-v "$$(pwd)/.local:/workspace/.local" \
		runner node scripts/dev/web-bootstrap.mjs

web-dev:
	docker compose up --build -d postgres agent-server
	@until curl -fsS http://127.0.0.1:3000/health/ready >/dev/null; do sleep 1; done
	$(MAKE) web-bootstrap
	docker compose up --build web

web-build:
	./scripts/dev/docker-run -- pnpm web:build

web-check-types:
	./scripts/dev/docker-run -- pnpm web:check:types

build:
	./scripts/dev/docker-run -- pnpm build

check:
	./scripts/dev/docker-run -- pnpm check

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
	PASEO_PROVIDER="$${PASEO_PROVIDER:-opencode}" PASEO_MODEL="$${PASEO_MODEL:-opencode-go/deepseek-v4-flash}" ./scripts/dev/docker-run --postgres --bind-local --pass-env PASEO_PROVIDER --pass-env PASEO_MODEL --pass-env OPENCODE_GO_API_KEY --pass-env AGENT_TEAMS_V2_SMOKE_RUNTIME --pass-env AGENT_TEAMS_V2_SMOKE_EXPIRED_LEASE_RECOVERY --pass-env AGENT_TEAMS_V2_SMOKE_TIMEOUT_SECONDS --pass-env AGENT_TEAMS_V2_SMOKE_RUNTIME_TIMEOUT_SECONDS --pass-env AGENT_TEAMS_V2_SMOKE_FORCE_STALL --pass-env AGENT_TEAMS_V2_SMOKE_FAILED_ATTEMPT_MODE --pass-env AGENT_TEAMS_V2_SMOKE_REWORK -- pnpm smoke:agent-teams-v2

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
e2e-smoke-native: internal-e2e-smoke
paseo-smoke-native: internal-paseo-smoke
eval-smoke-native: internal-eval-smoke
ci-native: internal-ci
clean-native: internal-clean
