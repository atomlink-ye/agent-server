.PHONY: setup dev dev-api build check test test-unit test-integration test-contract e2e-smoke paseo-smoke eval-smoke ci clean

setup:
	corepack enable
	pnpm install --frozen-lockfile
	node scripts/dev/resolve-opencode.mjs --check

dev:
	pnpm dev

dev-api:
	pnpm dev:api

build:
	pnpm build

check:
	pnpm check

test:
	pnpm test

test-unit:
	pnpm test:unit

test-integration:
	pnpm test:integration

test-contract:
	pnpm test:contract

e2e-smoke:
	pnpm test:e2e

paseo-smoke:
	pnpm test:paseo-smoke

eval-smoke:
	pnpm eval:smoke

ci:
	pnpm run ci

clean:
	pnpm clean
