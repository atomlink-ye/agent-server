# Development

Agent Server treats the developer sandbox/host as the normal development boundary. Docker is reserved for production-like topology validation, CI services, and acceptance; it is not a prerequisite for ordinary code/test work.

## Canonical flow

```text
pnpm install
  -> pnpm setup
  -> pnpm doctor
  -> pnpm dev
  -> focused deterministic checks
  -> pnpm test:scenario
  -> optional pnpm test:pg
  -> optional live canary
```

## Host-native setup

Prerequisites:

- Node 22–24;
- pnpm 11;
- no PostgreSQL installation is required;
- `createdb` is optional and lets setup create the real default database when available.

```bash
pnpm setup
```

Provider binaries are optional for core development. Prepare the pinned
Paseo/Claude/Codex/OpenCode toolchain before runtime work with:

```bash
pnpm setup:providers
```

The command is idempotent and keeps its release under `.local/provider-toolchain`.
It does not install providers globally or add a provider prerequisite to
`pnpm setup`.

The pinned provider toolchain is Linux-only and requires the `flock` utility.
Run it in the Linux development sandbox; macOS/Windows host-native core mode
remains supported, but cannot prepare this runtime toolchain locally.

Setup is idempotent and owns only developer bootstrap responsibilities:

1. read `.env` / `.env.local` values when the same variable is not already exported;
2. create `.local/` workspace/runtime/skill-registry directories;
3. resolve the development database URL, preferring reachable local PostgreSQL;
4. when the default host database is absent, start or reuse a persistent PGlite wire server under `.local/dev-runtime`;
5. create the real database with `createdb` when it is missing and the tool is available;
6. apply the durable kernel migrations;
7. print the next canonical command.

Default real database:

```text
postgresql://$USER@127.0.0.1:5432/agent_server_dev
```

Override with `DATABASE_URL` or `POSTGRES_URL`.

When neither variable is set and the default real database is unavailable, the
harness uses `postgresql://postgres:postgres@127.0.0.1:55432/postgres` backed by
`.local/dev-runtime/pglite`. Set `PGLITE_PORT` if that port is occupied. An
explicit database URL is never replaced with PGlite.

## Doctor

```bash
pnpm doctor
```

Doctor checks Node/pnpm, PostgreSQL connectivity, development ports, and optional Paseo reachability. Its output deliberately distinguishes:

```text
ready.core
ready.scenario
ready.runtime
```

A missing runtime is not a core-development failure.

## Core development

```bash
pnpm dev
```

Core mode starts the API and Web directly as host processes. It defaults to:

```text
RUNTIME_ADAPTER=none
AGENT_SERVER_DIRECT_CHAT_PLANE=mock
AGENT_SERVER_PRODUCT_WORK_PLANE=absent
```

This mode is for product/resource/API/UI work that does not need a live execution plane. The goal is to keep provider credentials and runtime bootstrapping out of the default inner loop.

## Runtime development

```bash
pnpm dev:runtime
```

If the provider toolchain is absent, run `pnpm setup:providers` first. Runtime
startup uses the pinned local release and an isolated runtime HOME for provider
configuration; core development does not require either.

Runtime mode still uses host processes. It invokes the existing `scripts/dev/with-paseo.mjs` helper around the API process, so Paseo and the provider toolchain remain isolated behind the runtime boundary without requiring Docker. After API readiness, the Web bootstrap creates/publishes the local Agent/Environment/Team/Work fixtures and the Web process starts on port 3001.

Provider credentials remain explicit environment input. Do not add fallback credentials to repository files.

## Database strategy

### PGlite — default deterministic database

Use PGlite for unit-adjacent repository, integration, and product scenario tests whenever the behavior is not specifically PostgreSQL-only. A test should normally own its PGlite instance, migrations, and disposal through `tests/harness/database.ts`.

### Local real PostgreSQL — semantic lane

Use real PostgreSQL only for semantics that need it:

```text
FOR UPDATE / SKIP LOCKED
advisory locks
real transaction races
connection-level behavior
PostgreSQL-specific constraints/indexes
real migration concurrency
```

Create a dedicated database and opt in:

```bash
createdb agent_server_test
TEST_DATABASE_URL=postgresql://$USER@127.0.0.1:5432/agent_server_test pnpm test:pg
```

When running one PostgreSQL integration file directly, export `DATABASE_URL`
or `POSTGRES_URL` first. The direct-file path does not provision a database:

```bash
createdb agent_server_test
export DATABASE_URL=postgresql://$USER@127.0.0.1:5432/agent_server_test
pnpm exec vitest run tests/integration/real-pg-pool.integration.test.ts
```

The runner refuses destructive access unless the database name contains `test`; it also rejects `prod`, `production`, `main`, and `live` names. When no test URL is supplied, the lane skips instead of booting Docker behind the developer's back.

### Docker/PostgreSQL — CI or topology validation

CI may provide PostgreSQL as a GitHub service container and point `TEST_DATABASE_URL` at it. The test runner itself never owns a Docker lifecycle.

## Deterministic scenario harness

`tests/harness/` is the shared composition layer:

```text
database.ts            PGlite lifecycle
postgres.ts            guarded real-PG lifecycle
agent-server-harness.ts composition/disposal facade
scripted-runtime.ts    deterministic runtime decision boundary
seed/                   semantic product fixtures
```

Scenario tests should read like product behavior:

```ts
const h = await createAgentServerHarness();
const world = await h.seed.goldenPath();

// act through production handlers/repositories
// step workers explicitly

await h.dispose();
```

Prefer fixture names that describe product preconditions rather than tables. SQL belongs inside reusable seed helpers when it is merely fixture plumbing.

## Worker execution model

Important background workers implement the shared `StepWorker` contract:

```ts
interface StepWorker<T = unknown> {
  step(): Promise<{ kind: 'idle' } | { kind: 'processed'; value?: T }>;
}
```

Production loops call `step()` repeatedly and sleep only on `idle`. Scenarios call `step()` directly. Do not test a one-step state transition by starting an infinite loop and then sleeping/polling for a guessed amount of time.

## Canaries

```bash
pnpm canary:runtime
pnpm canary:golden-path
```

Canaries are not replacements for deterministic tests:

- runtime canary answers whether Paseo/provider/tooling is compatible now;
- golden-path canary answers whether a representative host-native browser/API/runtime journey works now;
- scenario tests answer whether Agent Server's own deterministic product wiring is correct.

## Generated state

Local runtime/process/test state belongs under `.local/`. Do not commit database dumps, provider transcripts, screenshots, evidence bundles, or task-specific debug scripts. Milestone/release evidence belongs to CI/acceptance artifacts, not the ordinary inner-loop test source.
