# User-authored Skill pre-start registration evidence

Recorded: 2026-07-28

## Boundary

This packet records one real V1 flow for a user-authored, no-Tool Skill:
project registration before the first provider Agent is created, followed by
API import, publish, Product Session creation, and one real Paseo/OpenCode
turn. It is a local MVE proof, not a production upload service or hot-reload
claim.

## Runtime and acceptance status

- Node: v24.18.0
- Paseo: 0.1.110
- OpenCode: 1.18.4
- PostgreSQL: caller-provided local PostgreSQL boundary

## Sanitized result

Command shape:

```bash
POSTGRES_ADMIN_URL="<caller-provided-admin-url>" pnpm smoke:user-skill
```

Accepted Node 24 result:

```json
{
  "success": true,
  "database_name": "agent_server_user_skill_1785230713967_bd0d4c14",
  "marker": "USER_AUTHORED_SKILL_V1_OK",
  "registration_changed_first": true,
  "registration_changed_second": false,
  "registration_same_digest": true,
  "turn_count": 1,
  "exact_output": true,
  "event_types": ["started", "output", "succeeded"],
  "provider_agent_present": true,
  "custom_skill_receipts": 1,
  "grant_receipts": 0,
  "projection_is_symlink": true,
  "projection_under_registry": true,
  "provider_record_found": true,
  "marker_absent_from_provider_system_prompt": true,
  "marker_absent_from_submitted_user_prompt": true,
  "mcp_config_persisted": false,
  "logical_manifest_valid": true,
  "object_manifest_valid": true,
  "files_digest_valid": true,
  "digest_prefix": "49618727f79d",
  "runtime_state_removed": true,
  "paseo_version": "0.1.110",
  "opencode_version": "1.18.4"
}
```

The accepted canary found the exact persisted provider Agent record and verified
that its persisted `config.systemPrompt` omitted the marker. It separately
verified that the initial user prompt submitted by the harness omitted the
marker. Paseo `0.1.110` does not persist a separate `initialPrompt` field, so the
canary does not claim persisted initial-prompt evidence.

The first CLI registration changed the immutable Registry, and the immediate
identical registration was idempotent. The real API then imported and published
the Agent, started one Product Session, and completed one exact marker turn with
a provider binding and the expected event sequence.

The logical and content-only object manifests, every file hash and size, the
length-prefixed package digest, immutable modes, and the sole mode-0444 Skill
receipt were independently validated. The project projection was a direct
symlink to the expected immutable Registry object. There were no Tool Grant
receipts and no persisted external MCP configuration: the harness parsed the
exact bounded provider record and rejected any `mcpServers` or `mcp_servers`
key, including empty or non-authenticated values.

All disposable project, Registry, and Runtime state was removed before success
was emitted. The accepted evidence database
`agent_server_user_skill_1785230713967_bd0d4c14` remains retained for review.

## Explicit non-claims

This flow does not prove same-ref V2 updates while an older Session remains
active, per-provider isolated project CWDs, upload APIs, tenant-owned durable
Skill storage, hot reload, or Team child extensions. Those are deferred.

Prompts, Skill bodies, host paths, credentials, tokens, and raw provider or
filesystem errors are intentionally absent.
