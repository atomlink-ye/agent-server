# Local development

## Requirements

- Node compatible with `.nvmrc` and pnpm `11.7.0` for host-side deterministic tooling.
- Native PostgreSQL only when working on real PostgreSQL semantics. Core development otherwise falls back to PGlite.
- Linux or macOS, x64 or arm64.
- External credentials only for live provider smoke.

## Install

```bash
corepack enable
pnpm install --frozen-lockfile
```

## Host-native workflow

Prepare the local state and start core development directly on the host:

```bash
pnpm run setup
pnpm doctor
pnpm dev
```

For runtime work, prepare the Linux-only provider toolchain and start the
host-native runtime process:

```bash
pnpm setup:providers
pnpm dev:runtime
```

Provider credentials and model selection are explicit environment input. The
development harness records only ignored local state under `.local/`.

## Tests

Deterministic tests do not need a container runtime.

```bash
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm test:e2e
```

Real PostgreSQL tests require an explicit native test database URL:

```bash
createdb agent_server_test
TEST_DATABASE_URL=postgresql://$USER@127.0.0.1:5432/agent_server_test pnpm test:pg
```

For one real-PG integration file, export `DATABASE_URL` or `POSTGRES_URL`
before running Vitest. See the repository README for the command.

## Live runtime smoke

Load provider credentials from an external file/secret source, never the repository:

```bash
set -a; . /path/to/provider.env; set +a
pnpm canary:runtime
```

The real Team path is:

```bash
pnpm smoke:agent-team
```

Both use the host-native runtime setup. Real-provider smoke is explicit opt-in
and is not a deterministic PR prerequisite.

## Generated state

`node_modules`, build output, coverage, Vitest output, `.local`, test-run diagnostics, runtime homes, and logs are ignored. Do not copy generated output into `docs/`, `artifacts/`, `evidence/`, or `reports/` directories; those task-history directories are not part of the repository model.
