# Docker-isolated local runtime MVE evidence

## Status

Sanitized evidence recorded after successful Docker verification. This packet
proves local development process isolation only. It does not claim production
sandboxing, tenant execution isolation, placement, or Runtime Session V2.

## Toolchain and topology

- Image toolchain: Node `v24.18.0`, pnpm `11.7.0`, Paseo `0.1.110`, OpenCode
  `1.18.4`.
- Long-lived Compose services: `postgres` and one `agent-server` co-process
  container.
- One-shot verification service: `runner`.
- Ephemeral real-PostgreSQL service: `postgres-test` profile on tmpfs.
- Source is bind-mounted from the current worktree. Linux `node_modules`,
  `.local`, Paseo HOME, and OpenCode XDG state are Docker-volume state.
- The only host-published port is `127.0.0.1:3000:3000`. PostgreSQL, Paseo,
  OpenCode, and Runtime MCP have no host-published ports.
- Compose uses `init: true`; the API, Paseo, OpenCode, and Runtime MCP remain
  inside the Agent Server container.

## Commands and results

### Primary real flow

```text
make managed-environment-smoke
```

Result: succeeded with marker `MANAGED_ENVIRONMENT_MVE_OK`.

Sanitized acceptance facts:

- `turn_count`: `3`
- `distinct_ids`: `true`
- `same_provider_agent`: `true`
- `exact_outputs`: `true`
- `provider_workspace_reuse`: `true`
- `provider_workspace_distinct`: `true`
- `provider_distinct`: `true`
- `two_cells`: `true`
- projection and receipts: `true`
- event types: `started`, `output`, `succeeded`
- `authorization_header_persisted`: `true`
- `runtime_state_removed`: `true`

This demonstrates Session A continuation and distinct Session B runtime
identity, workspace, provider agent, and Runtime Cell behavior through the
containerized Paseo/OpenCode path.

### Supporting runtime smoke

```text
make paseo-smoke
```

Result: succeeded with marker `PASEO_OPENCODE_BASELINE_OK`; provider
`opencode`, model `opencode/deepseek-v4-flash-free`, status `succeeded`.

### Deterministic CI

```text
make ci
```

Result: passed. Checks included types, formatting, documentation, Exec Plans,
unit tests (64 files / 370 tests), contract tests (7 files / 71 tests),
integration tests (12 passed + 7 skipped / 143 passed + 36 skipped),
deterministic E2E (5 files / 7 tests), and build.

## Important fixes captured by this evidence

1. A pnpm optional OpenCode tarball failure could leave an empty symlink while
   exiting successfully. The image now explicitly installs and verifies the
   current-architecture OpenCode binary.
2. PR16 migration 0019 moved runtime-session product identity to
   `runtime_sessions.product_session_id`; the Managed Environment evidence query
   now uses that identity and filters product-session rows.
3. Docker runner contract tests encountered default-concurrency PGlite startup
   timeouts. Contract Vitest concurrency is capped at two workers for stable
   Docker CI.
4. A host `.pnpm-store` created during debugging is ignored by Git and
   formatting checks. It is not evidence or runtime state tracked by the repo.

## Boundary and limits

- No host Paseo/OpenCode home, binary, credential, prompt, raw provider log, or
  raw provider error is retained in this packet.
- Public Contracts and ADRs are unchanged: this slice changes no public API,
  tenant boundary, durable schema, migration, or core dependency.
- Cleanup used `docker compose down --remove-orphans` and
  `docker compose --profile postgres-test rm -sf postgres-test` without `-v`.
  A post-cleanup `docker compose ps` showed no running task containers, and the
  named volumes remained present.
