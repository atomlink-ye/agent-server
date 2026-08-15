# Local development

## Requirements

- Node compatible with `.nvmrc` and pnpm `11.7.0` for host-side deterministic tooling.
- Docker Compose with a running daemon for `postgres`, `core`, `runtime`, and `full` topologies.
- Linux or macOS, x64 or arm64.
- External credentials only for live provider smoke.

## Install

```bash
corepack enable
pnpm install --frozen-lockfile
```

## Local topology model

All interactive Dev environments and infrastructure-backed Test environments resolve from `config/local-environments.yaml` through `tooling/environment/`.

```text
in-process   no external service
postgres     disposable real PostgreSQL
core         PostgreSQL + Agent Server
runtime      core + Paseo execution plane
full         runtime + Web
```

Start/inspect/stop an interactive topology:

```bash
pnpm local-env up core
pnpm local-env up runtime
pnpm local-env up full
pnpm local-env info
pnpm local-env down
```

Provider/model overrides are explicit and bounded:

```bash
pnpm local-env up runtime --provider opencode --model opencode-go/deepseek-v4-flash
```

The CLI records only ignored local environment state under `.local/`.

## One-off infrastructure commands

Do not write a new scenario setup script. Use the generic runner:

```bash
pnpm local-env run postgres -- <command>
pnpm local-env run runtime -- <command>
```

The runner allocates a unique Compose project, dynamic host ports, `.local/test-runs/<run-id>/`, useful DB/API environment variables, and cleanup. On failure set `TEST_KEEP_FAILED=1` to retain diagnostics.

## Tests

Deterministic tests do not need Docker unless they explicitly select an infrastructure topology.

```bash
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm test:e2e
```

Real PostgreSQL tests self-start their database when a DB URL is absent:

```bash
pnpm test:real-pg
```

If `DATABASE_URL` or `POSTGRES_URL` is already provided, the lane uses that database instead.

## Live runtime smoke

Load provider credentials from an external file/secret source, never the repository:

```bash
set -a; . /path/to/provider.env; set +a
pnpm smoke:runtime
```

The real Team path is:

```bash
pnpm smoke:agent-team
```

Both use the same generic `runtime` topology as interactive development. Real-provider smoke is explicit opt-in and is not a deterministic PR prerequisite.

## Generated state

`node_modules`, build output, coverage, Vitest output, `.local`, test-run diagnostics, runtime homes, and logs are ignored. Do not copy generated output into `docs/`, `artifacts/`, `evidence/`, or `reports/` directories; those task-history directories are not part of the repository model.
