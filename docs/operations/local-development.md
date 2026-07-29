# Local development

## Requirements

- Node.js `>=22 <25` and Corepack.
- Linux or macOS, x64 or arm64.
- Network access only for package installation and live OpenCode smoke.

Dependencies pin Paseo client/CLI `0.1.110` and OpenCode platform packages `1.18.4`. The platform packages are optional dependencies; the resolver chooses exactly one and prepends its `bin` directory for local processes. The generic OpenCode installer is not used because its platform postinstall was unreliable in the validation environment.

## Setup and checks

```bash
make setup
make ci
```

If a managed environment prevents pnpm from writing its normal user store, set `PNPM_HOME`, `XDG_DATA_HOME`, and `--store-dir` to writable ignored paths. This is an environment concern, not an Agent Server runtime variable.

## Start modes

`make dev` allocates or uses `PASEO_PORT`, creates isolated `.local/dev-runtime`, starts Paseo in foreground, waits for health, then starts the API. Signals are forwarded and both process groups are stopped.

`make dev-api` starts only the API. Configure an existing daemon through `.env` or environment variables:

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

The canonical Managed Environment smoke uses a fresh PostgreSQL database and
disposable Registry/Runtime/Cell roots. Run it only when external verification
is requested:

```bash
POSTGRES_ADMIN_URL=<local retained PostgreSQL admin URL> \
PASEO_MODEL=opencode/deepseek-v4-flash-free \
pnpm smoke:managed-environment
```

The command prints sanitized facts only, stops task-specific processes, and
removes disposable runtime state. A retained acceptance database is reported by
name only. Paseo MCP Authorization persistence remains a known PR #14
deviation; it is not evidence of a production credential lifecycle.
The smoke overrides `PASEO_RUNTIME_CELL_ROOT` to a task-specific disposable
root beneath its runtime root.

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

`node_modules`, `dist`, coverage, Vitest output, `.local`, logs, runtime homes, workspaces, and evidence are ignored. `make clean` removes generated build/test output and `.local`; do not run it while an intentional local daemon or unsaved runtime artifact is needed.
