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

The Collaborative Team smoke uses the same disposable PostgreSQL setup:

```bash
make collaborative-team-smoke
```

The target forwards only `PASEO_MODEL`, `OPENCODE_GO_API_KEY`, and
`COLLAB_SMOKE_POLL_MS`. It uses a zero-credential free-model default when no
key is present. For an authenticated diagnostic, load the key from a local
mode-0600 environment file, then use the Go model ID and optional short poll:

```bash
PASEO_MODEL=opencode-go/deepseek-v4-flash \
COLLAB_SMOKE_POLL_MS=120000 \
make collaborative-team-smoke
```

The key is copied only into the isolated Paseo process and is never logged.
The smoke removes its temporary database and runtime root unless explicitly
run in a retained diagnostic mode.

The self-learning Project Lab Phase 3 smoke uses the same Docker/PostgreSQL
prerequisites and pinned Node `24.18.0` / pnpm `11.7.0` toolchain:

```bash
make self-learning-team-phase3-smoke
```

An optional paid-model run uses a local mode-`0600` `OPENCODE_GO_API_KEY` and
the explicitly selected model; never print or commit the key:

```bash
PASEO_MODEL=opencode-go/deepseek-v4-flash \
make self-learning-team-phase3-smoke
```

Without the key, the target uses the explicitly free model default. The smoke
is local/single-operator evidence only. Set `PHASE3_SMOKE_RETAIN_FILE` to keep
the local API, Paseo, Web service, and database for visual evidence and reload
inspection; retained mode is not production deployment or a persistence,
multi-user, or authentication guarantee. Stop only verified child processes and
remove ignored retained state after inspection.

The Team DAG MVE smoke uses the same disposable setup and the opt-in
`dag-mve-v1` Team path:

```bash
POSTGRES_ADMIN_URL=<retained-local-admin-url> \
PASEO_MODEL=opencode/deepseek-v4-flash-free \
pnpm smoke:team-dag
```

It is evidence for the observed two-leaf join/synthesizer flow only, not a
claim of production recovery or restart/resume.

For operator inspection, run the retained variant:

```bash
POSTGRES_ADMIN_URL=<retained-local-admin-url> \
PASEO_MODEL=opencode/deepseek-v4-flash-free \
pnpm smoke:team-dag:inspect
```

Unlike the canonical smoke, this command intentionally keeps its unique
database, Agent Server API, Paseo daemon, task-scoped RuntimeCells, Workspaces,
logs, manifest, and milestone snapshots available. Its bearer token and database
URL are written only to a mode-`0600` `inspect.env` under the ignored
`.local/team-dag-inspect/<run-id>/` directory. Stop the retained process and
remove its database/runtime directory manually only after inspection.

## Generated state

`node_modules`, `dist`, coverage, Vitest output, `.local`, logs, runtime homes,
workspaces, and evidence are ignored or stored in Docker volumes. `make clean`
stops Compose services and removes orphaned/profile task containers without
using `-v`; named dependency, runtime, and PostgreSQL volumes are preserved.
