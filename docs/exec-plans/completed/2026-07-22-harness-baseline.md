---
status: completed
owner: codex
created_at: 2026-07-22
updated_at: 2026-07-22
authority: execution-plan
---

# Harness repository baseline

## Outcome

Deliver one reviewable branch that establishes the self-contained repository Harness and proves `HTTP → asynchronous Run → AgentRuntimePort → Paseo → OpenCode free model → pollable result`, with deterministic merge gates and a separate zero-model-credential external smoke.

## Context and authority

- The default branch contains only an empty initialization commit.
- The implementation is greenfield; legacy `backup` behavior is reference-only.
- The approved plan uses TypeScript, Hono, Zod, Vitest, pnpm, an in-memory baseline repository, and an external Paseo process.
- V1 product truth uses canonical Task/Run semantics; this minimal Run API is a walking skeleton and not a permanent competing invocation model.

## Scope

- Repository entrypoints, Product/Feature/Component/Architecture/Contract/Quality/Operations/ADR documentation, and Agent handbook.
- Minimal asynchronous Run API, safe error contract, liveness/readiness, and structured logs.
- Runtime Port, Paseo SDK adapter, explicit Workspace reuse, OpenCode catalog discovery, and free-only automatic model selection.
- Cross-platform pinned OpenCode resolver and isolated local process scripts.
- Unit, contract, component-integration, deterministic E2E, documentation/plan checks, CI, and live external smoke.
- Validation, plan archival, intentional commit, and remote feature branch.

## Non-goals

- Copy or migrate legacy implementation.
- Durable database/queue, lease/fence/reconcile, cancel/retry/SSE, authentication/tenant, credentials/tools/approval, Agent/Team definitions, memory/artifacts, Lark, Web console, schedule/trigger, or production deployment.
- Treat free external model availability as a required PR gate.

## Work breakdown

- [x] Ground remote branch state, legacy boundary, product specification, and prior live validation.
- [x] Establish the local feature branch and update this Active Exec Plan.
- [x] Create repository entrypoints and self-contained documentation hierarchy.
- [x] Add Agent handbook, work lifecycle, Human Gates, and completion checks.
- [x] Implement Run domain, repository port, in-memory repository, and application use cases.
- [x] Implement health and asynchronous Run HTTP contracts.
- [x] Implement Paseo SDK seam, Runtime Adapter, Workspace lifecycle, model selector, and safe status/error mapping.
- [x] Implement supported-platform OpenCode resolution and isolated daemon/API/smoke process lifecycle.
- [x] Add deterministic unit, contract, integration, and real-socket E2E tests.
- [x] Add documentation/Exec Plan checks and GitHub workflows.
- [x] Format the complete repository and pass all deterministic gates from the locked install.
- [x] Run the real zero-model-credential Paseo/OpenCode smoke three consecutive times, then revalidate the hardened environment path to the provider.
- [x] Inspect complete diff, tracked files, generated output, process cleanup, logs, and documentation accuracy.
- [x] Record final validation evidence and residual limitations.
- [x] Complete every checklist, move this plan to `completed/`, and re-run plan/docs checks.
- [x] Commit intentionally and publish the reviewed tree to a new remote branch.

## Verification

- [x] `pnpm check:types`.
- [x] Unit tests for Run/config/logging/model/status behavior.
- [x] HTTP contract tests for health, validation, size, readiness, create/get, safe response.
- [x] Component-integration tests for real adapter with fake Paseo SDK seam.
- [x] Deterministic real-socket E2E for POST/poll/success.
- [x] `make ci` after formatting and documentation completion.
- [x] `make paseo-smoke` three consecutive times with exact marker, free model, no OpenCode auth file, and no residual managed process; classify later provider-limit attempts separately.
- [x] Record actual command output and counts below.

## Documentation impact

- [x] Product, users, requirements, Feature status, roadmap, and glossary added.
- [x] Components and current code ownership added.
- [x] Architecture, Run/Health/Runtime contracts added.
- [x] Testing, release gates, local development, runbook, and security added.
- [x] Greenfield, stack, and Paseo process-boundary ADRs added.
- [x] Agent workflow and Exec Plan lifecycle added.
- [x] Reconcile all links/status claims against final code and checks.

## Decisions and discoveries

- Use a genuinely new delivery branch `agent/harness-baseline`; an earlier empty `agent/repository-baseline` remote branch remains untouched.
- Keep daemon process management in scripts, not `PaseoRuntimeAdapter`.
- Use direct platform OpenCode optional packages instead of the generic installer; standard installation had previously selected the wrong libc package in the validation environment.
- Automatic model choice requires an explicit free marker and never falls back to an unknown paid model. An operator override must exist in the live catalog; callers cannot provide one.
- The local product-spec attachment was an incomplete split archive. Product facts were re-grounded read-only from the maintained source, while repository documentation remains independent of that source.
- pnpm in the managed validation environment required its store/XDG paths under ignored `.local/`; this is not a product runtime requirement.
- A Make target named `ci` must invoke `pnpm run ci`; `pnpm ci` resolves to pnpm's install alias and does not run the package script.
- Node child-process `stdio` requires an opened numeric file descriptor in this environment. The first smoke attempt failed before spawning any service because a not-yet-open stream exposed `fd: null`.
- The `tsx` CLI tried to create an IPC socket that the managed sandbox denied. External smoke now builds first and starts the production `dist` entrypoint with native Node, which also verifies the deployable artifact instead of a development loader.
- Final review found that a denylist of model keys still exposed unrelated parent-process secrets to the runtime. Process launch now uses a tested non-secret allowlist, while local API configuration is copied only by explicit name; public readiness also replaces raw initialization errors with a stable message.
- The first post-hardening live run reached OpenCode normally but `mimo-v2.5-free` returned a provider rate limit and the Run timed out. Smoke now accepts an operator-only diagnostic override whose ID must be explicitly free; default automatic selection and the no-paid-fallback rule are unchanged.

## Risks and recovery

- Free model catalog/network/rate limits are external; deterministic CI remains the merge gate and smoke failure is classified separately.
- Current Run state is process-local and lost on restart; docs and API make no durability claim.
- If live smoke leaves a child process, stop only the recorded managed PID/process group and do not publish until cleanup is fixed.
- If remote branch state changes before publication, compare master/head again and create a new branch rather than force-update unrelated work.

## Validation evidence

- `pnpm check:types`: passed after core implementation.
- `pnpm test:unit && pnpm test:contract && pnpm test:integration && pnpm test:e2e`: 9 files and 31 tests passed before documentation/scripts finalization.
- Final `make ci`: passed after environment isolation and diagnostic-smoke changes; documentation check covered 46 Markdown files, Exec Plan checks covered 1 plan, and 34 deterministic tests passed (19 unit, 10 contract, 4 component integration, 1 real-socket E2E), followed by a successful production TypeScript build.
- `make paseo-smoke`: passed three consecutive isolated runs at `2026-07-22T04:25:32.718Z`, `2026-07-22T04:26:53.984Z`, and `2026-07-22T04:27:55.395Z`.
- Every successful live run reported readiness `ready`, provider `opencode`, model `opencode/mimo-v2.5-free`, terminal status `succeeded`, exact text `PASEO_OPENCODE_BASELINE_OK`, and zero OpenCode credential files.
- After environment allowlisting, live attempts with `opencode/mimo-v2.5-free` and the explicit-free diagnostic override `opencode/deepseek-v4-flash-free` both reached the provider; OpenCode logs classified both as `Rate limit exceeded`, and the baseline safely returned terminal `timed_out` without exposing the raw provider error through HTTP.
- Managed-process scanning after all success and rate-limit attempts found no Paseo, compiled Agent Server, or OpenCode run/serve process. Runtime homes, logs, and JSON evidence remain under ignored `.local/smoke/`; no OpenCode `auth.json` exists.
- Remote implementation commit `864ea6b682a9e438f7a987dfd088dc158d57a85c` was created directly on new branch `agent/harness-baseline` with remote `master` commit `a1aad838d06c5af02c3947603c527154677c7afc` as its parent. Remote comparison reported 114 added files, ahead by 1 and behind by 0.

## Completion checklist

- [x] Accepted implementation scope and non-goals match the final diff.
- [x] All deterministic tests and build pass from the lockfile.
- [x] External runtime smoke evidence is recorded.
- [x] No secret, prompt, raw provider error, private source URL, generated evidence, or unintended file is tracked.
- [x] No unmanaged local process remains.
- [x] Product/Feature/Component/Contract/ADR/Runbook are synchronized.
- [x] All work and verification items are checked or explicitly transferred.
- [x] Plan is archived to `completed/` and contains no unchecked item.

## Current blocker

None.

## Next exact command

`make check`

## Cleanup state

No API, Paseo, or OpenCode process is running. Dependency store, compiled output, isolated runtime homes, logs, and external-smoke evidence are under ignored local paths. No OpenCode authentication file was created.
