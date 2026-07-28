# User-authored Skill pre-start registration runbook

## Purpose and boundary

This runbook describes the current local MVE: register a project-local
user-authored Skill into the configured immutable local Registry before the
first provider Agent starts, then import and publish the Managed Agent and
start a new Product Session. It is not a production upload service.

The trusted boundary is a quiescent project tree, a trusted operator, and a
single writer for the configured Registry. Registration is expected to happen
before provider execution; do not edit a Skill package while registration is
running.

## Project layout

```text
<project>/
├── agent.yaml
└── skills/
    └── market-guide/
        └── SKILL.md
```

Every immediate directory under `skills/` is a Skill leaf. The leaf directory
name must match the final segment of its declared logical reference.

## Agent package and reference rule

The complete managed Agent package is an `agent.yaml` with the normal
`apiVersion`, `kind`, `metadata.name`, and `spec` fields. Its runtime, input,
session, memory, permissions, and completion sections remain part of the
normal Managed Agent contract. Local Skills are declared under:

```yaml
spec:
  tools: []
  skills:
    - ref: project/<metadata.name>/<leaf-directory>
```

For this flow, `metadata.name` is `research-agent` and the Skill ref is
`project/research-agent/market-guide`. A project ref must belong to the same
project name, must have exactly one leaf segment after that prefix, and every
directory under `skills/` must be declared exactly once. Missing, mismatched,
or unreferenced leaves are rejected.

## `SKILL.md` frontmatter

The frontmatter `name` is the leaf name and must be non-empty with a non-empty
description:

```markdown
---
name: market-guide
description: Provides market guidance.
---

Skill instructions and guidance follow the frontmatter.
```

The package is registered as immutable content. The Registry stores a logical
ref manifest and content-addressed object. Re-registering identical content
is idempotent; changed content produces a new digest for the same ref.

## Shared Registry configuration

The CLI and Agent Server must use the same absolute Registry root:

```bash
export AGENT_SERVER_SKILL_REGISTRY_ROOT="$PWD/.local/skill-registry"
```

Do not run a second runtime-derived Registry. The project and Registry should
be quiescent and owned by one registration writer during the operation.

## Register and inspect sanitized output

From the repository root:

```bash
pnpm skill:register -- --project "$PROJECT"
```

Successful output contains only registration records, including `ref`,
`digest`, and `changed`:

```json
{
  "registered": [
    {
      "ref": "project/research-agent/market-guide",
      "digest": "<sha256>",
      "changed": true
    }
  ]
}
```

An immediate identical invocation should report `changed:false` with the same
digest. Do not copy prompts, Skill bodies, tokens, or local paths into logs or
handoffs.

## Start the real Agent flow

1. Import the complete `agent.yaml` through the Agent Server API.
2. Publish the returned AgentVersion.
3. Create a new Product Session for the published version.
4. Send the first Task/Run turn and require the Skill result exactly.

The first provider Agent must not start before registration has succeeded. A
no-Tool Skill should create a Skill projection and receipt, but no Runtime
Tool Grant or external MCP configuration. The smoke acceptance checks bounded
structured Paseo/OpenCode state for any `mcpServers`/`mcp_servers` key,
including empty or non-authenticated values, and requires
`mcp_config_persisted:false`.

## Stable errors and recovery

The CLI reports sanitized stable codes for common failures:

- `CLI_INVALID_ARGUMENTS` — missing or malformed `--project` arguments.
- `PROJECT_MISSING` / `PROJECT_INVALID` — project tree is absent or unsafe.
- `INVALID_AGENT_PACKAGE` — `agent.yaml` cannot be parsed as a Managed Agent.
- `PROJECT_REF_MISMATCH` — a project ref belongs to another Agent name.
- `MISSING_LOCAL_SKILL` — a declared leaf directory is absent.
- `MISMATCHED_LOCAL_SKILL` — a ref has an invalid leaf shape or duplicate.
- `UNREFERENCED_LOCAL_SKILL` — a local leaf is not declared.
- `REGISTRY_FAILURE` — immutable Registry registration failed.

Stop and inspect the sanitized code only. Restore a quiescent, trusted project
tree before retrying. Do not delete immutable objects to force a registration.

## Current scope and deferred work

The tested scope is registration before the first provider Agent for one
user-authored Skill. Same-ref V2 updates while an older Session remains active,
per-provider isolated project CWDs, an upload API, tenant-owned durable Skill
storage, hot reload, and Team child extensions are explicitly deferred.

This local MVE must not be presented as a production upload or multi-tenant
Skill service.
