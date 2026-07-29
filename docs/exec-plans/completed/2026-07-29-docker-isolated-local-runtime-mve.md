---
status: completed
owner: orchestrator
created_at: 2026-07-29
updated_at: 2026-07-29
authority: execution-plan
---

# Docker-Isolated Local Runtime MVE Implementation Plan

> **For agentic workers:** Execute this plan task-by-task in the named worktree.
> The real Managed Environment path is primary evidence. Do not add test suites,
> fixtures, production hardening, commits, pushes, merges, or destructive volume
> cleanup unless separately authorized.

## Outcome

Make every normal local Agent Server development and verification entrypoint run
through Docker by default, with Agent Server, Paseo `0.1.110`, OpenCode `1.18.4`,
and runtime state isolated from the host's Paseo/OpenCode processes, binaries,
homes, and credentials.

## Context and authority

- Approved design:
  `docs/superpowers/specs/2026-07-29-docker-isolated-local-runtime-mve-design.md`.
- Worktree:
  `/Volumes/AgentsWorkspace/orgs/0xdtech/code/agent-server/.worktrees/docker-isolated-local-runtime-mve`.
- Branch: `agent/docker-isolated-local-runtime-mve`.
- Baseline: `origin/master` / `0a7992b066655c6c0078dc92f5aa13591858389c`.
- Product stage: `Prove`. The existing real Managed Environment three-turn smoke
  is primary acceptance evidence; existing baseline smoke and deterministic CI
  are supporting evidence.
- The user approved implementation in this worktree and approved using the
  `atomlink-ye` GitHub credentials if later required. No push, PR, merge, or
  cleanup authorization is implied.
- Oracle review recommended a two-container running topology: PostgreSQL plus a
  co-process Agent Server container containing API, Paseo, OpenCode, and Runtime
  MCP. This preserves loopback security and avoids cross-container dynamic MCP
  ports and filesystem identity.

## Scope

- Add one Node 24/pnpm 11.7 development image with pinned project Paseo and
  Linux OpenCode dependencies.
- Add Compose services for persistent local PostgreSQL, the complete development
  stack, a one-shot command runner, and an ephemeral real-PostgreSQL test/smoke
  database profile.
- Bind-mount only the current worktree source; keep Linux dependencies,
  `.local`, PostgreSQL, Paseo HOME, and OpenCode XDG state in Docker volumes.
- Make all existing Make targets Docker-first while preserving explicitly named
  internal/native targets for container dispatch and deliberate diagnostics.
- Run the existing Managed Environment smoke, baseline Paseo smoke, and
  deterministic CI inside Docker without using host Paseo/OpenCode.
- Update Feature, Component, README, Security, and local operations authority.
- Record sanitized evidence and keep this plan truthful through completion.

## Non-goals

- No GitHub Actions conversion.
- No API/runtime container split and no Runtime MCP/Paseo non-loopback listener.
- No public API, contract, schema, migration, durable-state model, or dependency
  version change.
- No production image/profile, deployment system, seccomp/AppArmor, read-only
  root filesystem, resource quota, network-policy, tenant sandbox, Host registry,
  placement, lease, GC, or multi-node work.
- No credential broker, host credential mount, or provider-secret persistence.
- No new or expanded unit, contract, integration, deterministic E2E, evaluation,
  or fixture suite.
- No automatic `docker compose down -v`, database reset, retained evidence
  deletion, worktree cleanup, commit, push, PR, or merge.

## File map

- Create `Dockerfile`: reproducible Node 24/pnpm 11.7 Linux development and
  command-runner image with project dependencies and non-root execution.
- Create `.dockerignore`: exclude host dependencies, runtime state, Git/worktree
  internals, credentials, and generated artifacts from image context.
- Create `compose.yaml`: PostgreSQL, complete dev stack, one-shot runner, and
  ephemeral real-PostgreSQL service with health checks and scoped volumes.
- Modify `Makefile`: Docker-first public targets plus non-recursive
  `internal-*`/`*-native` implementation targets.
- Modify `.env.example`: document host-versus-container binding and Docker-first
  configuration without adding secrets.
- Modify `README.md`: replace host-native quick start and canonical command
  descriptions with Docker-first behavior and explicit native diagnostics.
- Modify `docs/features.md`: record local runtime process isolation as an
  implemented development baseline, not production isolation.
- Modify `docs/components/paseo-runtime-adapter.md`: document the container
  co-process boundary and unchanged `AgentRuntimePort` ownership.
- Modify `docs/operations/local-development.md`: exact setup, dev, smoke, CI,
  inspection, shutdown, volume preservation, and Docker-daemon prerequisite.
- Modify `SECURITY.md`: state that host exposure remains loopback-only and
  Paseo/OpenCode/MCP are container-loopback only.
- Create or update a sanitized evidence packet only after the real path runs.

## Work breakdown

### Task 1: Establish the Docker toolchain and topology

- [x] **1.1 Create `.dockerignore`.** Exclude `.git`, `.worktrees`,
      `node_modules`, `dist`, `.local`, `.env*` except `.env.example`, coverage,
      task evidence, editor/OS files, and local credential/config directories.
      Keep source, lockfile, docs, tests, scripts, and `.env.example` available to
      the build.
- [x] **1.2 Create `Dockerfile`.** Use `node:24.18.0-bookworm-slim`, activate
      pnpm `11.7.0`, copy the package, lockfile, and workspace policy, run
      `pnpm install --frozen-lockfile`, explicitly install and verify the
      current-architecture OpenCode `1.18.4` binary, copy repository sources,
      verify `node scripts/dev/resolve-opencode.mjs --check`, chown the
      workspace, and run as the image's non-root Node user.
- [x] **1.3 Create `compose.yaml`.** Define: - `postgres`: `postgres:16`, synthetic local credentials, named data
      volume, no host port, and `pg_isready` health check; - `agent-server`: build the image, `init: true`, bind
      `127.0.0.1:3000:3000`, set `HOST=0.0.0.0`, use the Compose PostgreSQL
      URL, bind-mount the current worktree, overlay named `node_modules` and
      `.local` volumes, wait for healthy PostgreSQL, and run `pnpm dev`; - `runner`: same image and worktree mount, an anonymous
      `/workspace/node_modules` volume initialized from the image, no
      published port, and an empty Compose entrypoint so `docker compose run`
      executes the requested pnpm/Make command directly; - `postgres-test`: test-only profile, PostgreSQL 16 on tmpfs, no host port,
      and health check for fresh real-PG/smoke evidence.
- [x] **1.4 Keep listeners safe.** Confirm Compose publishes only API port 3000
      on host loopback; Paseo, Runtime MCP, OpenCode, `postgres`, and
      `postgres-test` have no `ports` mapping.
- [x] **1.5 Validate static configuration before runtime.** Run
      `docker compose config`. Expected: valid normalized Compose configuration,
      no host mount under `~/.paseo`/OpenCode paths, and no published runtime or
      database port.

### Task 2: Make local commands Docker-first without recursion

- [x] **2.1 Rename current command bodies to internal targets.** Preserve each
      current pnpm operation under `internal-setup`, `internal-dev`,
      `internal-dev-api`, `internal-build`, `internal-check`, `internal-test`,
      focused internal test targets, `internal-e2e-smoke`,
      `internal-paseo-smoke`, `internal-eval-smoke`, `internal-ci`, and
      `internal-clean`. Container commands must call these targets or their pnpm
      scripts directly, never the public Docker wrapper again.
- [x] **2.2 Add Docker-first public targets.** Implement: - `setup`: build the image and run the OpenCode platform check in `runner`; - `dev` and compatibility `dev-api`: start `postgres` and `agent-server`; - build/check/test/focused tests/E2E/eval/CI: one-shot `runner` commands; - `test-real-pg`: start healthy `postgres-test`, run the existing real-PG
      command with `DATABASE_URL` on the Compose network, then stop the
      ephemeral service without touching persistent `postgres` data; - `paseo-smoke`: run the existing external smoke in `runner`; - `managed-environment-smoke`: run the existing
      `smoke:managed-environment` command in `runner` with the ephemeral
      PostgreSQL admin URL; - `clean`: run only `docker compose down --remove-orphans` without `-v`;
      retain the existing host cleanup operation under explicit
      `internal-clean`/`clean-native` diagnostics rather than deleting Docker
      runtime/database volumes through the default target.
- [x] **2.3 Preserve explicit native diagnostics.** Add clearly named
      `*-native` aliases for deliberate host diagnostics, but do not reference
      them from normal public targets and do not describe them as the supported
      default.
- [x] **2.4 Update `.env.example`.** Keep host-native values as explicit
      diagnostics, document that Compose supplies container `HOST` and database
      URL, and retain the free-only operator override comment. Add no credentials.
- [x] **2.5 Check command expansion.** Run `make -n setup dev ci paseo-smoke
managed-environment-smoke clean`. Expected: public targets expand to Docker
      commands only and no Docker target recursively invokes itself.

### Task 3: Prove the container boundary early

- [x] **3.1 Start the Docker engine prerequisite.** Confirm `docker info` and
      `docker compose version` succeed. If the local OrbStack/Docker daemon is
      unavailable, stop and ask the user to start it; do not fall back to host
      Paseo/OpenCode.
- [x] **3.2 Build the image.** Run `make setup`. Expected: Node 24, pnpm 11.7,
      Paseo 0.1.110, and the matching Linux OpenCode 1.18.4 binary resolve inside
      the image; no macOS OpenCode package is selected.
- [x] **3.3 Snapshot unrelated host runtime state.** Record only sanitized host
      Paseo listener/PID and OpenCode child PID facts. Do not stop, inspect
      prompts, or copy provider logs.
- [x] **3.4 Start the isolated stack.** Run `make dev` and wait for Compose
      health. Expected: only `postgres` and `agent-server` are long-running task
      containers; host API is available at `127.0.0.1:3000`.
- [x] **3.5 Observe readiness.** Query `/health/live` and `/health/ready`.
      Expected: HTTP liveness is healthy and readiness confirms Paseo WebSocket,
      Workspace, and explicitly free model selection.
- [x] **3.6 Inspect effective container ownership.** Inside `agent-server`,
      record sanitized `node`, Paseo, and OpenCode executable/version/process
      facts plus HOME/XDG/PASEO_HOME/Runtime Cell root prefixes. Expected: every
      path is inside the container workspace/volume and no host home or binary
      path appears.
- [x] **3.7 Fix only observed blockers.** If image architecture, volume ownership,
      signal forwarding, health, or watcher behavior blocks the real path, make
      the smallest correction and record it under Decisions and discoveries.
      Defer polish, generalized platform support, and production hardening.

### Task 4: Run the real Managed Environment main flow

- [x] **4.1 Run the existing real path inside Docker.** Execute
      `make managed-environment-smoke` with the existing free-only model policy.
      Expected: Environment validate/import/read/publish, Session A Turn 1/2,
      and Session B Turn 1 all complete through container Paseo/OpenCode.
- [x] **4.2 Verify acceptance identities.** Inspect sanitized smoke evidence for
      one Session A RuntimeSession/Cell/Workspace/provider Agent reused across
      two turns and a distinct Session B RuntimeSession/Cell/Workspace/provider
      Agent. Expected Run lifecycle is `started -> output -> succeeded` and all
      outputs contain the stable real marker.
- [x] **4.3 Verify isolation claims.** Confirm Runtime Cells, Skill projection,
      receipts, Paseo HOME, and OpenCode XDG files exist only in Docker volumes;
      host `.local`, `~/.paseo`, and OpenCode auth/config paths were not used or
      modified.
- [x] **4.4 Recheck host runtime state.** Compare sanitized host Paseo/OpenCode
      PIDs/listener with the pre-run snapshot. Expected: unrelated host processes
      remain running and unchanged.
- [x] **4.5 Stop task services safely.** Run `docker compose down
--remove-orphans` without `-v`. Expected: no task container/listener
      remains; persistent Docker volumes remain intact.

### Task 5: Run supporting existing evidence

- [x] **5.1 Run the baseline external runtime smoke in Docker.** Execute
      `make paseo-smoke`. Expected: the existing exact marker succeeds through
      container Paseo/OpenCode with no host credentials.
- [x] **5.2 Run deterministic CI in Docker.** Execute `make ci`. Expected:
      existing type, format, docs, Exec Plan, unit, contract, integration,
      deterministic E2E, and build gates exit successfully. This is supporting
      evidence and must not redefine the real-path acceptance boundary.
- [x] **5.3 Run `git diff --check`.** Expected: no whitespace errors.
- [x] **5.4 Inspect repository state.** Review `git status --short`, complete
      diff, and generated/untracked files. Expected: no credentials, runtime
      homes, provider logs, smoke databases, node_modules, or `.local` content is
      tracked.

### Task 6: Synchronize authority and evidence

- [x] **6.1 Update README and command docs.** State Docker as the supported local
      default, list exact prerequisites/commands, explain native diagnostics, and
      distinguish development process isolation from production sandboxing.
- [x] **6.2 Update Feature and Component authority.** Record the observed
      Docker-local process isolation baseline in `docs/features.md` and the Paseo
      component while preserving `AgentRuntimePort` ownership and production
      non-goals.
- [x] **6.3 Update local operations and Security.** Document health, inspection,
      shutdown, preserved volumes, Docker-daemon prerequisite, host-loopback API,
      container-loopback Paseo/MCP, and forbidden host credential mounts.
- [x] **6.4 Record sanitized evidence.** Add an evidence packet with exact image,
      command, version, container/process/path-prefix, main-flow, supporting
      check, shutdown, and host-noninterference facts. Include no raw prompts,
      Skill bodies, credentials, provider errors/logs, host-sensitive paths, or
      full process environments.
- [x] **6.5 Update this plan continuously.** Record actual commands, outcomes,
      meaningful failed approaches, deferred findings, current blocker, next
      exact command, and cleanup state.

## Verification

- [x] `docker compose config` succeeds and exposes only host-loopback API port 3000.
- [x] `make setup` proves Node 24, pnpm 11.7, Paseo 0.1.110, and Linux OpenCode
      1.18.4 inside the image.
- [x] `make dev` starts a healthy PostgreSQL + complete Agent Server container.
- [x] `/health/live` and `/health/ready` succeed through `127.0.0.1:3000`.
- [x] `make managed-environment-smoke` proves the real A1/A2/B1 path inside
      Docker with same-Session continuation and second-Session isolation.
- [x] Container inspection proves runtime processes and state do not use host
      Paseo/OpenCode binaries, homes, credentials, or runtime directories.
- [x] Host Paseo/OpenCode PID/listener facts are unchanged before versus after.
- [x] `make paseo-smoke` succeeds inside Docker.
- [x] `make ci` succeeds inside Docker.
- [x] `git diff --check` succeeds and the final diff contains no generated or
      sensitive runtime state.
- [x] `docker compose down --remove-orphans` leaves no task container/listener
      and preserves named volumes.

## Documentation impact

- [x] README and `.env.example` describe Docker-first local commands.
- [x] Feature ledger reports only observed development process isolation.
- [x] Paseo component describes the container co-process topology and unchanged
      application boundary.
- [x] Local development/runbook and Security describe safe startup, readiness,
      inspection, shutdown, volume preservation, and no host credential mounts.
- [x] Public Contracts and ADRs remain unchanged; record why no update is needed.
- [x] Sanitized evidence packet records the actual real path and limits.

## Decisions and discoveries

- 2026-07-29: Use one Agent Server runtime container plus PostgreSQL, not separate
  API/runtime containers. Oracle review found that separation would require a
  Runtime MCP listener/security change, dynamic port discovery, and fragile
  cross-container path identity without improving the current Prove-stage user
  outcome.
- 2026-07-29: Preserve Paseo and Runtime MCP on container loopback. The earlier
  approval to expose MCP only on a Compose private network is no longer needed.
- 2026-07-29: Default all normal Make entrypoints to Docker; keep native commands
  explicit and non-default.
- 2026-07-29: Preserve persistent Docker volumes during normal cleanup. Any
  volume/database deletion remains a separate destructive Human Gate.
- 2026-07-29: The Docker/OrbStack daemon was unavailable during design. Runtime
  implementation evidence cannot be claimed until the user environment supplies
  a working Docker socket.
- 2026-07-29: The first Docker/Make implementation passed static checks but
  review found runner `.local` state leakage, insufficient credential excludes,
  `postgres-test` cleanup profile coverage, possible bind-mount dependency
  copy-up ambiguity, missing entrypoint signal forwarding, and stale dependency
  stamping. These were corrected before runtime verification.
- 2026-07-29: Spec review reached `SPEC_COMPLIANT`; final independent quality
  review reached `QUALITY_APPROVED` after adding image dependency stamps,
  fail-fast stale-image detection, explicit dependency copy, writable `.local`
  mount targets, and earlier `postgres-test` cleanup traps.
- 2026-07-30: Docker verification passed for the Managed Environment marker,
  baseline Paseo marker, and deterministic CI. The runner contract lane needed
  `maxWorkers=2` to avoid default-concurrency PGlite startup timeouts.
- 2026-07-30: Public Contracts and ADRs remain unchanged because this slice
  changes no public API, tenant boundary, durable schema, migration, or core
  dependency.

## Risks and recovery

- Linux and macOS optional OpenCode binaries differ. Never mount host
  `node_modules`; fail image setup if Linux OpenCode resolution fails.
- Bind-mounted watcher behavior may be unreliable on macOS. A container restart
  is the accepted fallback; watcher optimization is deferred.
- Free-model availability is external and unstable. Record provider availability
  failures as diagnostic non-acceptance evidence and never make the external
  smoke a deterministic PR gate.
- Named volumes can preserve stale development state. Use worktree-scoped
  Compose projects and an ephemeral tmpfs PostgreSQL service for real-PG/smoke
  evidence; do not add implicit destructive cleanup.
- If a change to public API, tenant/security boundary, durable state, migration,
  core dependency, merge, or destructive cleanup becomes necessary, stop and
  request a new Human Gate.
- Before any risky remediation, preserve this worktree and inspect its diff. Do
  not reset, clean, or delete older worktrees or retained evidence.

## Validation evidence

- Worktree created clean from `origin/master` at `0a7992b`.
- Approved design written and self-reviewed; placeholder scan and
  `git diff --check` passed before implementation planning.
- Oracle's completed review was recovered from durable OpenCode session history
  after the task-resume wrapper incorrectly surfaced `Task cancelled`. The
  review recommended the two-container topology recorded above.
- Static implementation evidence passed: `make -n setup dev ci paseo-smoke
managed-environment-smoke clean`, `docker compose config`,
  `docker compose --profile postgres-test config`,
  `node --check scripts/dev/docker-ensure-node-modules.mjs`, and
  `git diff --check`.
- 2026-07-30: A pnpm optional OpenCode tarball failure could exit successfully
  with an empty binary symlink; dependencies now use an explicit current-
  architecture npm install and verify the container OpenCode binary.
- 2026-07-30: BLOCKER-NOW: after migration 0019 moved runtime-session product
  identity from `scope_id` to `product_session_id`, the Managed Environment
  smoke evidence query was stale and returned zero runtime sessions; the query
  now filters product-session rows and selects the new identity column.
- 2026-07-30: Runtime verification blocker resolved. The sanitized primary and
  supporting evidence is recorded in
  `docs/evidence/docker-isolated-local-runtime-mve-evidence-packet.md`.

## Completion checklist

- [x] The real Managed Environment main flow ran entirely in Docker and met the
      A1/A2/B1 acceptance boundary.
- [x] Default local Make commands use Docker and do not use host Paseo/OpenCode.
- [x] Runtime/version/path/process and host-noninterference claims have direct
      sanitized evidence.
- [x] Existing baseline external smoke and deterministic CI ran inside Docker and
      are reported truthfully.
- [x] Implementation, README, Feature, Component, Security, Operations, evidence,
      and this plan agree.
- [x] No generated runtime state, credential, prompt, Skill body, provider log,
      raw provider error, or host-sensitive path is tracked.
- [x] Every non-blocking finding is deferred explicitly; no production hardening
      is smuggled into this slice.
- [x] Task containers are stopped, named volumes are preserved, and unrelated
      host runtime processes remain untouched.
- [x] This plan is moved to `completed/`, has `status: completed`, and contains no
      unchecked boxes only after all evidence exists or scope is transferred.

## Current blocker

No current blocker. Cleanup and post-cleanup Compose state verification are
complete; final review/commit/PR remain separate user decisions.

## Next exact command

Before handoff or commit, inspect the final diff and status:

```bash
git status --short
git diff --stat
```

## Cleanup state

Before cleanup, `agent-server` and `postgres` were healthy. Cleanup was
performed without `-v`; `docker compose ps` showed no running containers, and
the worktree-scoped named volumes remained present. No
destructive `-v` cleanup is authorized.
