# Platform Extension Injection MVE-EXT1 evidence

Recorded: 2026-07-28

## Claim and boundary

This packet records one isolated real-path proof that Agent Server can bind one
platform-owned native Skill and one read-only Agent Server MCP Tool to a real
Paseo/OpenCode Agent, then reuse that extension binding on a second Product
Session turn.

It proves an MVE main flow, not a production credential boundary, durable
extension binding, restart recovery, multi-version concurrency, a public Skill
Registry, or multi-Runtime compatibility.

## Source and runtime

- Agent Server baseline: `2994bfebf7448db96548962483eea1fb5a6e6d25`
- Feature branch: `agent/platform-extension-injection-mve-ext1`
- Node: `v24.18.0`
- pnpm: `11.7.0`
- Paseo: `0.1.110`
- OpenCode: `1.18.4`
- MCP TypeScript SDK: `1.30.0`
- PostgreSQL: retained local PostgreSQL 16 container at the existing caller
  supplied boundary

## Native Skill probe

The real Paseo/OpenCode Skill probe passed repeatedly:

- logical Skill ref: `agent-server/memory-api`
- immutable digest prefix: `5f37168bf483`
- project projection: symlink to the exact Registry object
- marker returned: `MEMORY_API_SKILL_V1`
- marker absent from native system prompt and initial prompt
- full Skill body not used as an inline Bootstrap fallback

The exact host path and full Skill content are intentionally omitted.

## Direct MCP probe

The real loopback MCP transport probe passed:

- endpoint: `/mcp/agent-runtime`
- logical Tool ref: `agent-server/memory-read`
- MCP Tool name: `agent_server_memory_read`
- visible authorized Tools: 1
- exact read marker: `PLATFORM_EXTENSION_MVE_OK`
- wrong bearer: HTTP `401`
- oversized request: HTTP `413`
- foreign Workspace: safe `not_found`
- no-Tool Grant: zero visible Tools

The bearer value was neither printed nor written to this packet.

## Joined real main flow

Canonical command shape:

```bash
POSTGRES_ADMIN_URL="<caller-provided-admin-url>" \
  node --import tsx scripts/smoke/platform-extension-main-flow.mjs
```

Final sanitized output:

```json
{
  "success": true,
  "database_name": "agent_server_platform_ext_1785223897751_cc604963",
  "marker": "PLATFORM_EXTENSION_MVE_OK",
  "turn_count": 2,
  "distinct_ids": true,
  "same_provider_agent": true,
  "exact_outputs": [true, true],
  "event_types": ["started", "output", "succeeded"],
  "receipt_counts": { "skill": 1, "grant": 1 },
  "receipt_evidence": {
    "skill": true,
    "grant": true,
    "workspace_scope": true,
    "session_scope": true,
    "allowed_tool": true
  },
  "skill_digest_prefix": "5f37168bf483",
  "authorization_header_persisted": true,
  "runtime_state_removed": true,
  "paseo_version": "0.1.110",
  "opencode_version": "1.18.4"
}
```

The database records:

- one Product Workspace and one Memory Store;
- one stable Memory at `canary/platform-extension.md` whose content is the
  hidden marker;
- one published managed AgentVersion referencing the exact Skill and Tool;
- one Product Session;
- two distinct root Tasks and Runs;
- two `started → output → succeeded` event sequences;
- two assistant Messages equal to the hidden marker; and
- two Runtime bindings with the same provider Agent ID.

The marker was absent from both user turns. Its appearance in both assistant
outputs therefore depends on the real authorized Tool read, rather than prompt
echo or inline Skill content.

## Diagnostic run

Database `agent_server_platform_ext_1785210827232_a1fd5865` is retained as
non-acceptance diagnostic evidence. Its first Run succeeded with complete events
and a provider binding, and the assistant output contained the hidden marker.
The initial harness stopped before Turn 2 only because it required exact output
and the free model added explanatory text. The harness was tightened and the
final fresh run returned exact text on both turns.

## Known deviation and cleanup

Paseo `0.1.110` serializes external MCP headers in its Agent record. The user
explicitly chose not to patch Paseo before validating the main flow. The canary
therefore used a disposable isolated Runtime root, detected the persisted header
only as a boolean, stopped Agent Server/Paseo/OpenCode/MCP, and removed that root.

This deviation blocks production credential claims but does not invalidate the
observed isolated main flow. No bearer, service-account token, raw prompt, full
Skill body, provider error dump, or host path is retained in this packet.

## Verification policy

No new standalone unit, contract, integration, deterministic E2E, or evaluation
test files were added. Existing fixtures and assertions were updated for the new
resolved package, configuration, and continuation contracts. The real two-turn
canary remains the primary acceptance evidence.

After stale managed-package fixtures were updated for the required `tools` field
and normalized `toolRefs`, the existing suite passed under Node `v24.18.0`: 370
unit tests, 71 contract tests, and 143 integration tests passed; 36 integration
tests were skipped by their existing conditions. `pnpm check`, `pnpm build`, and
`git diff --check` also passed.
