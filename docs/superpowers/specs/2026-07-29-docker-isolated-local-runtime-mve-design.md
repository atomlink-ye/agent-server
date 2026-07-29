# Docker-Isolated Local Runtime MVE

## Status and authority

This design was approved by the user on 2026-07-29. It defines the minimum
local-development slice that runs Agent Server, Paseo, OpenCode, PostgreSQL, and
the existing local verification commands through Docker without using the
host's Paseo/OpenCode processes, binaries, homes, or credentials.

The work starts from `origin/master` commit `0a7992b` in worktree
`.worktrees/docker-isolated-local-runtime-mve` on branch
`agent/docker-isolated-local-runtime-mve`.

Product stage is `Prove`. The primary acceptance evidence is the existing real
Managed Environment main flow running entirely inside Docker. Existing checks
and the baseline Paseo smoke are supporting evidence. No new unit, contract,
integration, deterministic E2E, evaluation, or fixture suite is in scope.

## Outcome

All normal local Make entrypoints execute in Docker by default. `make dev`
starts a real local Agent Server stack whose Paseo and OpenCode processes exist
only inside the container. The existing Managed Environment smoke proves real
Environment publication, ProductSession pinning, same-Session continuation, and
second-Session Runtime Cell/Workspace isolation without touching the host's
global Paseo/OpenCode state.

## Architecture

The running development topology has two long-lived containers:

1. `postgres`: PostgreSQL 16 with a named data volume and no host-published
   port.
2. `agent-server`: one development container containing Agent Server, Paseo
   `0.1.110`, OpenCode `1.18.4`, and Runtime MCP. Compose init owns PID 1;
   `with-paseo.mjs` supervises Paseo and the API; Paseo launches OpenCode.

A one-shot runner/CI service reuses the same toolchain image for build, checks,
tests, deterministic E2E, real-PostgreSQL checks, and external smoke commands.
It is not a long-running service.

Keeping Agent Server and Paseo/OpenCode in one container mirrors the current
co-process development model and preserves the accepted process boundary:
domain/application code still reaches Paseo only through `AgentRuntimePort`,
while the development launcher owns process startup. It also preserves the
loopback-only Runtime MCP and Paseo listeners and avoids cross-container dynamic
port discovery or shared-path coordination.

## Image and filesystem boundary

The development image contains Node 24, Corepack, pnpm `11.7.0`, Paseo
`0.1.110`, and the OpenCode `1.18.4` Linux optional binary selected for the
image architecture. It runs as a non-root user and excludes host dependencies,
runtime state, worktrees, Git metadata, credentials, and generated evidence from
the build context.

Development bind-mounts the current worktree at the container workspace. Docker
volumes overlay platform-specific and mutable state:

- a named development `node_modules` volume initialized from Linux image
  dependencies;
- a named `.local` volume for Agent workspace, Runtime Cells, Skill registry,
  isolated HOME/XDG/PASEO_HOME, logs, and temporary runtime state;
- a named PostgreSQL data volume;
- a fresh anonymous Linux `node_modules` volume for one-shot CI where needed so
  stale macOS or development dependencies cannot affect evidence.

The host's `node_modules`, `~/.paseo`, OpenCode homes/config/auth files, and
OpenCode binary are never mounted. Source edits remain in the dedicated Git
worktree; generated runtime state remains in Docker volumes.

## Network and security boundary

Only the Agent Server HTTP API is host-published, exactly as
`127.0.0.1:3000:3000`. PostgreSQL, Paseo, OpenCode, and Runtime MCP publish no
host ports. Inside the `agent-server` container, the API listens on
`0.0.0.0:3000` for Docker forwarding, while Paseo and Runtime MCP remain on
container loopback.

The design preserves:

- free-only automatic model selection and caller model-selection prohibition;
- the safe runtime environment allowlist;
- isolated HOME, XDG, and PASEO_HOME directories;
- disabled Paseo relay, MCP injection, web UI, dictation, and voice mode;
- existing Runtime MCP authorization headers;
- absence of prompts, raw provider errors, credentials, and host paths from
  normal responses, logs, and retained evidence.

No host OpenCode authentication or provider key is injected. The primary smoke
uses the existing zero-credential free-model path. This is development process
isolation, not production sandboxing or tenant execution isolation.

## Command contract

Existing Make entrypoints become Docker-first:

- `make setup` builds the toolchain image and validates the container's Linux
  OpenCode binary.
- `make dev` starts PostgreSQL and the complete Agent Server runtime container.
- `make dev-api` is a compatibility alias for the complete isolated dev stack in
  this slice; it must not start a host-dependent API with no container runtime.
- `make build`, `make check`, `make test`, focused existing test targets,
  `make e2e-smoke`, `make eval-smoke`, and `make ci` run in one-shot containers.
- `make test-real-pg` runs against container PostgreSQL through a caller-provided
  container connection URL.
- `make paseo-smoke` runs the existing external Paseo/OpenCode smoke inside the
  image.
- `make managed-environment-smoke` runs the existing three-turn real Managed
  Environment path inside the image.
- `make clean` stops task services and removes generated disposable output while
  preserving named volumes and databases.

Explicit `*-native` or `internal-*` targets may remain for container-internal
dispatch and deliberate human diagnostics. They are not the default local
workflow and must not be invoked by Docker wrappers recursively.

There is no automatic `docker compose down -v`, database reset, or runtime-volume
deletion. Those remain destructive Human Gates.

## Health and lifecycle

PostgreSQL readiness uses `pg_isready`. Agent Server liveness uses
`/health/live`; full readiness uses `/health/ready` and must include Paseo
WebSocket, Workspace, and free-model readiness.

Compose init handles PID 1 signal forwarding and child reaping.
`with-paseo.mjs` continues to own Paseo/API process startup, health waiting,
signal propagation, and bounded cleanup. Stopping Compose must leave no
task-specific listener or container, while persistent Docker volumes remain
until a separately approved destructive cleanup.

## Real main-flow acceptance

Acceptance requires fresh observable evidence:

1. Record the host's global Paseo/OpenCode process and listener snapshot.
2. Start the Docker stack through `make dev`.
3. Observe successful `/health/live` and `/health/ready` responses.
4. Run the existing Managed Environment smoke entirely inside Docker and prove:
   - authenticated Environment validate/import/read/publish;
   - EnvironmentVersion pinning on both ProductSessions;
   - Session A Turn 1/2 reuse one provider Agent and Paseo Workspace;
   - Session B uses a distinct RuntimeSession, Runtime Cell, Paseo Workspace,
     and provider Agent;
   - all Runs succeed with the expected real marker and safe evidence.
5. Inspect that the effective OpenCode binary, process IDs, HOME/XDG/PASEO_HOME,
   Runtime Cells, and connections belong to the container, not the host.
6. Run the existing baseline Paseo smoke inside Docker as supporting runtime
   evidence.
7. Run existing deterministic `make ci` inside Docker as supporting evidence.
8. Stop Compose without deleting volumes and confirm no task container/listener
   remains.
9. Confirm the host Paseo/OpenCode processes and listener were neither used,
   changed, nor stopped.

The Docker daemon must be available for these observations. At design time the
local OrbStack/Docker socket was unavailable; starting it is a human environment
prerequisite, not a product-code workaround.

## Documentation impact

Update the README command contract, Feature ledger, Paseo runtime component,
local operations/runbook guidance, and security description to state precisely
that local development is Docker-first and that this proves host-process
isolation only. Maintain an Active Exec Plan and record sanitized real evidence
and deferred findings.

## Explicit non-goals

- GitHub Actions conversion to the Docker entrypoint;
- separate API and runtime containers;
- production images, deployment profiles, distroless or multi-stage polish;
- seccomp, AppArmor, read-only root filesystem, resource quotas, or network
  policy hardening;
- Host placement, tenant sandboxing, leases, Runtime Cell GC, or multi-node
  runtime coordination;
- credential broker or production secret distribution;
- hot-reload platform optimization beyond the existing watcher; container
  restart is an acceptable fallback;
- public API, durable schema, migration, dependency-version, or product runtime
  contract changes;
- destructive cleanup of retained worktrees, databases, or Docker volumes.

## Risks and recovery

- macOS dependencies cannot enter the Linux container; named/anonymous
  `node_modules` volumes and image-time checks must fail fast on the wrong
  OpenCode platform binary.
- Bind-mounted watcher behavior may differ under Docker on macOS. This does not
  block the real path; restart the container and defer watcher optimization.
- Free-model availability is external and unstable. The existing smoke remains
  non-deterministic supporting evidence and must never become a deterministic PR
  gate.
- Docker volumes can retain stale development data. Commands must use explicit
  project-scoped names and isolated smoke databases; do not solve this with
  implicit destructive cleanup.
- If implementation requires a public contract, tenant/security boundary,
  durable-state model, migration, core dependency, merge, or destructive cleanup
  change, stop at a new Human Gate.
