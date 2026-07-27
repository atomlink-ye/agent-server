# Claude Memory API and built-in Skill MVE evidence packet

- **Status:** completed implementation evidence; production rollout deferred
- **Date:** 2026-07-27
- **Evidence class:** sanitized API/PostgreSQL and Runtime acceptance evidence

This packet records the observed minimum path without credentials, prompts, YAML,
full Skill text, raw owner IDs, local paths, provider errors, or unredacted
resource identifiers. Identifiers below are intentionally shortened and are not
lookup values.

## Build and migration

- Node 24 `pnpm check`: **passed**.
- Node 24 `pnpm build`: **passed**.
- The built module loaded the repository Skill asset successfully.
- Fresh PostgreSQL **16.14** applied migrations through `0017`.
- Deleting only the `0017` migration registry row and reapplying `0017`
  succeeded, proving migration restart idempotence for the final schema and
  immutable trigger setup.

## API journey

One clean authenticated owner scope was used. Identifiers are represented only
as `store-…`, `memory-…`, and `version-…` in this record.

1. Created one Store (`store-…`) in an owner-visible Product Workspace.
2. Created and read one stable Memory (`memory-…`) at a normalized relative
   path. Version 1 (`version-…`) returned its lowercase SHA-256 and byte size.
3. Replaced V1 with V2 using the V1 `content_sha256` precondition. The Memory
   ID stayed stable and the Version ID/hash changed.
4. Repeated the update with the stale V1 hash: **409
   `memory_precondition_failed`**, with no additional Version.
5. Submitted identical current content: **200 no-op**, retaining the V2 Version
   ID.
6. Reverted to V1 content: **200**, creating V3 with a new Version ID and V2 as
   its predecessor.
7. Created exactly **65,536 bytes** successfully.
8. **65,537 bytes**, NUL content, and a trailing high surrogate each returned
   **400**.
9. Duplicate Store/path returned **409 `memory_path_conflict`**.
10. A foreign authenticated scope received hidden **404**, with no cross-owner
    result.

## PostgreSQL integrity inspection

- Exactly **3** immutable Version rows existed for the exercised Memory.
- The predecessor chain was V1 → V2 → V3; the current pointer referenced V3.
- Invalid Version rows: **0**.
- Direct historical Version `UPDATE`: **rejected** by the immutable trigger.
- Malformed content byte-size Version insert: **rejected** by the database
  constraint.
- Pointerless Memory insert: **rejected** by the `NOT NULL`/deferred current
  Version relationship.
- The migration's current-pointer constraint was present and restart-safe.

## Runtime Skill journey

- The fresh rerun database was
  `agent_server_memory_api_mve_rerun_20260727_170214`.
- Paseo **0.1.110** and OpenCode **1.18.4** were used. The initially selected
  free model `opencode/mimo-v2.5-free` intermittently failed at the external
  provider generation boundary with safe `No provider available` / HTTP `401`;
  that Run produced no assistant Message.
- The final unchanged product canary used explicitly free
  `opencode/deepseek-v4-flash-free`.
- One published managed Agent referenced the server-owned
  `agent-server/memory-api` Skill.
- The successful fresh canary used Task `0706c22a-…`, Run `f08dcd25-…`, and
  assistant Message `70e7fbd4-…` (sanitized prefixes only). A provider binding
  was present and durable events were exactly `started → output → succeeded`.
- Durable assistant output contained exactly marker `MEMORY_API_SKILL_V1`, the
  authenticated GET Memory path, `content_sha256`, and the requirement for
  bearer authorization.
- The result proves Skill loading and API guidance, not Agent-side HTTP
  execution. No Runtime HTTP client, MCP/native tool, scoped credential, or
  Session resource attachment was claimed.

## Operations and known baseline

- The final Runtime stack stopped gracefully.
- PostgreSQL container and sanitized evidence databases were retained for review,
  including follow-up disposable Lark DB
  `agent_server_lark_memory_e2e_20260727_180328`.
- The disposable Lark API/worker/Paseo processes stopped gracefully; the
  one-time bearer process configuration and scratch were removed, so that token
  is no longer accepted.
- No automated tests or evals were authored for this slice.
- The PR #12 stale prompt assertions were repaired test-only during PR
  preparation by recording native create-time `systemPrompt` separately from
  current-Turn prompts; no production behavior changed. Final Node 24
  `pnpm run ci` passed: unit **370/370**, contract **71/71**, integration
  **143 passed / 36 skipped / 0 failed**, deterministic E2E **7/7**, and build
  passed. The docs check covered **92 files** and the Exec Plan checker passed
  **6 tests / 22 plans**. Fresh real PostgreSQL `pnpm test:real-pg` passed
  **74/74** across six files.

## Feishu two-Thread curl canary

The follow-up disposable canary used the existing `agent-test` profile and fixed
test group (group identifier intentionally not recorded). Two independent root
messages created two distinct Product Sessions. The effective free model was
`opencode/deepseek-v4-flash-free`.

An OpenCode build-mode shell/curl preflight called the loopback API and returned
the real Memory V1 ID, content marker, and `content_sha256`. This proves a
user-authorized disposable bearer supplied in the prompt could be used by the
test-only build-mode Agent; it does not create a reusable product HTTP tool,
credential transport, Session resource attachment, or production credential
capability.

Thread A completed the real GET → CAS POST → GET flow. Its Run was
`1e926761-…`; durable events were `started → output → succeeded`, the result
outbox was `delivered`, and the provider reply was read back from Feishu. The
stable Memory and Store identifiers are recorded only as `memory-…` and
`store-…`. V1's hash begins `7f5bdfd0`; V2's hash begins `d6e238c8`; V2 content
was the unique marker `LARK_MEMORY_E2E_A_1785147063_21044`.

Thread B completed in a distinct Session with Run `7fb24e2e-…`, the same
published AgentVersion, `started → output → succeeded`, and a delivered result
outbox. Its real curl GET observed Thread A's marker, V2 hash, and version 2.
Independent PostgreSQL inspection found exactly two Version rows: V1
`created`, V2 `modified`, V2 current, and V2's predecessor pointing to V1.
Both provider replies matched the durable DB facts; Thread B created no extra
Version.

One initial exploratory root failed before acceptance because the temporary
Lark owner tuple used the policy Workspace value instead of the Product
Workspace UUID. It is retained only as non-acceptance setup diagnostics; the
final A/B pair passed after the tuple was aligned.

## Deferred boundary

CLI, MCP/native HTTP tools, Runtime credentials/capabilities, Agent-side API
execution, Session resources, public Version history/redaction/rollback,
archive/delete, path rename, filesystem projection, retrieval/vector search,
Skills marketplace, and physical legacy Memory cleanup remain deferred.
