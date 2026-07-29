.PHONY: setup dev dev-api build check test test-unit test-integration test-real-pg test-contract e2e-smoke paseo-smoke eval-smoke ci managed-environment-smoke clean \
	internal-setup internal-dev internal-dev-api internal-build internal-check internal-test internal-test-unit internal-test-integration \
	internal-test-real-pg internal-test-contract internal-e2e-smoke internal-paseo-smoke internal-eval-smoke internal-ci internal-clean \
	setup-native dev-native dev-api-native build-native check-native test-native test-unit-native test-integration-native test-real-pg-native \
	test-contract-native e2e-smoke-native paseo-smoke-native eval-smoke-native ci-native clean-native

setup:
	docker compose build agent-server runner
	docker compose run --rm --no-deps runner node scripts/dev/resolve-opencode.mjs --check

dev:
	docker compose up --build postgres agent-server

dev-api:
	docker compose up --build postgres agent-server

build:
	docker compose run --rm --no-deps runner pnpm build

check:
	docker compose run --rm --no-deps runner pnpm check

test:
	docker compose run --rm --no-deps runner pnpm test

test-unit:
	docker compose run --rm --no-deps runner pnpm test:unit

test-integration:
	docker compose run --rm --no-deps runner pnpm test:integration

test-real-pg:
	set -eu; trap 'docker compose --profile postgres-test rm -sf postgres-test >/dev/null 2>&1 || true' EXIT; trap 'exit 130' INT TERM; docker compose --profile postgres-test up -d --wait postgres-test; docker compose run --rm --no-deps -e DATABASE_URL=postgresql://agent:agent@postgres-test:5432/agent_server -e POSTGRES_URL=postgresql://agent:agent@postgres-test:5432/agent_server runner pnpm test:real-pg

test-contract:
	docker compose run --rm --no-deps runner pnpm test:contract

e2e-smoke:
	docker compose run --rm --no-deps runner pnpm test:e2e

paseo-smoke:
	docker compose run --rm --no-deps runner pnpm test:paseo-smoke

eval-smoke:
	docker compose run --rm --no-deps runner pnpm eval:smoke

ci:
	docker compose run --rm --no-deps runner pnpm run ci

managed-environment-smoke:
	set -eu; trap 'docker compose --profile postgres-test rm -sf postgres-test >/dev/null 2>&1 || true' EXIT; trap 'exit 130' INT TERM; docker compose --profile postgres-test up -d --wait postgres-test; docker compose run --rm --no-deps -e POSTGRES_ADMIN_URL=postgresql://agent:agent@postgres-test:5432/agent_server runner pnpm smoke:managed-environment

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
