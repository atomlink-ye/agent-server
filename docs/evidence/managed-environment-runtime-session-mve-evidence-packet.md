# Managed Environment Runtime Session MVE Evidence

## Acceptance result

The canonical real MVE-ENV1 smoke completed successfully under Node 24 using
Paseo `0.1.110`, OpenCode `1.18.4`, and model `opencode/north-mini-code-free`.
The retained acceptance database is named
`agent_server_managed_env_1785255658420_fef8f5b0`.

Sanitized facts:

- Three turns completed: Session A1, A2, and Session B1.
- All three outputs contained `MANAGED_ENVIRONMENT_MVE_OK`.
- A1 and A2 reused one provider Agent and Workspace.
- B1 used a distinct provider Agent and Workspace.
- There were exactly two RuntimeSessions, two Runtime Cells, and two launch
  snapshots, with the published EnvironmentVersion pinned in both sessions.
- Each Cell had one native Skill projection, one Skill receipt, and one Grant
  receipt.
- Every Run emitted `started`, `output`, `succeeded` in order.
- Provider system-prompt checks passed; submitted prompts and persisted native
  system prompts did not contain the acceptance marker or full Skill body.
- Disposable runtime state was removed after the run.

Command shape (the administrator URL is intentionally not retained):

```bash
POSTGRES_ADMIN_URL=<local retained PostgreSQL admin URL> \
PASEO_MODEL=opencode/north-mini-code-free \
pnpm smoke:managed-environment
```

## Boundaries and diagnostics

The smoke exercised authenticated HTTP validation, import, read, publish,
workspace/memory seeding, Agent publication, ProductSession creation, message
admission, durable Run evidence, RuntimeSession/Cell binding, native Skill
projection, read-only MCP Tool use, and cleanup. It did not expose bearer
tokens, raw prompts, Skill text, MCP headers, provider logs/errors, or host
paths.

Several earlier external-provider attempts timed out or failed before the full
acceptance evidence boundary. They are diagnostic observations only and are
not acceptance evidence. The successful run is the authority for this packet.

The successful workspace root-cause investigation found that Paseo
`openProject` deduplicates an existing Workspace, while the managed Cell path
uses `createWorkspace`; this preserves one Workspace per managed Cell and
explains the A reuse/B distinction observed by the smoke.

Known deviation: Paseo persisted an external MCP Authorization header in its
runtime state, matching the known PR #14 deviation. The disposable runtime was
removed; no credential or raw header is recorded here.

## Cleanup

The task-specific API, Paseo, OpenCode, and MCP processes were stopped, and the
disposable Registry/Runtime/Cell roots were removed. The acceptance PostgreSQL
database was retained by name for review.

## Deferred work

Transaction-concurrency hardening, crash recovery and restart reconstruction,
legacy nullable Session cleanup, grant renewal and external-header persistence,
Host placement and GC, a second adapter, production isolation, and broader
tests remain deferred. This packet does not claim Runtime Session V2 or
production readiness.
