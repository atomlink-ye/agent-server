.PHONY: setup dev dev-api build check test test-unit test-integration test-real-pg test-contract e2e-smoke paseo-smoke eval-smoke ci managed-environment-smoke clean \
	internal-setup internal-dev internal-dev-api internal-build internal-check internal-test internal-test-unit internal-test-integration \
	internal-test-real-pg internal-test-contract internal-e2e-smoke internal-paseo-smoke internal-eval-smoke internal-ci internal-clean \
	setup-native dev-native dev-api-native build-native check-native test-native test-unit-native test-integration-native test-real-pg-native \
	test-contract-native e2e-smoke-native paseo-smoke-native eval-smoke-native ci-native clean-native collaborative-team-smoke

setup:
	docker compose build agent-server runner
	./scripts/dev/docker-run -- node scripts/dev/resolve-opencode.mjs --check

dev:
	docker compose up --build postgres agent-server

dev-api:
	docker compose up --build postgres agent-server

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

collaborative-team-smoke:
	PASEO_MODEL="$${PASEO_MODEL:-opencode/deepseek-v4-flash-free}" ./scripts/dev/docker-run --postgres --pass-env PASEO_MODEL --pass-env OPENCODE_GO_API_KEY --pass-env COLLAB_SMOKE_POLL_MS -- pnpm smoke:collaborative-team

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
