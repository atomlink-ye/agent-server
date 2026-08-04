# Local development

## Requirements

- Docker Compose with a running Docker/OrbStack daemon.
- Linux or macOS, x64 or arm64.
- Network access for image/package installation and live OpenCode smoke.

The image pins Node `24.18.0`, pnpm `11.7.0`, Paseo client/CLI `0.1.110`, and
OpenCode `1.18.4`. The current-architecture OpenCode package is explicitly
installed and verified in the image; host optional binaries are never used.

## Setup and checks

```bash
make setup
make ci
```

`make setup` builds the image and runs the OpenCode platform check in the
one-shot runner. It does not install dependencies into the host worktree.

One-shot Docker commands use:

```bash
scripts/dev/docker-run [--postgres] [--pass-env NAME ...] -- COMMAND [ARG...]
```

To publish an arbitrary host port for a one-shot service, use the wrapper's
publish option, for example `scripts/dev/docker-run --publish PORT -- COMMAND`.

The wrapper forwards no host environment unless a variable is named with
`--pass-env`. `--postgres` starts and waits for the private `postgres-test`
service, injects the in-network `DATABASE_URL`, `POSTGRES_URL`, and
`POSTGRES_ADMIN_URL`, and removes the service it started on exit. It preserves
the command status and does not mount host `HOME`, expose database ports, or
use the Docker socket. It is intended for one-shot checks and smokes; the
persistent `make dev` stack is outside that capability boundary.

## Start modes

`make dev` starts persistent Compose PostgreSQL and the complete Agent Server
container. `make dev-api` is a compatibility alias for the same stack. Compose
publishes only `127.0.0.1:3000:3000`; PostgreSQL, Paseo, OpenCode, and Runtime
MCP have no host ports. Compose `init: true` and the existing launcher handle
child reaping, signal forwarding, Paseo startup, and cleanup.

The container supplies isolated HOME/XDG/PASEO_HOME and `.local` state. The
worktree is the only source bind mount; Linux dependencies are held in Docker
volumes and are never taken from host `node_modules` or host runtime homes.

For deliberate host diagnostics, use an explicit `*-native` target. Configure
an existing native daemon through `.env` or environment variables:

| Variable                     | Default                       |
| ---------------------------- | ----------------------------- |
| `HOST`                       | `127.0.0.1`                   |
| `PORT`                       | `3000`                        |
| `PASEO_WS_URL`               | `ws://127.0.0.1:6767/ws`      |
| `PASEO_AGENT_CWD`            | `.local/agent-workspace`      |
| `PASEO_WORKSPACE_TITLE`      | `Agent Server Baseline`       |
| `PASEO_MODEL`                | unset; free catalog selection |
| `PASEO_CONNECT_TIMEOUT_MS`   | `10000`                       |
| `PASEO_EXECUTION_TIMEOUT_MS` | `120000`                      |
| `PASEO_RUNTIME_CELL_ROOT`    | `.local/runtime-cells`        |

Never put provider or business credentials in `.env` for the baseline smoke. The external smoke is explicitly zero-model-credential.

The canonical Managed Environment smoke uses the ephemeral `postgres-test`
Compose profile and disposable Registry/Runtime/Cell roots:

```bash
make managed-environment-smoke
```

The command prints sanitized facts only and removes the ephemeral test
container. It does not delete the persistent PostgreSQL volume. Paseo MCP
Authorization persistence remains a known PR #14 deviation; it is not evidence
of a production credential lifecycle.
The smoke overrides `PASEO_RUNTIME_CELL_ROOT` to a task-specific disposable
root beneath its runtime root.

The Agent Teams v2 smoke uses the same disposable PostgreSQL setup and pinned
Node `24.18.0` / pnpm `11.7.0` toolchain:

```bash
make agent-teams-v2-smoke
```

It proves the fixed TeamDriver path: TeamRun activation, Lead Work control,
member submission, acceptance, an addressed TeamMessage continuation, and
terminal finish. An authenticated diagnostic may select a supported
`opencode-go` model by loading `OPENCODE_GO_API_KEY` from a local mode-`0600`
environment file; never print or commit the key. The smoke writes redacted,
task-specific evidence under ignored `.local` paths and is local/single-operator
evidence only. It is not a production deployment, persistence, multi-user, or
authentication guarantee.

## Generated state

`node_modules`, `dist`, coverage, Vitest output, `.local`, logs, runtime homes,
workspaces, and evidence are ignored or stored in Docker volumes. `make clean`
stops Compose services and removes orphaned/profile task containers without
using `-v`; named dependency, runtime, and PostgreSQL volumes are preserved.
