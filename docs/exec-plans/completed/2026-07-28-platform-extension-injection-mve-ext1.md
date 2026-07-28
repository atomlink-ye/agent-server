---
status: completed
owner: orchestrator
created_at: 2026-07-28
updated_at: 2026-07-28
authority: execution-plan
---

# Platform Extension Injection MVE-EXT1

## Outcome

Prove one complete real path in which a published managed AgentVersion resolves
the platform-owned `agent-server/memory-api` Skill to one immutable local object,
projects it into an isolated OpenCode project through a symlink, and receives one
scoped read-only `agent_server_memory_read` Tool through Paseo `mcpServers`.
Two real Product Session turns must reuse the same provider Agent and return the
exact stored marker `PLATFORM_EXTENSION_MVE_OK` without repeating Skill
materialization or placing the full Skill body in the native system prompt.

## Context and authority

- User approved the complete MVE-EXT1 Human Gate on 2026-07-28, including the
  core MCP SDK dependency, loopback MCP endpoint, in-process Runtime Tool Grant,
  runtime contract extension, and real two-turn canary. Merge, destructive
  cleanup, and production claims remain separate Human Gates.
- User approved the follow-on local user-authored Skill registration slice on
  2026-07-28. It adds no public upload API: project Skills are registered before
  the first provider-Agent creation. Same-ref V2 coexistence across old/new
  provider Agents and isolated per-provider project CWDs are explicitly deferred.
- Branch: `agent/platform-extension-injection-mve-ext1` in isolated worktree
  `.worktrees/platform-extension-injection-mve-ext1`.
- Baseline: live `origin/master` / `2994bfebf7448db96548962483eea1fb5a6e6d25`.
- Product stage: `Prove`; the primary evidence is the real Paseo 0.1.110 /
  OpenCode 1.18.4 path. Existing test fixtures and assertions are supporting
  evidence and were updated where the resolved package/config contracts changed.
- Approved external design and roadmap:
  `platform-tools-skills-registry-design-paseo-mcp-injection-immutable-skill-registry-workspace-symlink-projection-2026-07-28.md`
  and
  `platform-extension-injection-mve-first-development-roadmap-opencode-skill-symlink-agent-server-mcp-tool-2026-07-28.md`.
- No separate repository Spec is retained; the approved external SDD plus this
  executable Plan are the design and execution authorities for this slice.

## Scope

- One filesystem Registry shared by the built-in Memory Skill and validated
  project-directory Skills registered before provider-Agent creation.
- One immutable digest object, logical ref, project symlink, and sanitized local
  materialization receipt.
- One supported managed Agent tool ref: `agent-server/memory-read`.
- One loopback Streamable HTTP MCP endpoint using the official v1 TypeScript SDK
  and its public stateful session lifecycle.
- One random in-process bearer Grant bound server-side to tenant, principal,
  Product Workspace, Product Session, and the read-only Tool.
- One Tool handler that reads the current immutable Memory Version through the
  existing exact-owner Memory repository boundary.
- Create-time extension binding only; continuation reuses the same provider
  Agent, Skill projection, and Grant.
- One real canary Store/Memory, one published managed AgentVersion, one Product
  Session, and two turns on the same provider Agent.
- One local project registration command, logical ref to immutable digest object,
  and one real pre-start V1 canary proving a user-authored Skill reaches a newly
  created provider Agent.

## Non-goals

- No public Skill Registry API, database Registry schema, durable Grant,
  rotation, restart recovery, reset/rebind, second Runtime, write Tool, approval
  flow, remote importer, `npx skills`, scripts execution, GC, or production
  hardening.
- No concurrent different Skill versions in one workspace and no fallback copy,
  junction, bind mount, or inline Skill body.
- No Memory schema or public Memory API changes, Lark changes, Team changes, or
  legacy Memory cleanup.
- No broad new unit, contract, integration, deterministic E2E, fixture, or
  evaluation suite. After the user requested the real custom-Skill test, existing
  fixtures/assertions were updated only where changed contracts required it;
  canonical smoke scripts remain the primary evidence.
- No commit, push, PR, merge, retained-process cleanup, or evidence deletion
  without the corresponding explicit authorization.

## Work breakdown

- [x] Probe the exact runtime boundary first: seed one immutable Skill object,
      create the project symlink, and prove OpenCode follows and natively loads
      it under the existing Paseo daemon flags.
- [x] Replace body-only built-in Skill resolution with the minimum immutable
      runtime package metadata and stop rendering full native-project Skill text
      in Bootstrap.
- [x] Resolve only `agent-server/memory-read`; reject unsupported Tool refs and
      verify each Skill's required Tool is present.
- [x] Add the official MCP SDK, a loopback endpoint, the one read-only Tool, and
      an in-process scoped Grant. Agent Server stores only its hash; the known
      Paseo header-persistence deviation is isolated and recorded below.
- [x] Extend `AgentRuntimePort` create input and the Paseo client seam with a
      provider-neutral extension binding / canonical `mcpServers`; keep
      application code free of OpenCode-specific MCP JSON.
- [x] Materialize and issue the extension binding before provider Agent create;
      retain it for continuation and fail closed if the expected binding is
      absent.
- [x] Run the joined real Turn 1 path and fix only `BLOCKER-NOW` defects.
- [x] Run Turn 2 in the same Product Session and prove the same provider Agent,
      one materialization receipt, no repeated Bootstrap/Skill body, and a
      second successful Tool call.
- [x] Record one sanitized evidence packet and defer broader Feature, Component,
      Contract, ADR, and runbook productization until the owner chooses to move
      beyond the validated main-flow MVE.
- [x] Generalize the immutable Registry and resolver from the one built-in Skill
      to validated project-directory Skill refs without adding a public upload
      API.
- [x] Add a sanitized local pre-registration command sharing the same configured
      Registry root as Agent Server.
- [x] Pass one digest-pinned Skill snapshot from managed Agent resolution through
      the create-only Runtime binder; continuation must not re-resolve or rebind.
- [x] Run the real pre-start V1 canary: register one project Skill, import/publish
      the Agent, create one Product Session, and return the exact Skill-only
      marker through the real Paseo/OpenCode path.
- [x] Record sanitized evidence, supporting checks, and the deferred upload,
      tenant, storage, GC, and production-hardening work.

## Verification

- [x] Step A probe: registry manifest hash is deterministic; `lstat` identifies
      a symlink; `realpath` resolves to the exact object under the Registry root;
      a real Agent returns a marker found only in `SKILL.md` while both prompts
      omit the marker and the system prompt omits the full body.
- [x] Direct MCP boundary: the real loopback transport exposes exactly one
      authorized Tool and returns the exact marker; wrong bearer is `401`, an
      oversized body is `413`, a foreign Workspace is hidden as `not_found`, and
      a no-Tool Grant sees an empty catalog. Paseo's existing daemon flags remain
      unchanged for the joined path.
- [x] Canonical smoke: two real Product Session turns both return exactly
      `PLATFORM_EXTENSION_MVE_OK`; provider Agent ID is unchanged; exactly one
      materialization receipt exists; both safe Tool calls are observable.
- [x] Durable Task/Run/assistant Message and normalized lifecycle events remain
      present for both turns.
- [x] Evidence contains no bearer token, service-account secret, full Skill
      text, raw prompt, provider error dump, or real host path.
- [x] Run `pnpm check`, `pnpm build`, and `git diff --check` under Node 24 after
      the real E2E. Existing broader tests remain supporting checks; fixture and
      assertion updates cover the new package/config/continuation contracts.
- [x] User-authored Skill canary proves one exact V1 marker output, prompt
      absence, immutable symlink/receipt truth, zero Tool Grants, durable evidence,
      and cleanup. V1→V2 coexistence is deferred until provider projects are
      isolated.
- [x] Re-run the existing full suite, `pnpm check`, `pnpm build`, and
      `git diff --check` after the follow-on canary.

## Documentation impact

- [x] Keep `docs/features.md` unchanged: the local MVE is proven but is not a
      production/public Skill Registry baseline.
- [x] Transfer Component and Contract convergence to post-MVE productization;
      this slice does not declare a public upload, tenant storage, Team extension,
      or long-lived Grant contract.
- [x] Add sanitized built-in/custom evidence packets and the local pre-start
      registration runbook. An ADR is deferred until the production ownership,
      upload/storage, project isolation, and Grant-lifetime decisions are made.

## Decisions and discoveries

- Paseo 0.1.110 types and installed implementation accept per-Agent
  `mcpServers`; `--no-mcp` and `--no-inject-mcp` disable Paseo's own MCP surface
  and automatic injection, not the explicit external per-Agent config. This is
  version-specific and must still be proven through the real daemon.
- OpenCode 1.18.4 officially discovers `.agents/skills/<name>/SKILL.md`, but its
  symlink behavior is undocumented; Step A is therefore a blocking Probe.
- Use the MCP SDK v1 Streamable HTTP server. SDK 1.30.0 rejected follow-up
  requests when a fresh sessionless transport was created per request, so the
  MVE uses its public stateful `Mcp-Session-Id` lifecycle. Every request still
  reauthenticates the bearer, and each opaque MCP session is bound to the same
  Grant. Authenticate at the Node boundary and derive all owner scope from the
  resolved Grant, never Tool parameters.
- The existing managed package parser already retains Tool refs as data; this
  slice adds one execution-time allowlist rather than changing the public package
  schema.
- Darwin rejects `rename(2)` when the moved directory root is already `0555`.
  The MVE therefore treats atomic canonical logical-ref publication—not digest
  directory appearance—as the authorization point: a same-filesystem staged
  object is installed, made fully `0555/0444`, reverified, and only then exposed
  through a no-clobber hard-linked ref manifest. Unreferenced objects are
  unauthorized orphans and never resolve.
- The pinned Paseo client does not expose native Skill catalog/timeline through
  the repository seam. Native discovery is established by the exact hidden
  `MEMORY_API_SKILL_V1` marker returned by a real Agent while absent from both
  native system prompt and initial prompt, together with the exact project
  symlink/digest evidence. Spec and quality review accepted this MVE boundary.
- User decision after the V1→V2 investigation: finish the one-Skill pre-start
  main flow before production/security hardening. Shared-project V2 coexistence,
  per-provider project isolation, and same-ref continuation admission behavior
  are transferred to deferred work.
- Runtime Tool Grants currently expire after five minutes. The immediate real
  two-turn canary passes, but longer-lived Tool sessions have no renewal path and
  may lose Tool access. Session-lifetime alignment or continuation-safe renewal
  is explicitly deferred hardening, not a claim of this MVE.

## Risks and recovery

- Symlink target and final `realpath` must stay under the Registry root; never
  overwrite an unmanaged target and never recursively delete through a link.
- Registry object mismatch, missing native discovery, missing external MCP,
  owner-scope ambiguity, secret exposure, or continuation rebinding is
  `BLOCKER-NOW` and stops the slice.
- The filesystem Registry and receipts live only under ignored `.local` runtime
  state. Recovery before merge is removal of this new worktree plus separately
  authorized cleanup of its isolated generated state; retained Memory evidence
  infrastructure is not touched.
- If Skill discovery fails, inspect exact CWD, link/realpath, runtime catalog,
  and pinned versions. Do not restore the full inline body and claim success.

## Validation evidence

- Baseline Node `v24.18.0`, pnpm `11.7.0`, and `pnpm check` passed in the new
  clean worktree before implementation.
- Initial Step A passed twice consecutively under Node `v24.18.0` before the
  generalized length-prefixed digest framing: immutable digest
  `387fecc6...c8b8c467`, project symlink and Registry realpath verified, and a
  real Paseo `0.1.110` / OpenCode `1.18.4` Agent returned exactly
  `MEMORY_API_SKILL_V1` without that marker in either prompt. Spec compliance and
  independent quality/security review passed. A bounded cleanup retry handles
  one observed late Paseo metadata write; production cleanup hardening remains
  deferred.
- The direct loopback MCP Probe passed under Node 24 with the official SDK
  `1.30.0`: exactly one `agent_server_memory_read` Tool, exact marker read,
  wrong bearer `401`, oversized request `413`, foreign Workspace hidden, and an
  empty Grant exposing zero Tools. Spec and independent quality/security review
  passed after fixing session registration/cleanup through the SDK's public
  callbacks.
- Production wiring reached the real Paseo create boundary, but independent
  source review found Paseo `0.1.110` persists the complete external
  `mcpServers` configuration, including `Authorization`, in its serialized Agent
  record. Released `0.2.3` retains the same behavior and exposes no transient
  external-MCP-header seam. This remains a production credential-boundary gap,
  not a blocker for the explicitly isolated disposable canary.
- User decision on 2026-07-28: do not patch Paseo or require the complete target
  design before observing the main flow. Proceed with one isolated disposable
  canary, record header persistence as a known deviation, remove the isolated
  Runtime state after the run, and judge this slice only on whether the real
  Skill + MCP Tool + same-Agent two-turn path works. This does not waive or solve
  the production credential boundary.
- A first diagnostic database
  `agent_server_platform_ext_1785210827232_a1fd5865` proved a successful first
  Run with `started → output → succeeded`, a provider binding, and the hidden
  marker present in the assistant output. The initial harness required exact
  text and stopped before Turn 2 because the free model added explanatory text;
  no production defect was found.
- The latest final built-in acceptance database
  `agent_server_platform_ext_1785223897751_cc604963` records two distinct
  Task/Run pairs in one Product Session. Both Runs succeeded, both assistant
  outputs equal `PLATFORM_EXTENSION_MVE_OK`, both event sequences are
  `started → output → succeeded`, and both bindings use the same non-null
  provider Agent ID. Exactly one Skill receipt and one Grant receipt existed.
  The isolated Runtime root, including Paseo's persisted Authorization header,
  was removed after shutdown.
- Final Node `v24.18.0` `pnpm check`, `pnpm build`, and `git diff --check`
  passed. The docs checker covered 98 Markdown files and the Exec Plan checker
  passed all 6 checks across 23 plans. No new standalone product test file was
  added; existing fixtures and assertions were updated for changed contracts.
- The existing full suite also passed after stale managed-package test fixtures
  were updated for required `tools` and normalized `toolRefs`: 370 unit tests,
  71 contract tests, and 143 integration tests passed; 36 integration tests were
  skipped by their existing conditions.
- The final user-authored Skill database
  `agent_server_user_skill_1785230713967_bd0d4c14` records one exact V1 turn
  through real CLI registration, Agent import/publish, Product Session, Paseo,
  and OpenCode. Registration was `changed: true` then idempotent `false`; one
  exact immutable Skill receipt existed, Tool Grant receipts were zero, the
  exact persisted provider record had no MCP config, and all disposable state
  was removed.

## Completion checklist

- [x] MVE-EXT1 exit condition is met through the real two-turn path.
- [x] No main-flow `BLOCKER-NOW` remains; all non-blocking findings are deferred.
- [x] Implementation and authority docs agree with observed behavior.
- [x] No generated credential, prompt, raw provider output, or unmanaged path is
      tracked.
- [x] Plan is truthful, all non-current work is explicitly transferred, and this
      document is archived under `completed/` after final review.

## Current blocker

None for the approved isolated main-flow MVE. Known production/hardening gaps:
Paseo `0.1.110` serializes external MCP headers, Grants expire after five minutes
without renewal, and old/new Skill digests cannot coexist in the shared provider
project. The canaries use disposable isolated Runtime state and make no
production claim.

## Next exact command

Preserve the uncommitted worktree as requested. A later owner decision may choose
commit/PR delivery or start a separate hardening slice for Grant renewal,
per-provider project isolation, and the authenticated upload/storage boundary.

## Cleanup state

All task-specific Agent Server/Paseo/OpenCode/MCP processes are stopped. Both
final canaries verified their disposable project/Registry/Runtime roots were
removed. The latest built-in and user-authored acceptance databases remain in the
retained PostgreSQL container; prior evidence databases and worktrees remain
untouched.
